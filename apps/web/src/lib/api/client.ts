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
  /** Internal: suppresses the refresh-and-retry, so refreshing cannot recurse. */
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

/** Exchanges the refresh cookie for a new access token. Returns false if there is none. */
export async function refreshAccessToken(): Promise<boolean> {
  let response: Response;
  try {
    response = await send('/auth/refresh', { method: 'POST', skipRefresh: true });
  } catch {
    return false;
  }
  if (!response.ok) {
    setAccessToken(null);
    return false;
  }
  const body = (await response.json()) as { accessToken?: unknown };
  if (typeof body.accessToken !== 'string') return false;
  setAccessToken(body.accessToken);
  return true;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
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

  if (response.status === 401 && !options.skipRefresh) {
    if (await refreshAccessToken()) {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}
