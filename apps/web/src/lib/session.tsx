import * as React from "react"

import { ApiError, apiFetch } from "@/lib/api"
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

const ACCOUNTS: Array<Omit<SessionUser, "source"> & { password: string }> = [
  { name: "Virag Jain", email: "admin@delta.dev", password: "Admin@123", role: "ADMIN", employeeId: "emp_1", initials: "VJ" },
  { name: "Priya Nair", email: "hr@delta.dev", password: "Hr@12345", role: "HR", employeeId: "emp_2", initials: "PN" },
  { name: "Rohan Desai", email: "ops@delta.dev", password: "Ops@1234", role: "OPERATIONS", employeeId: "emp_8", initials: "RD" },
  { name: "Kabir Singh", email: "employee@delta.dev", password: "Emp@1234", role: "EMPLOYEE", employeeId: "emp_5", initials: "KS" },
]

export const DEMO_ACCOUNTS = ACCOUNTS.map(({ password: _password, ...user }) => user)

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
  const matrix = DEFAULT_MATRIX

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
            return { ok: false, error: "Invalid email or password." }
          }
          // API unreachable — demo fallback.
          const account = ACCOUNTS.find(
            (candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase()
          )
          if (!account || account.password !== password) {
            return { ok: false, error: "Invalid email or password." }
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
