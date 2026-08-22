import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Refresh tokens, invitation tokens, and password-reset tokens.
 *
 * None of these needs to be a JWT. They are looked up in a table on every use,
 * so a signature would prove nothing the row does not already prove, and an
 * opaque random string cannot be decoded into anything by whoever intercepts
 * it. Their security comes from 256 bits of entropy plus the row's own state.
 *
 * REQ-B-03 and REQ-B-04 require that the token itself is never stored --
 * "hash stored not the token". The stored value is a keyed HMAC rather than a
 * bare SHA-256, for two reasons:
 *
 * - A database leak on its own yields nothing usable: without the key, the
 *   stored digests cannot be matched against a guessed token.
 * - The `purpose` is mixed into the key, so an invitation token can never be
 *   presented as a password-reset token even if the two tables were confused
 *   by a future bug.
 *
 * Lookup is by exact hash on a unique index, so this is a constant-time index
 * probe rather than a scan-and-compare -- but `matchesHash` exists for the
 * places that compare a candidate against a hash they already hold.
 */

export const TOKEN_PURPOSES = {
  REFRESH: 'refresh',
  INVITATION: 'invitation',
  PASSWORD_RESET: 'password-reset',
  /** The connector agent's per-connection credential (09 §5). */
  AGENT: 'agent',
  /** REQ-B-09: the five minutes between the password and the code. */
  MFA_CHALLENGE: 'mfa-challenge',
  /** REQ-B-09: a one-time recovery code. */
  MFA_RECOVERY: 'mfa-recovery',
  /** REQ-B-09: a browser remembered for thirty days. */
  MFA_TRUST: 'mfa-trust',
} as const;

export type TokenPurpose = (typeof TOKEN_PURPOSES)[keyof typeof TOKEN_PURPOSES];

/** 32 bytes. base64url so it survives a URL path segment and a cookie value. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(purpose: TokenPurpose, token: string, secret: string): string {
  return createHmac('sha256', `${purpose}:${secret}`).update(token).digest('base64url');
}

export function matchesHash(
  purpose: TokenPurpose,
  token: string,
  storedHash: string,
  secret: string,
): boolean {
  const candidate = Buffer.from(hashOpaqueToken(purpose, token, secret), 'base64url');
  const stored = Buffer.from(storedHash, 'base64url');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/**
 * A token arriving from a URL path or a cookie is attacker-controlled text
 * that becomes part of a database query. Anything outside the base64url
 * alphabet, or longer than a token this code issues, is rejected before it
 * reaches the HMAC -- there is no legitimate caller it could belong to.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,256}$/u;

export function isWellFormedToken(value: string): boolean {
  return TOKEN_SHAPE.test(value);
}
