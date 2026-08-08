/**
 * Thin client for the Fastify API. Every call carries cookies (the JWT pair is
 * httpOnly) and fails fast: if the API isn't running, callers get a
 * NETWORK failure within 2.5s and fall back to demo mode rather than hanging.
 *
 * The access token lives 15 minutes; the refresh token 30 days. A 401 here is
 * therefore almost always "access expired mid-session", so apiFetch refreshes
 * once (single-flight across concurrent callers) and retries the original
 * request. Only when the refresh itself fails is the session really over —
 * announced via the `api:session-expired` event so the session provider can
 * sign the user out with an honest message instead of scattering 401 toasts.
 */

/**
 * The localhost default is a development convenience only — vite.config.ts
 * refuses to produce a production build unless VITE_API_URL names the real
 * API, so this fallback can never reach a deployed bundle.
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000"

export const SESSION_EXPIRED_EVENT = "api:session-expired"

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    super(`API ${status}`)
    this.status = status
    this.body = body
  }
}

export class ApiUnreachable extends Error {}

/** Human sentence for a failed call — never surface "Error: API 401" raw. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiUnreachable) return "API unreachable — is the server running?"
  if (error instanceof ApiError) {
    const code = (error.body as { error?: string } | null)?.error
    if (error.status === 401) return "Session expired — sign in again."
    if (code === "OUT_OF_REACH") return "Outside your team — your grant reaches only your reports."
    if (code === "CANNOT_DECIDE_OWN") return "You raised this — someone else must decide it."
    if (code === "FORBIDDEN" || code === "READ_ONLY") return "Your role can't do this."
    if (code === "OUTSIDE_WINDOW") return "Outside the punch window and hard-block is on."
    if (code === "DUPLICATE_PUNCH") return "Duplicate punch — one was recorded moments ago."
    if (code) return code.replaceAll("_", " ").toLowerCase()
    return `Request failed (${error.status}).`
  }
  return String(error)
}

async function rawFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      signal: controller.signal,
      ...init,
      // Merge AFTER the spread so a caller's headers extend, never clobber.
      headers: { "content-type": "application/json", ...init.headers },
    })
  } catch {
    throw new ApiUnreachable()
  } finally {
    clearTimeout(timer)
  }
}

/** Single-flight: twenty concurrent 401s trigger ONE refresh, not twenty. */
let refreshInFlight: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await rawFetch("/auth/refresh", { method: "POST" }, 2_500)
      return response.ok
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 2_500
): Promise<T> {
  let response = await rawFetch(path, init, timeoutMs)

  // Access token expired mid-session: refresh once and replay the request.
  if (response.status === 401 && !path.startsWith("/auth/")) {
    if (await tryRefresh()) {
      response = await rawFetch(path, init, timeoutMs)
    } else {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    }
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, body)
  return body as T
}
