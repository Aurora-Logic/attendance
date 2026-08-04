import * as z from "zod"

/**
 * Roles and permissions are DATA, per brief §2 — never `if (role === 'admin')`.
 * A grant has two axes: the capability, and how far it reaches.
 */
export const ROLES = ["ADMIN", "HR", "OPERATIONS", "EMPLOYEE"] as const
export const roleSchema = z.enum(ROLES)
export type Role = z.infer<typeof roleSchema>

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  HR: "HR",
  OPERATIONS: "Operations",
  EMPLOYEE: "Employee",
}

/** Reach of a grant. `NONE` means the capability is not granted at all. */
export const SCOPES = ["NONE", "SELF", "OWN_TEAM", "OWN_BRANCH", "ALL", "VIEW"] as const
export const scopeSchema = z.enum(SCOPES)
export type Scope = z.infer<typeof scopeSchema>

export const SCOPE_LABEL: Record<Scope, string> = {
  NONE: "—",
  SELF: "Own only",
  OWN_TEAM: "Own team",
  OWN_BRANCH: "Own branch",
  ALL: "All",
  VIEW: "View only",
}

export interface PermissionDef {
  key: string
  group: string
  label: string
  description: string
}

/** One row per capability in the §2 matrix. */
export const PERMISSIONS: PermissionDef[] = [
  {
    key: "config.manage",
    group: "Configuration",
    label: "Company, branch, shift & holiday config",
    description: "Create and edit the org, shift masters and holiday calendars.",
  },
  {
    key: "employee.manage",
    group: "People",
    label: "Create / edit / deactivate employees",
    description: "Full employee lifecycle including probation and exit.",
  },
  {
    key: "payroll.manage",
    group: "Payroll",
    label: "Salary structure, payroll run & payslips",
    description: "Run payroll against a locked month and release payslips.",
  },
  {
    key: "payroll.viewOwn",
    group: "Payroll",
    label: "View own payslip",
    description: "Download released payslips for oneself.",
  },
  {
    key: "leave.policy",
    group: "Leave",
    label: "Leave policy config & balance adjust",
    description: "Define types, quotas, accrual, and post manual ledger entries.",
  },
  {
    key: "leave.approve",
    group: "Approvals",
    label: "Approve leave",
    description: "Act on leave requests at the configured level.",
  },
  {
    key: "attendance.approve",
    group: "Approvals",
    label: "Approve attendance regularisation",
    description: "Act on flagged punches and regularisation requests.",
  },
  {
    key: "selfie.view",
    group: "Attendance",
    label: "View punch selfies",
    description: "See the stamped capture attached to a punch.",
  },
  {
    key: "roster.manage",
    group: "Attendance",
    label: "Roster / shift assignment",
    description: "Assign shifts per employee per date, bulk and copy-week.",
  },
  {
    key: "reports.view",
    group: "Reports",
    label: "All reports",
    description: "Run and export every report in the reports module.",
  },
  {
    key: "audit.view",
    group: "System",
    label: "Audit log",
    description: "Read the immutable change trail.",
  },
  {
    key: "punch.self",
    group: "Attendance",
    label: "Punch in/out, apply leave, raise regularisation",
    description: "The employee-facing actions everyone has.",
  },
]

export type PermissionMatrix = Record<string, Record<Role, Scope>>

/** Seed grants matching the §2 table exactly. Editable at runtime. */
export const DEFAULT_MATRIX: PermissionMatrix = {
  "config.manage": { ADMIN: "ALL", HR: "VIEW", OPERATIONS: "VIEW", EMPLOYEE: "NONE" },
  "employee.manage": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "NONE", EMPLOYEE: "NONE" },
  "payroll.manage": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "NONE", EMPLOYEE: "NONE" },
  "payroll.viewOwn": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "SELF", EMPLOYEE: "SELF" },
  "leave.policy": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "NONE", EMPLOYEE: "NONE" },
  "leave.approve": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", EMPLOYEE: "NONE" },
  "attendance.approve": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", EMPLOYEE: "NONE" },
  "selfie.view": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", EMPLOYEE: "SELF" },
  "roster.manage": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", EMPLOYEE: "VIEW" },
  "reports.view": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", EMPLOYEE: "SELF" },
  "audit.view": { ADMIN: "ALL", HR: "VIEW", OPERATIONS: "NONE", EMPLOYEE: "NONE" },
  "punch.self": { ADMIN: "SELF", HR: "SELF", OPERATIONS: "SELF", EMPLOYEE: "SELF" },
}

/** Which scopes make sense for a given capability. */
export function allowedScopes(permissionKey: string): Scope[] {
  if (permissionKey === "punch.self") return ["NONE", "SELF"]
  if (permissionKey === "payroll.viewOwn") return ["NONE", "SELF", "ALL"]
  return ["NONE", "VIEW", "SELF", "OWN_TEAM", "OWN_BRANCH", "ALL"]
}
