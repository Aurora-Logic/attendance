import {
  PERMISSIONS,
  SYSTEM_ROLES,
  type EmployeeAccess,
  type RoleSummary,
} from '@vyuha/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * REQ-B-07's assignment half, over real HTTP.
 *
 * The acceptance the requirement names -- "a new role created in the UI grants
 * and denies correctly" -- could not be exercised before these routes existed,
 * because nothing could hand a created role to anybody (OPEN-QUESTIONS P2-3).
 * The test that matters most here is the last one in the first block: stripping
 * the final `roles.manage` holder through this new path must be refused by the
 * invariant that already lives in `RbacAdminService`, and must roll back rather
 * than merely report.
 */

/**
 * Unique across the suite. `ApiHarness.start` truncates the organisation it is
 * given, so two files sharing an id delete each other's fixtures -- and this
 * one shared `…e7` with the reports suite, whose employees have punched.
 * `punches.employee_id` is RESTRICT and `punches` is append-only, so the
 * employee delete failed and took the whole file down with it. Isolated, it
 * passed; in the suite, it did not. `org-ids.test.ts` now makes the collision
 * a failing test rather than a mystery.
 */
const ORG_ID = '01900000-0000-7000-8000-0000000000b7';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let harness: ApiHarness;
let adminToken: string;
let hrToken: string;
let adminRoleId = '';
let employeeRoleId = '';

/** The administrator's own employee record, and the account joined to it. */
let adminEmployeeId = '';
/** Somebody with a login and one ordinary role. */
let staffEmployeeId = '';
/** REQ-A-06 shape: an employee record with no login at all. */
let unlinkedEmployeeId = '';

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Employee Access Fixture Org');

  adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE, { isSystem: true });
  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR, { isSystem: true });

  adminEmployeeId = await harness.createEmployee({ code: 'ACC-ADMIN', firstName: 'Nikhil' });
  staffEmployeeId = await harness.createEmployee({
    code: 'ACC-STAFF',
    firstName: 'Asha',
    lastName: 'Menon',
  });
  unlinkedEmployeeId = await harness.createEmployee({ code: 'ACC-NOLOGIN', firstName: 'Imported' });

  const admin = await harness.createUser({
    email: scopedEmail('access-admin'),
    roleIds: [adminRoleId],
    employeeId: adminEmployeeId,
  });
  await harness.createUser({
    email: scopedEmail('access-staff'),
    roleIds: [employeeRoleId],
    employeeId: staffEmployeeId,
  });
  const hr = await harness.createUser({ email: scopedEmail('access-hr'), roleIds: [hrRoleId] });

  adminToken = (await harness.login(admin.email, admin.password)).token;
  hrToken = (await harness.login(hr.email, hr.password)).token;
  expect(adminToken).not.toBe('');
  expect(hrToken).not.toBe('');
}, 30_000);

afterAll(async () => {
  await harness.close();
});

describe('GET /employees/:id/access', () => {
  it('returns the login account and the roles it holds', async () => {
    const read = await harness.get<EmployeeAccess>(`/employees/${staffEmployeeId}/access`, {
      token: adminToken,
    });

    expect(read.status, read.text).toBe(200);
    expect(read.body.account?.status).toBe('ACTIVE');
    expect(read.body.roles.map((role) => role.name)).toEqual(['Employee']);
    // The keys travel with the role so the screen can say what granting it
    // confers, rather than sending the reader to another screen.
    expect(read.body.roles[0]?.permissions).toContain(PERMISSIONS.PUNCH_SELF);
  });

  it('says an employee has no account rather than pretending they have no roles', async () => {
    const read = await harness.get<EmployeeAccess>(`/employees/${unlinkedEmployeeId}/access`, {
      token: adminToken,
    });

    expect(read.status, read.text).toBe(200);
    expect(read.body.account).toBeNull();
    expect(read.body.roles).toEqual([]);
  });

  it('refuses a caller without roles.manage, even one who can edit the employee', async () => {
    // HR holds employee.manage and can rename this person all day. Handing out
    // roles is a different key on purpose.
    const refused = await harness.get<ErrorBody>(`/employees/${staffEmployeeId}/access`, {
      token: hrToken,
    });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
  });

  it('404s an employee id that names nobody', async () => {
    const missing = await harness.get<ErrorBody>(
      '/employees/019ffb00-0000-7000-8000-00000000dead/access',
      { token: adminToken },
    );
    expect(missing.status).toBe(404);
  });
});

describe('POST /employees/:id/access/roles', () => {
  it('refuses without a reason', async () => {
    const refused = await harness.post<ErrorBody>(`/employees/${staffEmployeeId}/access/roles`, {
      token: adminToken,
      body: { roleId: adminRoleId },
    });
    expect(refused.status, refused.text).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('grants a role and writes it to the trail against the employee', async () => {
    const granted = await harness.post<EmployeeAccess>(
      `/employees/${staffEmployeeId}/access/roles`,
      {
        token: adminToken,
        body: { roleId: adminRoleId, reason: 'Covering role administration while Nikhil is away' },
      },
    );

    expect(granted.status, granted.text).toBe(200);
    expect(granted.body.roles.map((role) => role.name).sort()).toEqual(['Admin', 'Employee']);
    expect(await harness.waitForAuditAction('user.role_assigned')).toBe(true);
    expect(await harness.waitForAuditEntity(staffEmployeeId)).toBe(true);
  });

  it('is idempotent, so a double press does not duplicate the membership', async () => {
    const again = await harness.post<EmployeeAccess>(`/employees/${staffEmployeeId}/access/roles`, {
      token: adminToken,
      body: { roleId: adminRoleId, reason: 'Pressing the same button a second time' },
    });

    expect(again.status, again.text).toBe(200);
    expect(again.body.roles.filter((role) => role.name === 'Admin')).toHaveLength(1);
  });

  it('refuses an employee who has no login to hold the role', async () => {
    const refused = await harness.post<ErrorBody>(
      `/employees/${unlinkedEmployeeId}/access/roles`,
      {
        token: adminToken,
        body: { roleId: employeeRoleId, reason: 'Trying to grant a role to a record with no login' },
      },
    );

    expect(refused.status, refused.text).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
    expect(refused.body.error.message).toContain('no login account');
  });

  it('404s a role id from outside this organisation', async () => {
    const refused = await harness.post<ErrorBody>(`/employees/${staffEmployeeId}/access/roles`, {
      token: adminToken,
      body: {
        roleId: '019ffb00-0000-7000-8000-00000000beef',
        reason: 'Attaching a role this organisation does not own',
      },
    });
    expect(refused.status, refused.text).toBe(404);
  });

  it('refuses a caller without roles.manage', async () => {
    const refused = await harness.post<ErrorBody>(`/employees/${staffEmployeeId}/access/roles`, {
      token: hrToken,
      body: { roleId: adminRoleId, reason: 'HR should not be able to mint an administrator' },
    });
    expect(refused.status).toBe(403);
  });
});

describe('DELETE /employees/:id/access/roles/:roleId', () => {
  it('revokes an ordinary role', async () => {
    const revoked = await harness.del<EmployeeAccess>(
      `/employees/${staffEmployeeId}/access/roles/${employeeRoleId}`,
      { token: adminToken, body: { reason: 'Asha moved to a contractor arrangement' } },
    );

    expect(revoked.status, revoked.text).toBe(200);
    expect(revoked.body.roles.map((role) => role.name)).toEqual(['Admin']);
    expect(await harness.waitForAuditAction('user.role_removed')).toBe(true);
  });

  it('refuses without a reason', async () => {
    const refused = await harness.del<ErrorBody>(
      `/employees/${staffEmployeeId}/access/roles/${adminRoleId}`,
      { token: adminToken, body: {} },
    );
    expect(refused.status, refused.text).toBe(400);
  });

  it('refuses a caller without roles.manage', async () => {
    const refused = await harness.del<ErrorBody>(
      `/employees/${staffEmployeeId}/access/roles/${adminRoleId}`,
      { token: hrToken, body: { reason: 'HR should not be able to do this either' } },
    );
    expect(refused.status).toBe(403);
  });
});

/**
 * The reason this whole slice had to be built carefully.
 *
 * `RbacAdminService` already enforces "the last account holding `roles.manage`
 * cannot be stripped of it" inside a locking transaction, and the roles screen
 * goes through it. A new endpoint that wrote `user_roles` itself would be a
 * second door with no lock on it, and the invariant would hold in one place and
 * not the other. These two tests are what "goes through the service" means.
 */
describe('REQ-B-07: the last roles.manage holder, through the new endpoint', () => {
  it('allows the second-to-last holder to be stripped', async () => {
    // Asha still holds Admin from the block above; so does Nikhil. Two holders.
    const revoked = await harness.del<EmployeeAccess>(
      `/employees/${staffEmployeeId}/access/roles/${adminRoleId}`,
      { token: adminToken, body: { reason: 'Nikhil is back from leave and has the role again' } },
    );

    expect(revoked.status, revoked.text).toBe(200);
    expect(revoked.body.roles).toEqual([]);
  });

  it('refuses to strip the last holder, and rolls back rather than reporting', async () => {
    const refused = await harness.del<ErrorBody>(
      `/employees/${adminEmployeeId}/access/roles/${adminRoleId}`,
      {
        token: adminToken,
        body: { reason: 'Trying to lock the whole organisation out of role management' },
      },
    );

    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.error.code).toBe('LAST_ROLES_MANAGE_HOLDER');

    // Reported is not enough. If the delete had run and only the message were
    // right, the row would already be gone and the caller's next request would
    // be a 403 from their own account.
    const after = await harness.get<EmployeeAccess>(`/employees/${adminEmployeeId}/access`, {
      token: adminToken,
    });
    expect(after.status, after.text).toBe(200);
    expect(after.body.roles.map((role) => role.name)).toEqual(['Admin']);

    // And the account still works, which is the fact the invariant exists for.
    const roles = await harness.get<{ data: RoleSummary[] }>('/roles', { token: adminToken });
    expect(roles.status).toBe(200);
  });
});
