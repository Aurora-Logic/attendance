/**
 * Technical design §6: "Base path /api/v1". Declared once because the logger's
 * ignore rule, the CORS setup, and `setGlobalPrefix` all have to agree, and a
 * disagreement shows up as a silently unlogged or unreachable route.
 */
export const API_PREFIX = 'api/v1';

/** The same prefix as it appears in `req.url`. */
export const API_PREFIX_PATH = `/${API_PREFIX}`;

/**
 * Matches every path under the prefix, including the prefix itself.
 *
 * Express 5 uses path-to-regexp 8, where a bare `*` is a syntax error and the
 * wildcard must be named. The braces make the segment optional, so middleware
 * also runs for a request to `/api/v1` with nothing after it.
 */
export const WILDCARD_ROUTE = '{*path}';
