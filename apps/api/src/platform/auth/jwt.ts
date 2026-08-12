import { createHmac, timingSafeEqual } from 'node:crypto';

import { ERROR_CODES, isUuid, uuidv7 } from '@vyuha/shared';

import { AppError } from '../common/errors.js';

/**
 * HS256 JSON Web Tokens, signed and verified here rather than by a library.
 *
 * This is a hand-rolled implementation of a security primitive and that should
 * be stated plainly: no JWT library is an installed dependency, and this phase
 * was told not to add one. `jose` or `jsonwebtoken` should replace this file,
 * and the seam is deliberately narrow -- `signAccessToken` and
 * `verifyAccessToken` are the only two exports anything else uses.
 *
 * The failure modes a JWT implementation is judged on, and what is done here:
 *
 * - **Algorithm confusion.** The header's `alg` is not consulted to choose a
 *   verifier. HS256 is the only algorithm this code can perform; a token
 *   arriving as `none`, `RS256`, or anything else is rejected before its
 *   signature is examined at all.
 * - **Non-constant-time comparison.** The signature is compared with
 *   `timingSafeEqual` over raw bytes, after a length check that cannot leak
 *   more than the length.
 * - **Unverified claim reads.** There is no "decode without verifying" export.
 *   The payload is parsed only after the signature checks out.
 * - **Missing expiry.** `exp` is required, not optional, and a token without
 *   it is invalid rather than eternal.
 */

const ALGORITHM = 'HS256';

/** Guards against a caller sending a megabyte of base64 to be HMACed. */
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

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(signingInput: string, secret: string): string {
  return createHmac('sha256', secret).update(signingInput).digest('base64url');
}

function invalid(message: string): AppError {
  return new AppError(ERROR_CODES.TOKEN_INVALID, message);
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

export function signAccessToken(input: SignAccessTokenInput): string {
  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const claims: AccessTokenClaims = {
    sub: input.userId,
    org: input.orgId,
    sid: input.sessionId,
    iat: issuedAt,
    exp: issuedAt + input.ttlSeconds,
    jti: uuidv7(),
  };

  const signingInput = `${encodeSegment({ alg: ALGORITHM, typ: 'JWT' })}.${encodeSegment(claims)}`;
  return `${signingInput}.${sign(signingInput, input.secret)}`;
}

function parseJson(segment: string): unknown {
  let text: string;
  try {
    text = Buffer.from(segment, 'base64url').toString('utf8');
  } catch (cause) {
    throw new AppError(ERROR_CODES.TOKEN_INVALID, 'Token segment is not valid base64url.', {
      cause,
    });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new AppError(ERROR_CODES.TOKEN_INVALID, 'Token segment is not valid JSON.', { cause });
  }
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
 * Throws `TOKEN_INVALID` for anything malformed or wrongly signed and
 * `TOKEN_EXPIRED` for a well-formed token past its `exp`. The distinction is
 * the whole point: the web client silently refreshes on the second and sends
 * the user to the login screen on the first.
 */
export function verifyAccessToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): AccessTokenClaims {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw invalid('Token is empty or implausibly long.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw invalid('Token is not three dot-separated segments.');

  const [headerPart, payloadPart, signaturePart] = parts;
  if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined) {
    throw invalid('Token is not three dot-separated segments.');
  }

  const header = parseJson(headerPart);
  if (typeof header !== 'object' || header === null) throw invalid('Token header is not an object.');
  const headerRecord: Record<string, unknown> = { ...header };
  // Read, never dispatched on. See the algorithm-confusion note above.
  if (headerRecord.alg !== ALGORITHM) throw invalid('Token algorithm is not supported.');
  if (headerRecord.typ !== undefined && headerRecord.typ !== 'JWT') {
    throw invalid('Token type is not JWT.');
  }

  const expected = Buffer.from(sign(`${headerPart}.${payloadPart}`, secret), 'base64url');
  const provided = Buffer.from(signaturePart, 'base64url');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw invalid('Token signature does not verify.');
  }

  const payload = parseJson(payloadPart);
  if (typeof payload !== 'object' || payload === null) {
    throw invalid('Token payload is not an object.');
  }
  const claims: Record<string, unknown> = { ...payload };

  const exp = readNumber(claims, 'exp');
  const iat = readNumber(claims, 'iat');

  if (nowSeconds > exp + CLOCK_SKEW_SECONDS) {
    throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'Access token has expired.');
  }
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
