import * as React from "react"
import {
  DEFAULT_MATRIX,
  ROLE_LABEL,
  type PermissionMatrix,
  type Role,
  type Scope,
} from "@attendance/shared"

interface SessionValue {
  role: Role
  name: string
  initials: string
  email: string
  setRole: (role: Role) => void
  /** Resolved reach of a capability for the signed-in role. */
  scopeFor: (permissionKey: string) => Scope
  can: (permissionKey: string) => boolean
  matrix: PermissionMatrix
}

const SessionContext = React.createContext<SessionValue | null>(null)

const PEOPLE: Record<Role, { name: string; initials: string; email: string }> = {
  ADMIN: { name: "Virag Jain", initials: "VJ", email: "virag@example.com" },
  HR: { name: "Priya Nair", initials: "PN", email: "priya.nair@example.com" },
  OPERATIONS: { name: "Rohan Desai", initials: "RD", email: "rohan.desai@example.com" },
  EMPLOYEE: { name: "Kabir Singh", initials: "KS", email: "kabir.singh@example.com" },
}

/**
 * Stands in for real auth until Phase 1. The important part is the shape: the
 * app asks `can()` / `scopeFor()`, never `role === "ADMIN"`, so swapping the
 * seeded matrix for the API response changes nothing downstream.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = React.useState<Role>("ADMIN")
  const matrix = DEFAULT_MATRIX

  const value = React.useMemo<SessionValue>(() => {
    const scopeFor = (permissionKey: string): Scope =>
      matrix[permissionKey]?.[role] ?? "NONE"
    return {
      role,
      ...PEOPLE[role],
      setRole,
      scopeFor,
      can: (permissionKey: string) => scopeFor(permissionKey) !== "NONE",
      matrix,
    }
  }, [role, matrix])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = React.useContext(SessionContext)
  if (!context) throw new Error("useSession must be used inside SessionProvider")
  return context
}

export { ROLE_LABEL }
