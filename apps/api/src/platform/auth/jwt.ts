import { SignJWT, errors, jwtVerify } from 'jose';

import { ERROR_CODES, isUuid, uuidv7 } from '@vyuha/shared';

import { AppError } from '../common/errors.js';

/**
 * HS256 access tokens, signed and verified by `jose`.
 *
 * This file previously implemented the algorithm by hand, because no JWT
 * library was a declared dependency. That version was careful — it never
 * dispatched on the header `alg`, compared signatures in constant time, and
 * refused a token with no `exp` — and it is still the wrong thing to ship. A
 * hand-written security primitive is a liability regardless of how carefully
 * it was written, because the failure modes are the ones nobody thinks to test
 * and the cost of being wrong is the whole authentication system.
 *
 * Both exports are async, which is what the swap actually cost: `jose` has no
 * synchronous API, by design — it is built on WebCrypto, whose operations
 * return promises. That is not a real price here. Verification happens inside
 * a Nest guard, which is asynchronous already, and going through WebCrypto is
 * also what makes moving to RS256 with a JWKS later a configuration change
 * rather than another rewrite of this file.
 *
 * The properties the tests in jwt.test.ts assert, and where each now comes
 * from:
 *
 * - **Algorithm confusion.** `algorithms: ['HS256']` is an allowlist checked
 *   before any signature work. A token arriving as `none`, `RS256`, or
 *   anything else is refused, including one whose signature is a genuine HMAC.
 * - **Missing expiry.** `requiredClaims` makes `exp` mandatory, so a token
 *   without one is invalid rather than eternal.
 * - **Unverified claim reads.** There is no decode-without-verify export here,
 *   and `jwtVerify` returns claims only after the signature checks out.
 * - **Oversized input.** Still guarded here, before `jose` is handed anything:
 *   the length check is cheaper than the parse it prevents.
 */

const ALGORITHM = 'HS256';

/** Guards against a caller sending a megabyte of base64 to be verified. */
const MAX_TOKEN_LENGTH = 4096;

/**
 * Tolerance for clock drift between this process and whatever issued the
 * token. Small on purpose: the only issuer is this same process, so anything
 * larger would be extending the life of an expired token for no reason.
 */
const CLOCK_SKEW_SECONDS = 5;

export interface AccessTokenClaims {
  /** User id. */
  readonly sub: string;
  /** Organisation id. Present so a scoped repository can be built without a
   *  second lookup, and cross-checked against the database row on every use. */
  readonly org: string;
  /** The session (refresh-token family member) this access token belongs to. */
  readonly sid: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function invalid(message: string, cause?: unknown): AppError {
  return new AppError(
    ERROR_CODES.TOKEN_INVALID,
    message,
    cause === undefined ? undefined : { cause },
  );
}

export interface SignAccessTokenInput {
  readonly userId: string;
  readonly orgId: string;
  readonly sessionId: string;
  readonly ttlSeconds: number;
  readonly secret: string;
  /** Injectable for tests; production always passes the real clock. */
  readonly nowSeconds?: number;
}

export async function signAccessToken(input: SignAccessTokenInput): Promise<string> {
  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  return new SignJWT({ org: input.orgId, sid: input.sessionId })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(input.userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + input.ttlSeconds)
    .setJti(uuidv7())
    .sign(secretKey(input.secret));
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`Token claim "${key}" is missing or not a number.`);
  }
  return value;
}

function readUuid(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || !isUuid(value)) {
    throw invalid(`Token claim "${key}" is missing or not an id.`);
  }
  return value;
}

/**
 * Rejects with `TOKEN_EXPIRED` for a well-formed token past its `exp` and
 * `TOKEN_INVALID` for everything else. The distinction is the whole point: the
 * web client silently refreshes on the first and sends the user to the login
 * screen on the second.
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<AccessTokenClaims> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw invalid('Token is empty or implausibly long.');
  }

  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: [ALGORITHM],
      typ: 'JWT',
      requiredClaims: ['exp', 'iat', 'sub', 'jti'],
      clockTolerance: CLOCK_SKEW_SECONDS,
      currentDate: new Date(nowSeconds * 1000),
    });
    claims = { ...payload };
  } catch (cause) {
    if (cause instanceof errors.JWTExpired) {
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'Access token has expired.', { cause });
    }
    throw invalid('Token could not be verified.', cause);
  }

  const exp = readNumber(claims, 'exp');
  const iat = readNumber(claims, 'iat');

  // jose validates nbf and exp but not iat, so this stays. A token stamped in
  // the future is either a broken clock or a forgery attempt, and neither is
  // something to serve a request on.
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw invalid('Token was issued in the future.');
  }

  return {
    sub: readUuid(claims, 'sub'),
    org: readUuid(claims, 'org'),
    sid: readUuid(claims, 'sid'),
    iat,
    exp,
    jti: readUuid(claims, 'jti'),
  };
}
