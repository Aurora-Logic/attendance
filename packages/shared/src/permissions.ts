/**
 * Permission keys and the seed role matrix from PRD §2.1.
 *
 * PRD §2: "Roles are not hardcoded into logic. They are named bundles of
 * permissions." Nothing in this codebase may branch on a role name — every
 * check goes through a key defined here.
 */

import { z } from 'zod';

import type { UserStatus } from './enums.js';
import { adminReasonSchema } from './org.js';

export const PERMISSIONS = {
  PUNCH_SELF: 'punch.self',

  ATTENDANCE_VIEW_SELF: 'attendance.view.self',
  ATTENDANCE_VIEW_TEAM: 'attendance.view.team',
  ATTENDANCE_VIEW_ALL: 'attendance.view.all',
  ATTENDANCE_EDIT: 'attendance.edit',
  ATTENDANCE_LOCK: 'attendance.lock',
  /**
   * REQ-E-09: "Unlocking requires Admin and a reason."
   *
   * Separate from `attendance.lock` because gating unlock on the lock key makes
   * unlock exactly as available as lock, which is not what the requirement
   * says — and nothing may branch on a role name to make up the difference
   * (PRD §2). See docs/OPEN-QUESTIONS P2-1, which recorded that this key was
   * the fix and that adding it changes the seed matrix.
   */
  ATTENDANCE_UNLOCK: 'attendance.unlock',

  LEAVE_APPLY_SELF: 'leave.apply.self',
  LEAVE_APPROVE_TEAM: 'leave.approve.team',
  LEAVE_APPROVE_ALL: 'leave.approve.all',
  LEAVE_POLICY_MANAGE: 'leave.policy.manage',

  REGULARIZATION_RAISE: 'regularization.raise',
  REGULARIZATION_APPROVE: 'regularization.approve',

  EMPLOYEE_VIEW: 'employee.view',
  EMPLOYEE_MANAGE: 'employee.manage',

  SHIFT_MANAGE: 'shift.manage',
  HOLIDAY_MANAGE: 'holiday.manage',

  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',

  SETTINGS_MANAGE: 'settings.manage',
  ROLES_MANAGE: 'roles.manage',
  AUDIT_VIEW: 'audit.view',
  INTEGRATION_MANAGE: 'integration.manage',

  /**
   * 08 §2.2, the first Phase 6-8 key: read the Tally masters projection.
   * Sales, Sales manager, Purchase and Accounts gain it when those roles
   * arrive with their phases; Admin holds it from the moment the screen
   * exists, because a projection nobody can see cannot be reconciled.
   */
  MASTERS_TALLY_VIEW: 'masters.tally.view',
  RECEIVABLES_VIEW: 'receivables.view',

  /**
   * Phase 7 (08 §2.2). Self/all breadths for contacts and deals; tasks are a
   * platform concern (D-17) but keep the `crm.` spelling the PRD gave them.
   * The Sales roles that hold the self keys arrive with the role expansion;
   * until then Admin holds every key, as it does for every module.
   */
  CRM_CONTACT_VIEW_SELF: 'crm.contact.view.self',
  CRM_CONTACT_VIEW_ALL: 'crm.contact.view.all',
  CRM_CONTACT_MANAGE: 'crm.contact.manage',
  CRM_DEAL_VIEW_SELF: 'crm.deal.view.self',
  CRM_DEAL_VIEW_ALL: 'crm.deal.view.all',
  CRM_DEAL_MANAGE: 'crm.deal.manage',
  CRM_PIPELINE_MANAGE: 'crm.pipeline.manage',
  CRM_TASK_VIEW_SELF: 'crm.task.view.self',
  CRM_TASK_VIEW_TEAM: 'crm.task.view.team',
  CRM_TASK_MANAGE: 'crm.task.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as readonly PermissionKey[];

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'punch.self': 'Record own punch in and out',
  'attendance.view.self': 'View own attendance',
  'attendance.view.team': "View the team's attendance",
  'attendance.view.all': 'View attendance for the whole organisation',
  'attendance.edit': 'Override an attendance day with a reason',
  'attendance.lock': 'Lock an attendance period',
  'attendance.unlock': 'Unlock a locked attendance period with a reason',
  'leave.apply.self': 'Apply for own leave',
  'leave.approve.team': "Approve the team's leave",
  'leave.approve.all': 'Approve leave for anyone',
  'leave.policy.manage': 'Manage leave types and balances',
  'regularization.raise': 'Raise a regularization request',
  'regularization.approve': 'Approve a regularization request',
  'employee.view': 'View employee records',
  'employee.manage': 'Create and edit employee records',
  'shift.manage': 'Manage shifts, rosters, and weekly-off patterns',
  'holiday.manage': 'Manage holiday calendars',
  'report.view': 'View reports',
  'report.export': 'Export reports to Excel',
  'settings.manage': 'Change organisation settings',
  'roles.manage': 'Create roles and assign permissions',
  'audit.view': 'View the audit log',
  'masters.tally.view': 'View the Tally masters projection: parties, items, price lists',
  'receivables.view': 'View vouchers and receivables pulled from Tally: invoices, receipts, statements, ageing',
  'crm.contact.view.self': 'View the contacts and companies you own',
  'crm.contact.view.all': 'View every contact and company',
  'crm.contact.manage': 'Create and edit contacts and companies',
  'crm.deal.view.self': 'View the deals you own',
  'crm.deal.view.all': 'View every deal',
  'crm.deal.manage': 'Create deals and move them between stages',
  'crm.pipeline.manage': 'Configure pipelines and their stages',
  'crm.task.view.self': 'View tasks assigned to you or owned by you',
  'crm.task.view.team': 'View your team’s tasks',
  'crm.task.manage': 'Create, assign and close tasks',
  'integration.manage': 'Manage integration connections',
};

/**
 * Data scope for a permission that can be held at more than one breadth.
 * PRD §2: "team = employees whose reporting_manager_id chain reaches the user,
 * plus employees in departments the user owns." Resolved in the repository
 * layer by ScopeService, never in the UI.
 */
export const DATA_SCOPES = { SELF: 'self', TEAM: 'team', ALL: 'all' } as const;
export type DataScope = (typeof DATA_SCOPES)[keyof typeof DATA_SCOPES];

export const SYSTEM_ROLES = {
  EMPLOYEE: 'Employee',
  OPERATIONS: 'Operations',
  HR: 'HR',
  ADMIN: 'Admin',
  /**
   * 08 §2 (Phase 7). Held alongside Employee, never instead of it (D-15: a
   * salesperson is also an employee who punches, so attendance keys are not
   * duplicated here). Purchase and Accounts arrive with the phases that give
   * them something to do.
   */
  SALES: 'Sales',
  SALES_MANAGER: 'Sales manager',
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

const EMPLOYEE_PERMISSIONS = [
  PERMISSIONS.PUNCH_SELF,
  PERMISSIONS.ATTENDANCE_VIEW_SELF,
  PERMISSIONS.LEAVE_APPLY_SELF,
  PERMISSIONS.REGULARIZATION_RAISE,
] as const satisfies readonly PermissionKey[];

const OPERATIONS_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  PERMISSIONS.ATTENDANCE_VIEW_TEAM,
  PERMISSIONS.LEAVE_APPROVE_TEAM,
  PERMISSIONS.REGULARIZATION_APPROVE,
  PERMISSIONS.EMPLOYEE_VIEW,
  PERMISSIONS.SHIFT_MANAGE,
  PERMISSIONS.REPORT_VIEW,
] as const satisfies readonly PermissionKey[];

const HR_PERMISSIONS = [
  ...OPERATIONS_PERMISSIONS,
  PERMISSIONS.ATTENDANCE_VIEW_ALL,
  PERMISSIONS.ATTENDANCE_EDIT,
  PERMISSIONS.ATTENDANCE_LOCK,
  PERMISSIONS.LEAVE_APPROVE_ALL,
  PERMISSIONS.LEAVE_POLICY_MANAGE,
  PERMISSIONS.EMPLOYEE_MANAGE,
  PERMISSIONS.HOLIDAY_MANAGE,
  PERMISSIONS.REPORT_EXPORT,
] as const satisfies readonly PermissionKey[];

const ADMIN_PERMISSIONS = [
  ...HR_PERMISSIONS,
  // REQ-E-09. Admin only, and deliberately not in `HR_PERMISSIONS`: HR closes
  // a month, only Admin reopens one.
  PERMISSIONS.ATTENDANCE_UNLOCK,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.ROLES_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.INTEGRATION_MANAGE,
  PERMISSIONS.MASTERS_TALLY_VIEW,
  // 08 §2.2: Sales manager and Accounts hold this too, when those roles land.
  PERMISSIONS.RECEIVABLES_VIEW,
  PERMISSIONS.CRM_CONTACT_VIEW_SELF,
  PERMISSIONS.CRM_CONTACT_VIEW_ALL,
  PERMISSIONS.CRM_CONTACT_MANAGE,
  PERMISSIONS.CRM_DEAL_VIEW_SELF,
  PERMISSIONS.CRM_DEAL_VIEW_ALL,
  PERMISSIONS.CRM_DEAL_MANAGE,
  PERMISSIONS.CRM_PIPELINE_MANAGE,
  PERMISSIONS.CRM_TASK_VIEW_SELF,
  PERMISSIONS.CRM_TASK_VIEW_TEAM,
  PERMISSIONS.CRM_TASK_MANAGE,
] as const satisfies readonly PermissionKey[];

/**
 * Seed only. Admin can edit any of these in the UI afterwards (REQ-B-07), so
 * this matrix is a starting point, not an invariant the code may rely on.
 */
/** 08 §2.2, the Sales column, for the keys that exist so far. */
const SALES_PERMISSIONS = [
  PERMISSIONS.MASTERS_TALLY_VIEW,
  PERMISSIONS.CRM_CONTACT_VIEW_SELF,
  PERMISSIONS.CRM_CONTACT_MANAGE,
  PERMISSIONS.CRM_DEAL_VIEW_SELF,
  PERMISSIONS.CRM_DEAL_MANAGE,
  PERMISSIONS.CRM_TASK_VIEW_SELF,
  PERMISSIONS.CRM_TASK_MANAGE,
] as const satisfies readonly PermissionKey[];

/** 08 §2.2, the Sales manager column: all of Sales at full scope, plus receivables. */
const SALES_MANAGER_PERMISSIONS = [
  ...SALES_PERMISSIONS,
  PERMISSIONS.CRM_CONTACT_VIEW_ALL,
  PERMISSIONS.CRM_DEAL_VIEW_ALL,
  PERMISSIONS.CRM_PIPELINE_MANAGE,
  PERMISSIONS.CRM_TASK_VIEW_TEAM,
  PERMISSIONS.RECEIVABLES_VIEW,
] as const satisfies readonly PermissionKey[];

export const ROLE_PERMISSION_MATRIX: Record<SystemRoleName, readonly PermissionKey[]> = {
  Employee: EMPLOYEE_PERMISSIONS,
  Operations: OPERATIONS_PERMISSIONS,
  HR: HR_PERMISSIONS,
  Admin: ADMIN_PERMISSIONS,
  Sales: SALES_PERMISSIONS,
  'Sales manager': SALES_MANAGER_PERMISSIONS,
};

/**
 * REQ-B-07: "The last account holding roles.manage cannot be stripped of it."
 * Exported so the guard that enforces it names the same constant the seed does.
 */
export const IRREVOCABLE_LAST_HOLDER_PERMISSION = PERMISSIONS.ROLES_MANAGE;

// ---------------------------------------------------------------------------
// REQ-B-07 write contract: `GET/POST/PATCH/DELETE /roles`
// ---------------------------------------------------------------------------

/**
 * One role as the roles screen reads it.
 *
 * `memberCount` counts *active* accounts. A suspended holder cannot sign in, so
 * counting them would tell an administrator the role is still in use by someone
 * who can do nothing with it.
 */
export interface RoleSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /**
   * A seeded role. Editable (REQ-B-07 says Admin edits permission sets and
   * makes no exception), but not renameable and not deletable — the seed
   * reconciles by name, so a renamed `Admin` becomes a second `Admin` on the
   * next run and the original silently stops being reconciled.
   */
  readonly isSystem: boolean;
  readonly permissions: readonly PermissionKey[];
  readonly memberCount: number;
}

const roleNameField = z.string().trim().min(2).max(60);
const roleDescriptionField = z.string().trim().min(1).max(240);

/**
 * The permission set as a whole, never a delta.
 *
 * REQ-B-07 edits are wholesale for the same reason a reorder sends the whole
 * order: two administrators each sending "add X" and "remove Y" against a set
 * they both read a moment ago would compose into a set neither of them chose.
 */
const permissionSetField = z
  .array(z.enum(ALL_PERMISSIONS as unknown as [PermissionKey, ...PermissionKey[]]))
  .max(ALL_PERMISSIONS.length)
  .transform((keys) => [...new Set(keys)]);

export const createRoleSchema = z.object({
  name: roleNameField,
  description: roleDescriptionField.nullish(),
  permissions: permissionSetField.default([]),
  reason: adminReasonSchema,
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/**
 * Absent means unchanged, which is what makes this a PATCH. An empty
 * `permissions` array is *not* absent — it is "this role grants nothing", and
 * the last-holder guard in `RbacAdminService` is what stops that locking
 * everybody out.
 */
export const updateRoleSchema = z
  .object({
    name: roleNameField,
    description: roleDescriptionField.nullable(),
    permissions: permissionSetField,
  })
  .partial()
  .extend({ reason: adminReasonSchema })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.permissions !== undefined,
    { message: 'Change at least one of name, description or permissions.' },
  );

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

// ---------------------------------------------------------------------------
// REQ-B-07 assignment contract: `/employees/:id/access`
//
// "Admin can create roles, edit permission sets, and **assign multiple roles to
// a user**." The first two shipped with the roles screen; this is the third,
// and it hangs off the employee because that is where an administrator is
// standing when the question arises. Roles attach to the *account*, not to the
// employee record — REQ-B-02 keeps them separate, and an employee with no login
// has nothing to hold a role.
// ---------------------------------------------------------------------------

/** The login account behind an employee record, when one exists (REQ-B-02). */
export interface EmployeeAccount {
  readonly id: string;
  readonly email: string;
  readonly status: UserStatus;
  readonly lastLoginAt: string | null;
}

/**
 * One role as the assignment control reads it.
 *
 * Carries its permission keys so the screen can say what granting it actually
 * confers, rather than showing a name and leaving the reader to go and look the
 * role up on another screen. `memberCount` is deliberately absent: it is a
 * property of the role, not of this person's hold on it, and it would go stale
 * the moment this endpoint granted or revoked one.
 */
export interface AssignedRole {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly permissions: readonly PermissionKey[];
}

export interface EmployeeAccess {
  readonly employeeId: string;
  /** Null for an employee who has never been invited (REQ-A-06 imports). */
  readonly account: EmployeeAccount | null;
  readonly roles: readonly AssignedRole[];
}

/**
 * One role at a time, not a set.
 *
 * The permission set on a role is replaced wholesale because two administrators
 * composing deltas would produce a set neither chose. Membership is the
 * opposite case: each grant and each revoke has to be judged against the
 * REQ-B-07 last-holder invariant on its own, and a wholesale set that failed
 * halfway would have already applied the earlier half.
 */
export const assignRoleSchema = z.object({
  roleId: z.uuid(),
  reason: adminReasonSchema,
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const setCredentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleId: z.string().uuid().optional(),
  reason: adminReasonSchema.optional(),
});

export type SetCredentialsInput = z.infer<typeof setCredentialsSchema>;
