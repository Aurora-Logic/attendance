import { createHmac } from 'node:crypto';

import { uuidv7 } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { AppError } from '../common/errors.js';
import { signAccessToken, verifyAccessToken } from './jwt.js';

/**
 * This is a hand-rolled JWT implementation (see the note at the top of
 * `jwt.ts`), so the tests are written as attacks rather than as a happy path.
 * Every case below is a documented way a JWT verifier gets broken.
 */

const SECRET = 'test-secret-at-least-thirty-two-characters-long';
const OTHER_SECRET = 'a-completely-different-secret-of-similar-length';

const userId = uuidv7();
const orgId = uuidv7();
const sessionId = uuidv7();

function mint(overrides: { ttlSeconds?: number; nowSeconds?: number } = {}): string {
  return signAccessToken({
    userId,
    orgId,
    sessionId,
    ttlSeconds: overrides.ttlSeconds ?? 900,
    secret: SECRET,
    ...(overrides.nowSeconds === undefined ? {} : { nowSeconds: overrides.nowSeconds }),
  });
}

function segment(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function forge(header: object, payload: object, secret: string | null): string {
  const signingInput = `${segment(header)}.${segment(payload)}`;
  const signature =
    secret === null ? '' : createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('Expected the token to be rejected.');
}

describe('access tokens', () => {
  it('round-trips the claims it was given', () => {
    const claims = verifyAccessToken(mint(), SECRET);
    expect(claims.sub).toBe(userId);
    expect(claims.org).toBe(orgId);
    expect(claims.sid).toBe(sessionId);
    expect(claims.exp - claims.iat).toBe(900);
  });

  it('rejects a token signed with a different secret', () => {
    expect(codeOf(() => verifyAccessToken(mint(), OTHER_SECRET))).toBe('TOKEN_INVALID');
  });

  it('rejects alg=none, which is the classic forgery', () => {
    const forged = forge(
      { alg: 'none', typ: 'JWT' },
      { sub: userId, org: orgId, sid: sessionId, iat: 0, exp: 9_999_999_999, jti: uuidv7() },
      null,
    );
    expect(codeOf(() => verifyAccessToken(forged, SECRET))).toBe('TOKEN_INVALID');
  });

  it('rejects an algorithm swap even when the signature is a valid HMAC', () => {
    // Algorithm confusion: the header says RS256, the signature is an HS256
    // MAC over the same input with the same key. A verifier that dispatches on
    // `alg` and happens to fall back to HMAC would accept this.
    const forged = forge(
      { alg: 'RS256', typ: 'JWT' },
      { sub: userId, org: orgId, sid: sessionId, iat: 0, exp: 9_999_999_999, jti: uuidv7() },
      SECRET,
    );
    expect(codeOf(() => verifyAccessToken(forged, SECRET))).toBe('TOKEN_INVALID');
  });

  it('rejects a tampered payload', () => {
    const token = mint();
    const parts = token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    claims.sub = uuidv7();
    const tampered = `${parts[0] ?? ''}.${segment(claims)}.${parts[2] ?? ''}`;
    expect(codeOf(() => verifyAccessToken(tampered, SECRET))).toBe('TOKEN_INVALID');
  });

  it('reports an expired token distinctly from an invalid one', () => {
    const stale = mint({ ttlSeconds: 60, nowSeconds: Math.floor(Date.now() / 1000) - 600 });
    expect(codeOf(() => verifyAccessToken(stale, SECRET))).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token with no expiry rather than treating it as eternal', () => {
    const forged = forge(
      { alg: 'HS256', typ: 'JWT' },
      { sub: userId, org: orgId, sid: sessionId, iat: 0, jti: uuidv7() },
      SECRET,
    );
    expect(codeOf(() => verifyAccessToken(forged, SECRET))).toBe('TOKEN_INVALID');
  });

  it('rejects malformed input without throwing something other than AppError', () => {
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d', '...', 'not.base64url.here']) {
      expect(codeOf(() => verifyAccessToken(bad, SECRET))).toBe('TOKEN_INVALID');
    }
    // A megabyte of base64 must be refused before it is HMACed.
    expect(codeOf(() => verifyAccessToken('a'.repeat(100_000), SECRET))).toBe('TOKEN_INVALID');
  });

  it('rejects claims that are not identifiers', () => {
    const forged = forge(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'admin', org: orgId, sid: sessionId, iat: 0, exp: 9_999_999_999, jti: uuidv7() },
      SECRET,
    );
    expect(codeOf(() => verifyAccessToken(forged, SECRET))).toBe('TOKEN_INVALID');
  });

  it('allows a few seconds of clock skew but not minutes', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = mint({ ttlSeconds: 60, nowSeconds: now - 62 });
    expect(() => verifyAccessToken(token, SECRET, now - 1)).not.toThrow();
    expect(codeOf(() => verifyAccessToken(token, SECRET, now + 60))).toBe('TOKEN_EXPIRED');
  });
});
