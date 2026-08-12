import { IRREVOCABLE_LAST_HOLDER_PERMISSION, PERMISSIONS, SYSTEM_ROLES } from '@vyuha/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import { AppError } from '../common/errors.js';
import { rolePermissions, userRoles, users } from '../db/schema/index.js';
import { RbacAdminService } from './rbac-admin.service.js';

/**
 * REQ-B-07: "The last account holding `roles.manage` cannot be stripped of it."
 *
 * Both routes to stripping it are exercised. Removing the role from the user
 * is the obvious one; removing the permission from the role is the one that
 * would lock out every administrator at once, and is the one a guard written
 * only against the first would miss entirely.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000a2';

let harness: ApiHarness;
let rbac: RbacAdminService;
let adminRoleId: string;
let plainRoleId: string;

async function failureCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('Expected the operation to be refused.');
}

async function holdsRolesManage(userId: string): Promise<boolean> {
  const count = await rbac.countHolders(harness.db, ORG_ID, IRREVOCABLE_LAST_HOLDER_PERMISSION);
  const rows = await harness.db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, adminRoleId)));
  return count > 0 && rows.length > 0;
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'RBAC Fixture Org');
  rbac = new RbacAdminService(harness.db);
}, 30_000);

beforeEach(async () => {
  await harness.resetOrganisation('RBAC Fixture Org');
  adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN);
  plainRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);
});

afterAll(async () => {
  await harness.close();
});

describe('REQ-B-07: the last roles.manage holder', () => {
  it('refuses to remove the Admin role from the only administrator', async () => {
    const admin = await harness.createUser({
      email: scopedEmail('sole-admin'),
      roleIds: [adminRoleId],
    });

    expect(await rbac.countHolders(harness.db, ORG_ID, PERMISSIONS.ROLES_MANAGE)).toBe(1);

    const code = await failureCode(() => rbac.removeRoleFromUser(ORG_ID, admin.id, adminRoleId));
    expect(code).toBe('LAST_ROLES_MANAGE_HOLDER');

    // The refusal has to have rolled back, not merely reported. Without the
    // transaction the row would already be gone and only the message would be
    // right -- which is the failure mode this assertion exists for.
    expect(await holdsRolesManage(admin.id)).toBe(true);
    expect(await rbac.countHolders(harness.db, ORG_ID, PERMISSIONS.ROLES_MANAGE)).toBe(1);
  });

  it('allows removal once a second administrator exists', async () => {
    const first = await harness.createUser({
      email: scopedEmail('admin-one'),
      roleIds: [adminRoleId],
    });
    const second = await harness.createUser({
      email: scopedEmail('admin-two'),
      roleIds: [adminRoleId],
    });

    expect(await rbac.countHolders(harness.db, ORG_ID, PERMISSIONS.ROLES_MANAGE)).toBe(2);

    await rbac.removeRoleFromUser(ORG_ID, first.id, adminRoleId);

    expect(await holdsRolesManage(first.id)).toBe(false);
    expect(await holdsRolesManage(second.id)).toBe(true);

    // And now the second one is the last, so it is protected in turn.
    expect(await failureCode(() => rbac.removeRoleFromUser(ORG_ID, second.id, adminRoleId))).toBe(
      'LAST_ROLES_MANAGE_HOLDER',
    );
  });

  it('refuses to remove roles.manage from the role itself', async () => {
    const admin = await harness.createUser({
      email: scopedEmail('perm-admin'),
      roleIds: [adminRoleId],
    });
    expect(admin.id).toBeTruthy();

    const withoutRolesManage = [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUDIT_VIEW];
    const code = await failureCode(() =>
      rbac.setRolePermissions(ORG_ID, adminRoleId, withoutRolesManage),
    );
    expect(code).toBe('LAST_ROLES_MANAGE_HOLDER');

    // The whole replace must have rolled back, including the permissions the
    // call *did* want to keep.
    const remaining = await harness.db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, adminRoleId));
    expect(remaining.length).toBeGreaterThan(withoutRolesManage.length);
    expect(await rbac.countHolders(harness.db, ORG_ID, PERMISSIONS.ROLES_MANAGE)).toBe(1);
  });

  it('allows editing the role when another role still carries roles.manage', async () => {
    const admin = await harness.createUser({
      email: scopedEmail('multi-admin'),
      roleIds: [adminRoleId],
    });
    const backupRoleId = await harness.createRole('Backup Owner', [PERMISSIONS.ROLES_MANAGE]);
    await rbac.assignRoleToUser(ORG_ID, admin.id, backupRoleId);

    await rbac.setRolePermissions(ORG_ID, adminRoleId, [PERMISSIONS.SETTINGS_MANAGE]);

    const remaining = await harness.db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, adminRoleId));
    expect(remaining).toHaveLength(1);
    expect(await rbac.countHolders(harness.db, ORG_ID, PERMISSIONS.ROLES_MANAGE)).toBe(1);
  });

  it('does not count a suspended account as a holder', async () => {
    const active = await harness.createUser({
      email: scopedEmail('active-admin'),
      roleIds: [adminRoleId],
    });
    const suspended = await harness.createUser({
      email: scopedEmail('suspended-admin'),
      roleIds: [adminRoleId],
      status: 'SUSPENDED',
    });
    expect(suspended.id).toBeTruthy();

    // Two rows hold the role; only one of them can sign in. Counting the
    // suspended one would satisfy the invariant while leaving the
    // organisation locked out, which is exactly what REQ-B-07 prevents.
    expect(await rbac.countHolders(harness.db, ORG_ID, PERMISSIONS.ROLES_MANAGE)).toBe(1);
    expect(await failureCode(() => rbac.removeRoleFromUser(ORG_ID, active.id, adminRoleId))).toBe(
      'LAST_ROLES_MANAGE_HOLDER',
    );
  });

  it('does not count a soft-deleted account as a holder', async () => {
    const active = await harness.createUser({
      email: scopedEmail('living-admin'),
      roleIds: [adminRoleId],
    });
    const deleted = await harness.createUser({
      email: scopedEmail('deleted-admin'),
      roleIds: [adminRoleId],
    });
    await harness.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted.id));

    expect(await rbac.countHolders(harness.db, ORG_ID, PERMISSIONS.ROLES_MANAGE)).toBe(1);
    expect(await failureCode(() => rbac.removeRoleFromUser(ORG_ID, active.id, adminRoleId))).toBe(
      'LAST_ROLES_MANAGE_HOLDER',
    );
  });
});

describe('RbacAdminService ordinary edits', () => {
  it('leaves an unrelated role free to be emptied', async () => {
    const admin = await harness.createUser({
      email: scopedEmail('untouched-admin'),
      roleIds: [adminRoleId],
    });
    const employee = await harness.createUser({
      email: scopedEmail('employee'),
      roleIds: [plainRoleId],
    });
    expect(admin.id).toBeTruthy();

    await rbac.setRolePermissions(ORG_ID, plainRoleId, []);
    await rbac.removeRoleFromUser(ORG_ID, employee.id, plainRoleId);

    const rows = await harness.db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, employee.id));
    expect(rows).toEqual([]);
  });

  it('is idempotent when assigning a role twice', async () => {
    const employee = await harness.createUser({ email: scopedEmail('twice') });
    await rbac.assignRoleToUser(ORG_ID, employee.id, plainRoleId);
    await rbac.assignRoleToUser(ORG_ID, employee.id, plainRoleId);

    const rows = await harness.db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, employee.id));
    expect(rows).toHaveLength(1);
  });

  it('rejects a permission key that is not in the catalogue', async () => {
    const code = await failureCode(() =>
      // Deliberately defeating the type: the runtime guard exists for a stale
      // client or a hand-written request, not for a well-typed call site.
      rbac.setRolePermissions(ORG_ID, plainRoleId, ['not.a.real.permission'] as never),
    );
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('rejects a role from another organisation', async () => {
    const code = await failureCode(() =>
      rbac.setRolePermissions(ORG_ID, '01900000-0000-7000-8000-00000000ffff', []),
    );
    expect(code).toBe('NOT_FOUND');
  });
});
