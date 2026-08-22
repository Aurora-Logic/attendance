import type { CookieOptions, Request, Response } from 'express';

import { API_PREFIX_PATH } from '../common/constants.js';
import { env, isProduction } from '../common/env.js';

/**
 * Technical design §6: "refresh via `POST /auth/refresh` with an httpOnly
 * cookie holding the rotating refresh token."
 *
 * httpOnly is the point: the refresh token is the long-lived credential, and
 * keeping it out of JavaScript means an XSS bug in the web client can abuse a
 * session while it lasts but cannot walk away with one. The access token,
 * which the client must attach to every request and therefore must be able to
 * read, is the short-lived half.
 */

export const REFRESH_COOKIE_NAME = 'vyuha_refresh';

/** The auth routes are the only ones that ever need it. */
const COOKIE_PATH = `${API_PREFIX_PATH}/auth`;

export function refreshCookieOptions(maxAgeMs: number | null = env.JWT_REFRESH_TTL_SECONDS * 1000): CookieOptions {
  return {
    httpOnly: true,
    // Over plain HTTP in development the cookie would simply never be stored.
    secure: isProduction,
    // Strict, not Lax. Nothing navigates to an API endpoint, so there is no
    // legitimate cross-site request that needs this cookie -- which makes CSRF
    // against /refresh and /logout structurally impossible rather than
    // mitigated. The web client is same-site with the API in every
    // environment (site is registrable domain; the port does not matter).
    sameSite: 'strict',
    path: COOKIE_PATH,
    // Null is a session cookie: the organisation ends sign-ins when the
    // browser closes (owner, 22 Aug 2026); the row still expires on its own.
    ...(maxAgeMs === null ? {} : { maxAge: maxAgeMs }),
  };
}

export function setRefreshCookie(res: Response, token: string, maxAgeMs?: number | null): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(maxAgeMs));
}

/**
 * Clearing must repeat `path` and `sameSite`. A `Set-Cookie` that differs in
 * either creates a *second* cookie of the same name instead of removing the
 * first, and the browser then keeps sending the original -- a logout that
 * silently does nothing.
 */
export function clearRefreshCookie(res: Response): void {
  const { httpOnly, secure, sameSite, path } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, { httpOnly, secure, sameSite, path });
}

/**
 * Reads the cookie off the raw header.
 *
 * `cookie-parser` is not an installed dependency, and adding a middleware that
 * parses every cookie on every request to read one value on two routes is a
 * poor trade. This parses only what it is asked for and treats the header as
 * the untrusted input it is.
 */
export function readRefreshCookie(req: Request): string | null {
  return readCookie(req, REFRESH_COOKIE_NAME);
}

/** The same reader, for the one other cookie this server sets (trust-cookie.ts). */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || header.length === 0) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const raw = part.slice(separator + 1).trim();
    // A quoted cookie value is legal per RFC 6265 and Express strips the
    // quotes; doing it by hand here keeps the two readers consistent.
    const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    if (unquoted.length === 0) return null;

    try {
      return decodeURIComponent(unquoted);
    } catch {
      // A malformed percent-escape is not a token this server issued.
      return null;
    }
  }

  return null;
}
