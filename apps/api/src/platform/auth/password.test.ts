import { describe, expect, it } from 'vitest';

import { AppError } from '../common/errors.js';
import { describeHash, hashPassword, needsRehash, verifyPassword } from './password.js';
import { assertPasswordAcceptable } from './password-policy.js';

describe('password hashing', () => {
  it('produces a self-describing hash carrying its parameters', async () => {
    const hash = await hashPassword('a-perfectly-good-passphrase');

    // ADR 0002: "password hashes carry their parameters so old hashes stay
    // verifiable after a change." Asserting the shape is asserting that.
    expect(hash).toMatch(/^\$scrypt\$n=\d+,r=\d+,p=\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    expect(describeHash(hash)).toBe('scrypt n=16384 r=8 p=1');
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([
      hashPassword('identical-input-passphrase'),
      hashPassword('identical-input-passphrase'),
    ]);
    expect(first).not.toBe(second);
    expect(await verifyPassword('identical-input-passphrase', first)).toBe(true);
    expect(await verifyPassword('identical-input-passphrase', second)).toBe(true);
  });

  it('verifies the right password and rejects everything else', async () => {
    const hash = await hashPassword('the-correct-passphrase');

    expect(await verifyPassword('the-correct-passphrase', hash)).toBe(true);
    expect(await verifyPassword('the-correct-passphras', hash)).toBe(false);
    expect(await verifyPassword('the-correct-passphrasee', hash)).toBe(false);
    expect(await verifyPassword('The-Correct-Passphrase', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('verifies a hash written with weaker parameters, and marks it for upgrade', async () => {
    // Hand-built rather than produced by hashPassword: this is what a row
    // written before the cost was raised looks like, and it is the case the
    // parameter-carrying format exists to survive. The digest is the real
    // scrypt output for these parameters, produced by node:crypto below.
    const { scryptSync } = await import('node:crypto');
    const salt = Buffer.from('0123456789abcdef', 'utf8');
    const legacyKey = scryptSync('legacy-passphrase-here', salt, 64, { N: 4096, r: 8, p: 1 });
    const legacy = `$scrypt$n=4096,r=8,p=1$${salt.toString('base64url')}$${legacyKey.toString('base64url')}`;

    expect(await verifyPassword('legacy-passphrase-here', legacy)).toBe(true);
    expect(await verifyPassword('wrong', legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword('current-passphrase'))).toBe(false);
  });

  it('treats a null, corrupt, or hostile hash as "does not verify" rather than throwing', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything', '$argon2id$v=19$m=1,t=1,p=1$abc$def')).toBe(false);
    expect(await verifyPassword('anything', '$scrypt$n=16384,r=8,p=1$$')).toBe(false);
    // A row asking for 2^30 rounds would try to allocate gigabytes. Refusing
    // to parse it is the difference between a failed login and a dead process.
    expect(await verifyPassword('anything', '$scrypt$n=1073741824,r=8,p=1$YWJj$ZGVm')).toBe(false);
    expect(needsRehash('not-a-hash')).toBe(true);
    expect(needsRehash(null)).toBe(true);
  });

  /**
   * The account-enumeration defence. What would make this pass while the
   * feature is broken: measuring one sample each, where scheduling noise
   * swamps a 70 ms difference. So both sides are measured several times and
   * compared on the median, and the assertion is anchored to the *absolute*
   * cost of a real hash rather than to a percentage -- if the decoy were
   * removed, the missing-user path would drop to near zero and fail here.
   */
  it('costs the same for a null hash as for a real one', async () => {
    const real = await hashPassword('timing-reference-passphrase');

    const sample = async (stored: string | null): Promise<number> => {
      const started = process.hrtime.bigint();
      await verifyPassword('some-attempted-password', stored);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const withHash: number[] = [];
    const withoutHash: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      withHash.push(await sample(real));
      withoutHash.push(await sample(null));
    }

    const median = (values: number[]): number =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

    const present = median(withHash);
    const absent = median(withoutHash);

    // Sanity: if hashing were suddenly free the comparison below would be
    // meaningless, so assert the reference is genuinely expensive first.
    expect(present).toBeGreaterThan(10);
    expect(absent).toBeGreaterThan(present * 0.5);
    expect(absent).toBeLessThan(present * 2);
  });
});

describe('password policy (REQ-B-01)', () => {
  const rejected = (password: string, email?: string): AppError => {
    try {
      assertPasswordAcceptable(password, email);
    } catch (error: unknown) {
      if (error instanceof AppError) return error;
      throw error;
    }
    throw new Error(`Expected "${password}" to be rejected.`);
  };

  it('accepts a long passphrase with no composition rules', () => {
    expect(() => {
      assertPasswordAcceptable('correct horse battery staple');
    }).not.toThrow();
    expect(() => {
      assertPasswordAcceptable('anandi ka ghar aur bagicha');
    }).not.toThrow();
  });

  it('rejects anything under ten characters', () => {
    const error = rejected('nine char');
    expect(error.code).toBe('PASSWORD_TOO_WEAK');
    expect(error.details).toMatchObject({ rule: 'minLength', minLength: 10 });
  });

  it('rejects a common password that clears the length floor', () => {
    expect(rejected('password123').details).toMatchObject({ rule: 'commonPassword' });
    expect(rejected('Welcome@123').details).toMatchObject({ rule: 'commonPassword' });
    expect(rejected('aaaaaaaaaaaa').details).toMatchObject({ rule: 'commonPassword' });
  });

  it('rejects a password built from the account address', () => {
    expect(rejected('asha.kumar-2026', 'asha.kumar@vyuha.local').details).toMatchObject({
      rule: 'containsEmail',
    });
    expect(rejected('asha.kumar@vyuha.local', 'ASHA.KUMAR@vyuha.local').details).toMatchObject({
      rule: 'containsEmail',
    });
  });
});
