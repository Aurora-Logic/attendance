import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  SYSTEM_ROLES,
} from '@vyuha/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../src/platform/common/env.js';
import type { Database } from '../src/platform/db/db.provider.js';
import {
  organizations,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../src/platform/db/schema/index.js';
import { verifyPassword } from '../src/platform/auth/password.js';
import { runSeed, type SeedReport } from './seed.js';

/**
 * "Seeding twice must be idempotent."
 *
 * The test runs against its own organisation id rather than the real
 * `SEED_ORG_ID`, so running the suite on a developer's machine does not reset
 * the roles they have been editing. The permission catalogue is global and is
 * reconciled either way, which is exactly what the seed is for.
 */

const TEST_ORG_ID = '01900000-0000-7000-8000-0000000000b1';
const TEST_ADMIN_EMAIL = 'seed-test-admin@vyuha.test';

let pool: Pool;
let db: Database;

type CountableTable =
  | 'roles'
  | 'users'
  | 'role_permissions'
  | 'employees'
  | 'departments'
  | 'designations'
  | 'locations';

async function countRows(table: CountableTable): Promise<number> {
  const query =
    table === 'role_permissions'
      ? sql`SELECT count(*) AS count FROM role_permissions rp
              JOIN roles r ON r.id = rp.role_id WHERE r.org_id = ${TEST_ORG_ID}`
      : // The rest differ only by table name, which cannot be a bind parameter.
        // `sql.raw` is safe here and only here: the value comes from the union
        // type above, never from anything a request could influence.
        sql`SELECT count(*) AS count FROM ${sql.raw(table)} WHERE org_id = ${TEST_ORG_ID}`;

  const rows = await db.execute<{ count: string }>(query);
  return Number(rows.rows[0]?.count ?? 0);
}

function seed(): Promise<SeedReport> {
  return runSeed(db, {
    orgId: TEST_ORG_ID,
    orgName: 'Seed Idempotency Fixture',
    adminEmail: TEST_ADMIN_EMAIL,
  });
}

beforeAll(async () => {
  expect(new URL(env.DATABASE_URL).port).toBe('55432');
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  db = drizzle(pool);

  // Start from nothing, so "created: true" on the first run means something.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.orgId, TEST_ORG_ID));
  for (const user of existing) {
    await db.delete(userRoles).where(eq(userRoles.userId, user.id));
  }
  await db.delete(users).where(eq(users.orgId, TEST_ORG_ID));

  const existingRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.orgId, TEST_ORG_ID));
  for (const role of existingRoles) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
  }
  await db.delete(roles).where(eq(roles.orgId, TEST_ORG_ID));
  // The organisation row itself stays: audit_logs may reference it and the
  // table is append-only.
  await db
    .insert(organizations)
    .values({ id: TEST_ORG_ID, name: 'Seed Idempotency Fixture' })
    .onConflictDoNothing({ target: organizations.id });
});

afterAll(async () => {
  await pool.end();
});

describe('seed', () => {
  it('creates the organisation, the catalogue, the four roles, and one administrator', async () => {
    const report = await seed();

    expect(report.organization.id).toBe(TEST_ORG_ID);
    expect(report.roles.map((role) => role.name)).toEqual([
      SYSTEM_ROLES.EMPLOYEE,
      SYSTEM_ROLES.OPERATIONS,
      SYSTEM_ROLES.HR,
      SYSTEM_ROLES.ADMIN,
    ]);
    expect(report.roles.every((role) => role.created)).toBe(true);
    expect(report.admin.created).toBe(true);
    expect(report.admin.password).not.toBeNull();
    expect((report.admin.password ?? '').length).toBeGreaterThanOrEqual(20);
  });

  it('reconciles the catalogue against ALL_PERMISSIONS exactly', async () => {
    const rows = await db.select({ key: permissions.key }).from(permissions);
    const keys = rows.map((row) => row.key).sort();
    expect(keys).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('grants each role exactly the PRD §2.1 matrix', async () => {
    for (const name of Object.values(SYSTEM_ROLES)) {
      const rows = await db
        .select({ key: permissions.key })
        .from(roles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(and(eq(roles.orgId, TEST_ORG_ID), eq(roles.name, name), isNull(roles.deletedAt)));

      expect(rows.map((row) => row.key).sort(), `role ${name}`).toEqual(
        [...ROLE_PERMISSION_MATRIX[name]].sort(),
      );
    }
  });

  it('gives only Admin roles.manage, and gives Employee none of the manage keys', () => {
    // A spot check of the matrix as a statement about the product rather than
    // as a comparison of one array against another: if both the matrix and the
    // seed drifted together, the test above would still pass.
    expect(ROLE_PERMISSION_MATRIX.Admin).toContain(PERMISSIONS.ROLES_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.HR).not.toContain(PERMISSIONS.ROLES_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Operations).not.toContain(PERMISSIONS.ROLES_MANAGE);
    expect(ROLE_PERMISSION_MATRIX.Employee).toEqual([
      PERMISSIONS.PUNCH_SELF,
      PERMISSIONS.ATTENDANCE_VIEW_SELF,
      PERMISSIONS.LEAVE_APPLY_SELF,
      PERMISSIONS.REGULARIZATION_RAISE,
    ]);
  });

  it('the printed password actually works against the stored hash', async () => {
    // The report is only useful if the password it prints is the one that was
    // hashed. A mismatch here would hand the operator a credential that does
    // not sign in, and the seed would still look like it succeeded.
    const rerun = await runSeed(db, {
      orgId: '01900000-0000-7000-8000-0000000000b2',
      orgName: 'Seed Password Fixture',
      adminEmail: 'seed-password-check@vyuha.test',
    });

    expect(rerun.admin.password).not.toBeNull();
    const row = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, rerun.admin.userId));

    expect(await verifyPassword(rerun.admin.password ?? '', row[0]?.passwordHash ?? null)).toBe(true);

    await db.delete(userRoles).where(eq(userRoles.userId, rerun.admin.userId));
    await db.delete(users).where(eq(users.id, rerun.admin.userId));
  });

  it('creates the master data and links it up (REQ-A-01 … REQ-A-03)', async () => {
    // The seed ran in the first test of this file; this reads what it left.
    expect(await countRows('locations')).toBe(1);
    expect(await countRows('departments')).toBe(6);
    expect(await countRows('designations')).toBe(7);
    expect(await countRows('employees')).toBe(25);

    const linked = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM employees
           WHERE org_id = ${TEST_ORG_ID} AND reporting_manager_id IS NOT NULL`,
    );
    expect(Number(linked.rows[0]?.count ?? 0)).toBe(24);

    const heads = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM departments
           WHERE org_id = ${TEST_ORG_ID} AND head_employee_id IS NOT NULL`,
    );
    expect(Number(heads.rows[0]?.count ?? 0)).toBe(6);
  });

  it('seeds one general shift, marked as a placeholder, and points everyone at it', async () => {
    const rows = await db.execute<{ code: string; name: string; count: string }>(
      sql`SELECT code, name FROM shifts WHERE org_id = ${TEST_ORG_ID} AND deleted_at IS NULL`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.code).toBe('GEN');
    // OPEN-QUESTIONS item 2 is open. The warning has to be visible wherever the
    // shift is rendered, not only in a comment nobody reads at handover.
    expect(rows.rows[0]?.name).toContain('placeholder');

    // Without a default shift the day engine refuses the day outright, so this
    // is what makes the seeded workforce punchable at all (REQ-C-04).
    const unassigned = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM employees
           WHERE org_id = ${TEST_ORG_ID} AND deleted_at IS NULL AND default_shift_id IS NULL`,
    );
    expect(Number(unassigned.rows[0]?.count ?? 0)).toBe(0);
  });

  it('builds a hierarchy deeper than two levels, with people on notice and inactive', async () => {
    // A two-level tree would satisfy "has a reporting hierarchy" while telling
    // the team-scope resolver nothing, so the depth is asserted rather than
    // assumed. Five levels: Anita, Bharat, Farhan, Lalit, Varun.
    const depth = await db.execute<{ depth: number }>(sql`
      WITH RECURSIVE chain AS (
        SELECT id, 1 AS depth FROM employees
         WHERE org_id = ${TEST_ORG_ID} AND deleted_at IS NULL AND reporting_manager_id IS NULL
        UNION ALL
        SELECT e.id, chain.depth + 1 FROM employees e
          JOIN chain ON e.reporting_manager_id = chain.id
         WHERE e.org_id = ${TEST_ORG_ID} AND e.deleted_at IS NULL AND chain.depth < 20
      )
      SELECT max(depth)::int AS depth FROM chain
    `);
    expect(depth.rows[0]?.depth ?? 0).toBeGreaterThanOrEqual(5);

    const statuses = await db.execute<{ status: string; count: string }>(
      sql`SELECT status, count(*) AS count FROM employees
           WHERE org_id = ${TEST_ORG_ID} GROUP BY status`,
    );
    const byStatus = new Map(statuses.rows.map((row) => [row.status, Number(row.count)]));
    expect(byStatus.get('ON_NOTICE')).toBe(2);
    expect(byStatus.get('INACTIVE')).toBe(2);

    // REQ-A-05: an inactive employee without a last working date cannot be
    // reported on, and the seed must not create one.
    const undated = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM employees
           WHERE org_id = ${TEST_ORG_ID} AND status = 'INACTIVE' AND date_of_leaving IS NULL`,
    );
    expect(Number(undated.rows[0]?.count ?? 0)).toBe(0);
  });

  it('leaves the geofence and the IP allowlist unanswered (OPEN-QUESTIONS 1 and 3)', async () => {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM locations
           WHERE org_id = ${TEST_ORG_ID}
             AND (geofence_lat IS NOT NULL OR geofence_lng IS NOT NULL
                  OR array_length(ip_allowlist, 1) IS NOT NULL)`,
    );
    // A seeded coordinate would let geofenced punch look configured while
    // pointing at somewhere nobody works.
    expect(Number(rows.rows[0]?.count ?? 0)).toBe(0);
  });

  it('is idempotent: a second run changes nothing and prints no password', async () => {
    const before = {
      roles: await countRows('roles'),
      users: await countRows('users'),
      grants: await countRows('role_permissions'),
      employees: await countRows('employees'),
      departments: await countRows('departments'),
      designations: await countRows('designations'),
      locations: await countRows('locations'),
    };

    const second = await seed();

    expect(second.organization.created).toBe(false);
    expect(second.roles.every((role) => !role.created)).toBe(true);
    expect(second.roles.every((role) => role.granted === 0 && role.revoked === 0)).toBe(true);
    expect(second.permissions).toEqual({ inserted: 0, updated: 0, removed: 0 });
    expect(second.admin.created).toBe(false);
    // The most important line in this test: a re-run must not rotate a
    // credential someone is already using, and must not print one.
    expect(second.admin.password).toBeNull();
    expect(second.masterData.employees.created).toBe(0);
    expect(second.masterData.departments.created).toBe(0);
    expect(second.masterData.links).toEqual({
      reportingManagers: 0,
      departmentHeads: 0,
      defaultShifts: 0,
    });

    expect({
      roles: await countRows('roles'),
      users: await countRows('users'),
      grants: await countRows('role_permissions'),
      employees: await countRows('employees'),
      departments: await countRows('departments'),
      designations: await countRows('designations'),
      locations: await countRows('locations'),
    }).toEqual(before);
  });

  it('is idempotent a third time, and repairs drift it finds', async () => {
    const adminRole = await db
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(
          eq(roles.orgId, TEST_ORG_ID),
          eq(roles.name, SYSTEM_ROLES.ADMIN),
          isNull(roles.deletedAt),
        ),
      );
    const adminRoleId = adminRole[0]?.id ?? '';

    // Take a permission away behind the seed's back, then re-run.
    const removed = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, PERMISSIONS.AUDIT_VIEW));
    await db
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, adminRoleId),
          eq(rolePermissions.permissionId, removed[0]?.id ?? ''),
        ),
      );

    const third = await seed();
    const admin = third.roles.find((role) => role.name === SYSTEM_ROLES.ADMIN);
    expect(admin?.granted).toBe(1);
    expect(admin?.revoked).toBe(0);

    // And the run after the repair is quiet again.
    const fourth = await seed();
    expect(fourth.roles.every((role) => role.granted === 0 && role.revoked === 0)).toBe(true);
  });
});
