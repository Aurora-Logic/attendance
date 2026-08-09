import * as z from "zod"

/**
 * Roles and permissions are DATA, per brief §2 — never `if (role === 'admin')`.
 * A grant has two axes: the capability, and how far it reaches.
 */
/**
 * PICKER is a shop-floor role, not a lesser OPERATIONS. Someone who picks and
 * packs needs the order in front of them and nothing else — not the customer
 * master, not prices, not the ability to record a dispatch as delivered.
 */
export const ROLES = ["ADMIN", "HR", "OPERATIONS", "PICKER", "EMPLOYEE"] as const
export const roleSchema = z.enum(ROLES)
export type Role = z.infer<typeof roleSchema>

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  HR: "HR",
  OPERATIONS: "Operations",
  PICKER: "Picker",
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
  {
    key: "procurement.manage",
    group: "Procurement",
    label: "Vendors, items & purchase orders",
    description: "Maintain the vendor and item masters and raise purchase orders.",
  },
  {
    key: "po.approve",
    group: "Procurement",
    label: "Approve purchase orders",
    description: "Act on submitted POs; only approved POs can be sent or received against.",
  },
  {
    key: "grn.record",
    group: "Procurement",
    label: "Record goods receipts",
    description: "Book material against an approved PO, including rejections.",
  },
  {
    key: "procurement.view",
    group: "Procurement",
    label: "Procurement reports & analytics",
    description: "Vendor lead times, on-time delivery, fill rate and spend.",
  },
  {
    key: "sales.manage",
    group: "Sales",
    label: "Customers & estimates",
    description: "Maintain the customer master and raise, send and decide estimates.",
  },
  {
    key: "sales.view",
    group: "Sales",
    label: "Sales screens & reports",
    description: "See customers, estimates and their outcomes.",
  },
  {
    key: "dispatch.view",
    group: "Dispatch",
    label: "See the fulfilment board",
    description: "Where each order is: picking, packed, on a lorry, or signed for.",
  },
  {
    key: "dispatch.pick",
    group: "Dispatch",
    label: "Pick and pack",
    description: "Work a pick list and seal the cartons. Does not include recording a dispatch.",
  },
  {
    key: "dispatch.manage",
    group: "Dispatch",
    label: "Dispatch and proof of delivery",
    description:
      "Record the consignment, the lorry receipt and its three copies, and the signature on delivery.",
  },
  {
    key: "expense.claim",
    group: "People",
    label: "Raise expense claims",
    description: "File reimbursement claims for own spends.",
  },
  {
    key: "expense.approve",
    group: "People",
    label: "Approve expense claims",
    description: "Decide claims and mark them reimbursed.",
  },
]

export type PermissionMatrix = Record<string, Record<Role, Scope>>

/** Seed grants matching the §2 table exactly. Editable at runtime. */
export const DEFAULT_MATRIX: PermissionMatrix = {
  "config.manage": { ADMIN: "ALL", HR: "VIEW", OPERATIONS: "VIEW", PICKER: "NONE", EMPLOYEE: "NONE" },
  "employee.manage": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "NONE", PICKER: "NONE", EMPLOYEE: "NONE" },
  "leave.policy": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "NONE", PICKER: "NONE", EMPLOYEE: "NONE" },
  "leave.approve": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", PICKER: "NONE", EMPLOYEE: "NONE" },
  "attendance.approve": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", PICKER: "NONE", EMPLOYEE: "NONE" },
  "selfie.view": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", PICKER: "NONE", EMPLOYEE: "SELF" },
  "roster.manage": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", PICKER: "NONE", EMPLOYEE: "VIEW" },
  "reports.view": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", PICKER: "SELF", EMPLOYEE: "SELF" },
  "audit.view": { ADMIN: "ALL", HR: "VIEW", OPERATIONS: "NONE", PICKER: "NONE", EMPLOYEE: "NONE" },
  "punch.self": { ADMIN: "SELF", HR: "SELF", OPERATIONS: "SELF", PICKER: "SELF", EMPLOYEE: "SELF" },
  "procurement.manage": { ADMIN: "ALL", HR: "NONE", OPERATIONS: "ALL", PICKER: "NONE", EMPLOYEE: "NONE" },
  "po.approve": { ADMIN: "ALL", HR: "NONE", OPERATIONS: "NONE", PICKER: "NONE", EMPLOYEE: "NONE" },
  "grn.record": { ADMIN: "ALL", HR: "NONE", OPERATIONS: "ALL", PICKER: "NONE", EMPLOYEE: "NONE" },
  "procurement.view": { ADMIN: "ALL", HR: "VIEW", OPERATIONS: "ALL", PICKER: "NONE", EMPLOYEE: "NONE" },
  "sales.manage": { ADMIN: "ALL", HR: "NONE", OPERATIONS: "ALL", PICKER: "NONE", EMPLOYEE: "NONE" },
  "sales.view": { ADMIN: "ALL", HR: "VIEW", OPERATIONS: "ALL", PICKER: "NONE", EMPLOYEE: "NONE" },
  "dispatch.view": { ADMIN: "ALL", HR: "NONE", OPERATIONS: "ALL", PICKER: "ALL", EMPLOYEE: "NONE" },
  "dispatch.pick": { ADMIN: "ALL", HR: "NONE", OPERATIONS: "ALL", PICKER: "ALL", EMPLOYEE: "NONE" },
  // Separate from picking on purpose: the person who packed the carton should
  // not also be the one who certifies it arrived.
  "dispatch.manage": { ADMIN: "ALL", HR: "NONE", OPERATIONS: "ALL", PICKER: "NONE", EMPLOYEE: "NONE" },
  "expense.claim": { ADMIN: "SELF", HR: "SELF", OPERATIONS: "SELF", PICKER: "SELF", EMPLOYEE: "SELF" },
  "expense.approve": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "OWN_TEAM", PICKER: "NONE", EMPLOYEE: "NONE" },
}

/**
 * A permission added to PERMISSIONS without a matrix row must degrade to
 * NONE-for-everyone, never crash a screen. Applied to the seed at load.
 */
for (const permission of PERMISSIONS) {
  DEFAULT_MATRIX[permission.key] ??= { ADMIN: "ALL", HR: "NONE", OPERATIONS: "NONE", PICKER: "NONE", EMPLOYEE: "NONE" }
}

/**
 * Which scopes make sense for a given capability — and, critically, which the
 * guards can actually ENFORCE. Document capabilities (POs, estimates, bills)
 * have no per-employee reach, so offering OWN_TEAM there would grant a scope
 * nothing checks; the editor simply never offers un-enforceable reaches.
 */
const DOCUMENT_CAPABILITIES = new Set([
  "config.manage",
  "procurement.manage",
  "po.approve",
  "grn.record",
  "procurement.view",
  "sales.manage",
  "sales.view",
  "leave.policy",
  "audit.view",
])

export function allowedScopes(permissionKey: string): Scope[] {
  if (permissionKey === "punch.self") return ["NONE", "SELF"]
  if (permissionKey === "expense.claim") return ["NONE", "SELF"]
  if (permissionKey === "expense.approve") return ["NONE", "OWN_TEAM", "ALL"]
  if (DOCUMENT_CAPABILITIES.has(permissionKey)) return ["NONE", "VIEW", "ALL"]
  return ["NONE", "VIEW", "SELF", "OWN_TEAM", "OWN_BRANCH", "ALL"]
}
