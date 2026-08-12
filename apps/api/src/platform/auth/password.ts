import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing.
 *
 * ADR 0002 specifies Argon2id. `argon2` is not an installed dependency and
 * this phase was told not to add one, so the memory-hard primitive available
 * in the standard library is used instead: scrypt. Both are memory-hard and
 * both defeat GPU-parallel cracking; Argon2id is the better of the two and
 * remains the target.
 *
 * ADR 0002 also says: "password hashes carry their parameters so old hashes
 * stay verifiable after a change." That is what makes the swap survivable.
 * Every hash written here is a self-describing string:
 *
 *     $scrypt$n=16384,r=8,p=1$<salt-base64url>$<hash-base64url>
 *
 * `verify` reads the algorithm and cost out of the stored string rather than
 * assuming today's constants, so raising N -- or adding `$argon2id$...` as a
 * second understood prefix later -- leaves every existing hash valid. Nothing
 * outside this file may parse or construct that string.
 */

/**
 * scrypt's classic (N, r, p). N is the work factor and dominates both time and
 * memory: 16384 x 8 x 128 bytes is 16 MiB and roughly 60-90 ms on the target
 * hardware, which is the usual balance between "slow enough to hurt an
 * offline attacker" and "fast enough that fifty people can log in at 09:00".
 */
const CURRENT_PARAMS = { n: 16_384, r: 8, p: 1 } as const;

const KEY_LENGTH = 64;

/**
 * Node defaults `maxmem` to 32 MiB, which N=16384 already sits close to. Set
 * explicitly and generously so that raising N in `CURRENT_PARAMS` is a
 * one-line change and not a change plus an obscure "memory limit exceeded"
 * failure at the first login afterwards.
 */
const MAX_MEMORY_BYTES = 256 * 1024 * 1024;

const ALGORITHM = 'scrypt';

interface ParsedHash {
  readonly algorithm: string;
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

/**
 * The async form, not `scryptSync`. Hashing blocks for tens of milliseconds;
 * done synchronously it blocks the event loop, so the fifth simultaneous login
 * waits for the first four to finish and every unrelated request queues behind
 * them. The callback form runs on the libuv threadpool instead.
 */
function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: MAX_MEMORY_BYTES },
      (error, key) => {
        if (error) {
          reject(new Error('Password hashing failed.', { cause: error }));
          return;
        }
        resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { n, r, p } = CURRENT_PARAMS;
  const key = await derive(password, salt, n, r, p);
  return [
    '',
    ALGORITHM,
    `n=${String(n)},r=${String(r)},p=${String(p)}`,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Returns null rather than throwing for anything that is not a hash this file
 * wrote. A corrupt or truncated `password_hash` column must read as "does not
 * verify", never as a crash on the login path.
 */
function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  // Leading empty segment from the '$' prefix, then algorithm, params, salt, hash.
  if (parts.length !== 5 || parts[0] !== '') return null;

  const [, algorithm, params, saltPart, hashPart] = parts;
  if (algorithm !== ALGORITHM) return null;
  if (params === undefined || saltPart === undefined || hashPart === undefined) return null;

  const cost: Record<string, number> = {};
  for (const pair of params.split(',')) {
    const [name, rawValue] = pair.split('=');
    if (name === undefined || rawValue === undefined) return null;
    if (!/^\d+$/u.test(rawValue)) return null;
    cost[name] = Number.parseInt(rawValue, 10);
  }

  const n = cost.n;
  const r = cost.r;
  const p = cost.p;
  if (n === undefined || r === undefined || p === undefined) return null;
  // A hostile or corrupted row must not be able to ask for an allocation that
  // takes the process down; scrypt would try to honour whatever N it is given.
  if (n < 1024 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return null;

  const salt = Buffer.from(saltPart, 'base64url');
  const hash = Buffer.from(hashPart, 'base64url');
  if (salt.length === 0 || hash.length === 0) return null;

  return { algorithm, n, r, p, salt, hash };
}

/**
 * A hash of a value nobody knows, computed once at module load with today's
 * parameters. `verifyPassword` runs against it when the account does not exist
 * or has no password set, so a missing account costs the same scrypt run as a
 * wrong password and login timing cannot be used to enumerate accounts.
 */
const decoyHash: Promise<string> = hashPassword(randomBytes(32).toString('base64url'));

/**
 * Constant-time in the ways that matter. `timingSafeEqual` handles the digest
 * comparison; the decoy handles the far larger signal, which is whether any
 * hashing happened at all.
 *
 * `stored` is nullable because `users.password_hash` is null between an
 * invitation being issued and accepted.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parsed = stored === null ? null : parse(stored);

  if (parsed === null) {
    // Deliberately does the work and discards it.
    const decoy = parse(await decoyHash);
    if (decoy !== null) {
      await derive(password, decoy.salt, decoy.n, decoy.r, decoy.p);
    }
    return false;
  }

  const candidate = await derive(password, parsed.salt, parsed.n, parsed.r, parsed.p);
  if (candidate.length !== parsed.hash.length) return false;
  return timingSafeEqual(candidate, parsed.hash);
}

/**
 * True when the stored hash was produced with weaker parameters than the
 * current ones, so a successful login can transparently upgrade it. Also true
 * for an unparseable hash, which should be replaced rather than kept.
 */
export function needsRehash(stored: string | null): boolean {
  if (stored === null) return true;
  const parsed = parse(stored);
  if (parsed === null) return true;
  return parsed.n < CURRENT_PARAMS.n || parsed.r < CURRENT_PARAMS.r || parsed.p < CURRENT_PARAMS.p;
}

/** Exposed for the tests and for an operator inspecting a row. Never a secret. */
export function describeHash(stored: string): string | null {
  const parsed = parse(stored);
  if (parsed === null) return null;
  return `${parsed.algorithm} n=${String(parsed.n)} r=${String(parsed.r)} p=${String(parsed.p)}`;
}
