/**
 * Thin client for the Fastify API. Every call carries cookies (the JWT pair is
 * httpOnly) and fails fast: if the API isn't running, callers get a
 * NETWORK failure within 2.5s and fall back to demo mode rather than hanging.
 */

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000"

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

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 2_500
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: { "content-type": "application/json", ...init.headers },
      signal: controller.signal,
      ...init,
    })
  } catch {
    throw new ApiUnreachable()
  } finally {
    clearTimeout(timer)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, body)
  return body as T
}
