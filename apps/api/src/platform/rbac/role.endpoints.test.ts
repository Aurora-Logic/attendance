import { PERMISSIONS, SYSTEM_ROLES, type RoleSummary } from '@vyuha/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * REQ-B-07 over real HTTP: roles as editable bundles, and the two things a
 * seeded role refuses.
 *
 * P2-3 recorded that `PATCH /roles` did not exist and that the screen said so.
 * These tests are what "exists" means — including the parts that must keep
 * refusing, because a writable role endpoint is the single easiest way to lock
 * an organisation out of its own system.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000d5';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const REASON = 'Operations took over the monthly export';

let harness: ApiHarness;
let adminToken: string;
let hrToken: string;
let adminRoleId = '';
let operationsRoleId = '';

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Roles Fixture Org');

  // `isSystem: true` because that is what the seed writes, and the protection
  // under test would otherwise pass by having nothing to protect.
  adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  operationsRoleId = await harness.createSystemRole(SYSTEM_ROLES.OPERATIONS, { isSystem: true });
  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR, { isSystem: true });

  const admin = await harness.createUser({
    email: scopedEmail('roles-admin'),
    roleIds: [adminRoleId],
  });
  const hr = await harness.createUser({ email: scopedEmail('roles-hr'), roleIds: [hrRoleId] });

  adminToken = (await harness.login(admin.email, admin.password)).token;
  hrToken = (await harness.login(hr.email, hr.password)).token;
  expect(adminToken).not.toBe('');
  expect(hrToken).not.toBe('');
}, 30_000);

afterAll(async () => {
  await harness.close();
});

describe('GET /roles', () => {
  it('lists roles with their permission keys and active member counts', async () => {
    const listed = await harness.get<{ data: RoleSummary[] }>('/roles', { token: adminToken });

    expect(listed.status, listed.text).toBe(200);
    const admin = listed.body.data.find((role) => role.name === 'Admin');
    expect(admin).toBeDefined();
    expect(admin?.permissions).toContain(PERMISSIONS.ROLES_MANAGE);
    // The Admin fixture account is the one member; HR's account holds HR.
    expect(admin?.memberCount).toBe(1);
    expect(admin?.isSystem).toBe(true);
  });

  it('grants Admin the new attendance.unlock key and withholds it from HR', async () => {
    const listed = await harness.get<{ data: RoleSummary[] }>('/roles', { token: adminToken });
    const byName = new Map(listed.body.data.map((role) => [role.name, role]));

    expect(byName.get('Admin')?.permissions).toContain(PERMISSIONS.ATTENDANCE_UNLOCK);
    expect(byName.get('HR')?.permissions).not.toContain(PERMISSIONS.ATTENDANCE_UNLOCK);
    expect(byName.get('HR')?.permissions).toContain(PERMISSIONS.ATTENDANCE_LOCK);
  });

  it('refuses a caller without roles.manage', async () => {
    const refused = await harness.get<ErrorBody>('/roles', { token: hrToken });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /roles', () => {
  let auditorRoleId = '';

  it('refuses without a reason', async () => {
    const refused = await harness.post<ErrorBody>('/roles', {
      token: adminToken,
      body: { name: 'Auditor', permissions: [PERMISSIONS.AUDIT_VIEW] },
    });
    expect(refused.status, refused.text).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a one-character reason', async () => {
    const refused = await harness.post<ErrorBody>('/roles', {
      token: adminToken,
      body: { name: 'Auditor', permissions: [], reason: 'x' },
    });
    expect(refused.status, refused.text).toBe(400);
  });

  it('creates a custom role and writes the reason to the trail', async () => {
    const created = await harness.post<RoleSummary>('/roles', {
      token: adminToken,
      body: {
        name: 'Auditor',
        description: 'Reads the trail, changes nothing',
        permissions: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.REPORT_VIEW],
        reason: 'External audit starts next month',
      },
    });

    expect(created.status, created.text).toBe(201);
    expect(created.body.isSystem).toBe(false);
    expect(created.body.permissions).toEqual(['audit.view', 'report.view']);
    expect(created.body.memberCount).toBe(0);
    auditorRoleId = created.body.id;

    expect(await harness.waitForAuditAction('role.created')).toBe(true);
  });

  it('refuses a duplicate name', async () => {
    const refused = await harness.post<ErrorBody>('/roles', {
      token: adminToken,
      body: { name: 'Auditor', permissions: [], reason: 'Trying the same name twice' },
    });
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.error.code).toBe('CONFLICT');
  });

  it('cannot be told to create a system role', async () => {
    const created = await harness.post<RoleSummary & { isSystem: boolean }>('/roles', {
      token: adminToken,
      body: {
        name: 'Pretender',
        permissions: [],
        reason: 'Checking that isSystem is not settable',
        // Not in the schema. If it were honoured, the role would become
        // undeletable through a field the client chose.
        isSystem: true,
      },
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body.isSystem).toBe(false);
  });

  describe('PATCH /roles/:id', () => {
    it('refuses without a reason', async () => {
      const refused = await harness.patch<ErrorBody>(`/roles/${auditorRoleId}`, {
        token: adminToken,
        body: { permissions: [PERMISSIONS.AUDIT_VIEW] },
      });
      expect(refused.status, refused.text).toBe(400);
    });

    it('replaces the permission set wholesale', async () => {
      const updated = await harness.patch<RoleSummary>(`/roles/${auditorRoleId}`, {
        token: adminToken,
        body: {
          permissions: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.REPORT_EXPORT],
          reason: 'Auditor now pulls their own extracts',
        },
      });

      expect(updated.status, updated.text).toBe(200);
      // report.view is gone because it was not sent: a set, not a delta.
      expect(updated.body.permissions).toEqual(['audit.view', 'report.export']);
      expect(await harness.waitForAuditAction('role.updated')).toBe(true);
    });

    it('renames a custom role', async () => {
      const updated = await harness.patch<RoleSummary>(`/roles/${auditorRoleId}`, {
        token: adminToken,
        body: { name: 'External Auditor', reason: 'Distinguishing them from internal audit' },
      });
      expect(updated.status, updated.text).toBe(200);
      expect(updated.body.name).toBe('External Auditor');
      // Renaming must not disturb the permission set.
      expect(updated.body.permissions).toEqual(['audit.view', 'report.export']);
    });

    it('edits a seeded role’s permissions, which REQ-B-07 allows', async () => {
      const updated = await harness.patch<RoleSummary>(`/roles/${operationsRoleId}`, {
        token: adminToken,
        body: {
          permissions: [PERMISSIONS.ATTENDANCE_VIEW_TEAM, PERMISSIONS.REPORT_VIEW],
          reason: REASON,
        },
      });
      expect(updated.status, updated.text).toBe(200);
      expect(updated.body.permissions).toEqual(['attendance.view.team', 'report.view']);
    });

    it('refuses to rename a seeded role', async () => {
      const refused = await harness.patch<ErrorBody>(`/roles/${operationsRoleId}`, {
        token: adminToken,
        body: { name: 'Ops', reason: 'Shorter name on the sidebar' },
      });
      expect(refused.status, refused.text).toBe(403);
      expect(refused.body.error.code).toBe('SYSTEM_ROLE_PROTECTED');
    });

    it('refuses to strip roles.manage from the last role that has it', async () => {
      const refused = await harness.patch<ErrorBody>(`/roles/${adminRoleId}`, {
        token: adminToken,
        body: {
          permissions: [PERMISSIONS.ATTENDANCE_VIEW_ALL],
          reason: 'Trying to lock everybody out of role management',
        },
      });

      expect(refused.status, refused.text).toBe(409);
      expect(refused.body.error.code).toBe('LAST_ROLES_MANAGE_HOLDER');

      // Rolled back, not partially applied: the whole point of doing the
      // count inside the transaction.
      const listed = await harness.get<{ data: RoleSummary[] }>('/roles', { token: adminToken });
      const admin = listed.body.data.find((role) => role.id === adminRoleId);
      expect(admin?.permissions).toContain(PERMISSIONS.ROLES_MANAGE);
    });

    it('refuses a caller without roles.manage', async () => {
      const refused = await harness.patch<ErrorBody>(`/roles/${auditorRoleId}`, {
        token: hrToken,
        body: { permissions: [], reason: 'HR should not be able to do this' },
      });
      expect(refused.status).toBe(403);
    });

    it('404s an unknown role rather than creating one', async () => {
      const missing = await harness.patch<ErrorBody>(
        '/roles/019ffb00-0000-7000-8000-00000000dead',
        { token: adminToken, body: { permissions: [], reason: 'Should not reach anything' } },
      );
      expect(missing.status).toBe(404);
    });
  });

  describe('DELETE /masters/role/:id', () => {
    it('refuses to delete a seeded role', async () => {
      const refused = await harness.del<ErrorBody>(`/masters/role/${adminRoleId}`, {
        token: adminToken,
        body: { reason: 'Trying to remove the Admin role entirely' },
      });
      expect(refused.status, refused.text).toBe(403);
      expect(refused.body.error.code).toBe('SYSTEM_ROLE_PROTECTED');
    });

    it('refuses while an active account still holds the role, and names it', async () => {
      const held = await harness.post<RoleSummary>('/roles', {
        token: adminToken,
        body: { name: 'Held Role', permissions: [], reason: 'Fixture for the in-use refusal' },
      });
      expect(held.status, held.text).toBe(201);

      const holder = await harness.createUser({
        email: scopedEmail('roles-holder'),
        roleIds: [held.body.id],
      });

      const refused = await harness.del<ErrorBody>(`/masters/role/${held.body.id}`, {
        token: adminToken,
        body: { reason: 'Should be refused while somebody holds it' },
      });

      expect(refused.status, refused.text).toBe(409);
      expect(refused.body.error.code).toBe('RECORD_IN_USE');
      // Which rows, not just "in use".
      expect(refused.body.error.message).toContain(holder.email);
    });

    it('deletes an unheld custom role and puts it in the bin', async () => {
      const removed = await harness.del<{ deleted: boolean; name: string }>(
        `/masters/role/${auditorRoleId}`,
        { token: adminToken, body: { reason: 'The external audit finished in March' } },
      );

      expect(removed.status, removed.text).toBe(200);
      expect(removed.body.deleted).toBe(true);

      const listed = await harness.get<{ data: RoleSummary[] }>('/roles', { token: adminToken });
      expect(listed.body.data.some((role) => role.id === auditorRoleId)).toBe(false);

      expect(await harness.waitForAuditAction('role.deleted')).toBe(true);
    });

    it('restores it, permissions intact', async () => {
      const restored = await harness.post<{ deleted: boolean }>(
        `/masters/role/${auditorRoleId}/restore`,
        { token: adminToken, body: { reason: 'The audit was extended by a quarter' } },
      );
      expect(restored.status, restored.text).toBe(201);

      const listed = await harness.get<{ data: RoleSummary[] }>('/roles', { token: adminToken });
      const back = listed.body.data.find((role) => role.id === auditorRoleId);
      expect(back).toBeDefined();
      expect(back?.permissions).toEqual(['audit.view', 'report.export']);
    });
  });
});
