import type { ApiErrorBody, ErrorCode } from '@vyuha/shared';

/**
 * The one way this app talks to the API.
 *
 * Two decisions worth stating, because both are security choices rather than
 * style:
 *
 * The access token is held in a module variable, never in localStorage. A
 * token in localStorage is readable by any script that gets injected into the
 * page, and it survives the tab; one in memory dies with the tab and is
 * invisible to injected script that cannot already read this closure. The
 * refresh token is an httpOnly cookie the browser sends automatically, which
 * is why `credentials: 'include'` is on every request and why the client never
 * touches it.
 *
 * On a 401 the client refreshes exactly once and retries. Once, because the
 * server rotates refresh tokens and treats a replayed one as theft
 * (REQ-B-05) - a client that retried in a loop would revoke the user's own
 * session family and log them out for no reason.
 */

const BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** An error the API described in its own envelope, with the code preserved. */
export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;

  constructor(input: {
    code: ErrorCode | 'NETWORK_ERROR';
    message: string;
    status: number;
    details?: Record<string, unknown>;
    requestId?: string;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.requestId = input.requestId;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value;
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A response that is not JSON is still a failure; it just cannot explain
    // itself. Reporting the status beats reporting a parse error.
    body = undefined;
  }

  if (isErrorBody(body)) {
    return new ApiError({
      code: body.error.code,
      message: body.error.message,
      status: response.status,
      ...(body.error.details === undefined ? {} : { details: body.error.details }),
      ...(body.error.requestId === undefined ? {} : { requestId: body.error.requestId }),
    });
  }

  return new ApiError({
    code: 'INTERNAL_ERROR',
    message: `The server returned ${String(response.status)}.`,
    status: response.status,
  });
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Suppresses the refresh-and-retry. Set on the refresh call itself so it
   * cannot recurse, and on public auth endpoints - login, and any future
   * password-reset or invitation-accept call - where a 401 is the endpoint's
   * verdict rather than an expired token, and a retry would replay the very
   * request being refused.
   */
  skipRefresh?: boolean;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * 'unauthenticated' is the server's answer; 'network-error' is no answer at
 * all. The two must stay distinct: treating an unreachable server as "signed
 * out" is how an offline reload ends up hiding a queued punch behind a login
 * form (REQ-D-10).
 */
export type RefreshOutcome = 'refreshed' | 'unauthenticated' | 'network-error';

async function performRefresh(): Promise<RefreshOutcome> {
  let response: Response;
  try {
    response = await send('/auth/refresh', { method: 'POST', skipRefresh: true });
  } catch {
    // The server never answered, so nothing is known about the session and
    // nothing is torn down.
    return 'network-error';
  }
  if (!response.ok) {
    setAccessToken(null);
    return 'unauthenticated';
  }
  const body = (await response.json()) as { accessToken?: unknown };
  if (typeof body.accessToken !== 'string') return 'unauthenticated';
  setAccessToken(body.accessToken);
  return 'refreshed';
}

/**
 * The one refresh this document has in the air, shared by everyone who wants
 * one.
 *
 * The refresh cookie is single-use and rotating, and the server treats a
 * replay as theft (REQ-B-05). Two refreshes started before either has landed
 * therefore present the *same* cookie, and the second is read as a stolen
 * token: the whole session family is revoked and the person is signed out.
 * Nothing on the server is wrong when that happens - the client has forged its
 * own theft signal.
 *
 * The window is easy to hit and does not need a slow network. On a document
 * loaded from the service worker there is no access token in memory at all, so
 * the moment the connection returns, `useMe` refetches and the punch queue
 * drains, and both discover they need a token within the same few
 * milliseconds. Measured before this guard: refresh 200 at +11ms, sync 401 at
 * +16ms, refresh 401 at +24ms, family revoked, the queued punch stranded.
 */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * Exchanges the refresh cookie for a new access token, once.
 *
 * Concurrent callers all receive the outcome of the single request that is
 * already in flight rather than starting one of their own. The slot is cleared
 * as that request settles, so a later 401 - a token that has since expired, or
 * a cookie the server has rotated in the meantime - still gets a fresh
 * exchange rather than a cached verdict.
 */
export function refreshAccessToken(): Promise<RefreshOutcome> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Makes sure there is something to authenticate with before a request goes out.
 *
 * A cold document holds no access token - it deliberately does not survive the
 * tab - so a request sent before the refresh cookie has been exchanged cannot
 * succeed. Sending it anyway costs a guaranteed 401, and, worse, moves the
 * refresh to a moment nobody controls: the 401 comes back after some other
 * refresh has already rotated the cookie, and the retry is what races. Asking
 * first funnels every caller into the one in-flight exchange above.
 *
 * `useMe` has always done this; the two senders now do it too, for the same
 * reason and through the same promise.
 */
export async function ensureAccessToken(): Promise<boolean> {
  if (accessToken !== null) return true;
  return (await refreshAccessToken()) === 'refreshed';
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Every path through this function except the public auth endpoints needs a
  // bearer token, so a cold document exchanges the cookie before it asks
  // rather than after it has been refused.
  const refreshedBeforeSending =
    !options.skipRefresh && accessToken === null ? await ensureAccessToken() : false;

  let response: Response;
  try {
    response = await send(path, options);
  } catch (cause) {
    // fetch only rejects when the request never completed, so this is a dead
    // server or a dropped connection - not an API error, and worth saying so
    // rather than reporting a misleading status.
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server.',
      status: 0,
      ...(cause instanceof Error ? { details: { cause: cause.message } } : {}),
    });
  }

  // Not after a refresh this call already made: the token is seconds old, so a
  // 401 is the server's verdict on the request rather than an expired token,
  // and exchanging the cookie again would only rotate it for nothing.
  if (response.status === 401 && !options.skipRefresh && !refreshedBeforeSending) {
    if ((await refreshAccessToken()) === 'refreshed') {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}
