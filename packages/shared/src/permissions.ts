/**
 * Permission keys and the seed role matrix from PRD §2.1.
 *
 * PRD §2: "Roles are not hardcoded into logic. They are named bundles of
 * permissions." Nothing in this codebase may branch on a role name — every
 * check goes through a key defined here.
 */

export const PERMISSIONS = {
  PUNCH_SELF: 'punch.self',

  ATTENDANCE_VIEW_SELF: 'attendance.view.self',
  ATTENDANCE_VIEW_TEAM: 'attendance.view.team',
  ATTENDANCE_VIEW_ALL: 'attendance.view.all',
  ATTENDANCE_EDIT: 'attendance.edit',
  ATTENDANCE_LOCK: 'attendance.lock',

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
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.ROLES_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.INTEGRATION_MANAGE,
] as const satisfies readonly PermissionKey[];

/**
 * Seed only. Admin can edit any of these in the UI afterwards (REQ-B-07), so
 * this matrix is a starting point, not an invariant the code may rely on.
 */
export const ROLE_PERMISSION_MATRIX: Record<SystemRoleName, readonly PermissionKey[]> = {
  Employee: EMPLOYEE_PERMISSIONS,
  Operations: OPERATIONS_PERMISSIONS,
  HR: HR_PERMISSIONS,
  Admin: ADMIN_PERMISSIONS,
};

/**
 * REQ-B-07: "The last account holding roles.manage cannot be stripped of it."
 * Exported so the guard that enforces it names the same constant the seed does.
 */
export const IRREVOCABLE_LAST_HOLDER_PERMISSION = PERMISSIONS.ROLES_MANAGE;
