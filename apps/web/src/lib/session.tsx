import * as React from "react"

import { ApiError, SESSION_EXPIRED_EVENT, apiFetch } from "@/lib/api"
import {
  DEFAULT_MATRIX,
  ROLE_LABEL,
  type PermissionMatrix,
  type Role,
  type Scope,
} from "@attendance/shared"

/**
 * Session with a real login gate. Credentials mirror the API seed users
 * (apps/api/src/store.ts) so the same accounts keep working when this swaps
 * from local verification to POST /auth/login — the shape of `user`,
 * `can()` and `scopeFor()` is exactly what /auth/me returns.
 */

export interface SessionUser {
  name: string
  email: string
  role: Role
  employeeId: string
  initials: string
  /** "api": authenticated against the running API. "demo": local fallback. */
  source: "api" | "demo"
}

/**
 * Seeded logins, for local development only.
 *
 * These are real, working credentials for the seeded accounts. They must never
 * reach a built bundle: the sign-in screen renders a button per account, so
 * anyone loading a deployed build was one click away from ADMIN. The whole
 * array sits behind `import.meta.env.DEV`, which the bundler replaces with
 * `false` at build time and then eliminates along with every string in it.
 *
 * `pnpm build` is verified against this — see the grep in
 * apps/web/src/lib/session.dev-accounts.test.ts.
 */
const ACCOUNTS: Array<Omit<SessionUser, "source"> & { password: string }> = import.meta.env.DEV
  ? [
      { name: "Virag Jain", email: "admin@delta.dev", password: "Admin@123", role: "ADMIN", employeeId: "emp_1", initials: "VJ" },
      { name: "Priya Nair", email: "hr@delta.dev", password: "Hr@12345", role: "HR", employeeId: "emp_2", initials: "PN" },
      { name: "Rohan Desai", email: "ops@delta.dev", password: "Ops@1234", role: "OPERATIONS", employeeId: "emp_8", initials: "RD" },
      { name: "Sanjay Yadav", email: "picker@delta.dev", password: "Pick@1234", role: "PICKER", employeeId: "emp_7", initials: "SY" },
      { name: "Kabir Singh", email: "employee@delta.dev", password: "Emp@1234", role: "EMPLOYEE", employeeId: "emp_5", initials: "KS" },
    ]
  : []

/** Empty in any built bundle, so the sign-in screen renders no shortcut list. */
export const DEMO_ACCOUNTS = ACCOUNTS.map(({ password: _password, ...user }) => user)

/**
 * The password for a seeded account, read from the one list that has it.
 *
 * The sign-in screen used to keep its own map keyed by role, which meant a new
 * role logged in with `undefined` and the button simply did nothing — no error,
 * no clue. One list, or the two drift the first time somebody adds an account.
 */
export function demoPasswordFor(email: string): string {
  return ACCOUNTS.find((account) => account.email === email)?.password ?? ""
}

interface SessionValue {
  user: SessionUser | null
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
  scopeFor: (permissionKey: string) => Scope
  can: (permissionKey: string) => boolean
  matrix: PermissionMatrix
}

const SessionContext = React.createContext<SessionValue | null>(null)

const STORAGE_KEY = "attendance.session.v1"

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<SessionUser>
      // Sessions stored before `source` existed default to demo.
      return { source: "demo", ...parsed } as SessionUser
    } catch {
      return null
    }
  })
  // Access token gone AND refresh failed: the session is really over — one
  // honest sign-out beats an app full of scattered 401 toasts.
  React.useEffect(() => {
    const onExpired = () => {
      setUser((current) => {
        if (current?.source === "api") {
          localStorage.removeItem(STORAGE_KEY)
          return null
        }
        return current
      })
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  const matrix = DEFAULT_MATRIX

  // An API session lives in httpOnly cookies; on boot, confirm it is still
  // valid. 401 → the cookie expired, back to login. Unreachable → keep the
  // stored session so the UI works offline in demo terms.
  React.useEffect(() => {
    if (!user || user.source !== "api") return
    void apiFetch("/auth/me").catch((error) => {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null)
        localStorage.removeItem(STORAGE_KEY)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = React.useMemo<SessionValue>(() => {
    const scopeFor = (permissionKey: string): Scope =>
      user ? (matrix[permissionKey]?.[user.role] ?? "NONE") : "NONE"
    return {
      user,
      login: async (email, password) => {
        // Real auth first: httpOnly JWT cookies from the API. When the API
        // isn't running (UI-only dev), the demo accounts keep the app usable.
        try {
          const { user: apiUser } = await apiFetch<{
            user: { name: string; email: string; role: Role; employeeId: string }
          }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })
          const initials = apiUser.name
            .split(" ")
            .map((part) => part[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()
          const safeUser: SessionUser = { ...apiUser, initials, source: "api" }
          setUser(safeUser)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(safeUser))
          return { ok: true }
        } catch (error) {
          if (error instanceof ApiError) {
            // 423 and 429 are not bad credentials, and telling somebody their
            // password is wrong when the account is locked sends them round the
            // same loop until the lockout expires.
            if (error.status === 423)
              return {
                ok: false,
                error: "Too many failed attempts. This account is locked for 15 minutes.",
              }
            if (error.status === 429)
              return { ok: false, error: "Too many attempts. Wait a minute and try again." }
            return { ok: false, error: "Invalid email or password." }
          }
          /**
           * The API is unreachable. In development the seeded accounts keep the
           * UI usable; in a built bundle ACCOUNTS is empty, so this falls
           * through to an honest "cannot reach the server" rather than
           * pretending the credentials were wrong.
           */
          const account = ACCOUNTS.find(
            (candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase()
          )
          if (!account || account.password !== password) {
            return ACCOUNTS.length === 0
              ? { ok: false, error: "Cannot reach the server. Check your connection and try again." }
              : { ok: false, error: "Invalid email or password." }
          }
          const { password: _password, ...rest } = account
          const safeUser: SessionUser = { ...rest, source: "demo" }
          setUser(safeUser)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(safeUser))
          return { ok: true }
        }
      },
      logout: () => {
        void apiFetch("/auth/logout", { method: "POST" }).catch(() => {})
        setUser(null)
        localStorage.removeItem(STORAGE_KEY)
      },
      scopeFor,
      can: (permissionKey) => scopeFor(permissionKey) !== "NONE",
      matrix,
    }
  }, [user, matrix])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = React.useContext(SessionContext)
  if (!context) throw new Error("useSession must be used inside SessionProvider")
  return context
}

export { ROLE_LABEL }
