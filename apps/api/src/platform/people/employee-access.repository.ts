import type { AssignedRole, EmployeeAccount, PermissionKey } from '@vyuha/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../db/db.provider.js';
import {
  employees,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../db/schema/index.js';
import type { OrgContext } from '../db/scoped-repository.js';

/**
 * The reads behind `/employees/:id/access` (REQ-B-07).
 *
 * Not a `ScopedRepository` subclass, for the same reason `RoleRepository` is
 * not: both queries aggregate over three join tables and the base class covers
 * single-table selects. The rule it enforces is kept by hand and stated on
 * every statement -- `org_id` from `ctx`, `deleted_at IS NULL` -- so a row from
 * another organisation never enters the process.
 *
 * Nothing here writes. Membership is written by `RbacAdminService`, which owns
 * the REQ-B-07 last-holder invariant; a write here would be a second path to
 * the same table with none of the checks.
 */
export class EmployeeAccessRepository {
  constructor(
    private readonly db: Database,
    private readonly ctx: OrgContext,
  ) {}

  /**
   * That the employee exists in this organisation, and their name for the
   * audit entry.
   *
   * Deliberately org-scoped rather than team-scoped, unlike every other read of
   * `employees`. The route already requires `roles.manage`, which is the key
   * that lets its holder grant themselves any other key -- narrowing *which*
   * people they may grant to would be theatre, and it would leave a
   * `roles.manage` holder without `employee.view` unable to assign a role to
   * anybody while still being able to grant themselves the view key first.
   */
  async findEmployee(id: string): Promise<{ id: string; label: string } | null> {
    const rows = await this.db
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(
        and(
          eq(employees.orgId, this.ctx.orgId),
          eq(employees.id, id),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;
    const name = row.lastName === null ? row.firstName : `${row.firstName} ${row.lastName}`;
    return { id: row.id, label: `${row.employeeCode} ${name}` };
  }

  /** The living login joined 1:1 to this employee (REQ-B-02), or null. */
  async findAccount(employeeId: string): Promise<EmployeeAccount | null> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(
        and(
          eq(users.orgId, this.ctx.orgId),
          eq(users.employeeId, employeeId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      email: row.email,
      status: row.status,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    };
  }

  /**
   * The roles this account holds, each with its permission keys.
   *
   * `array_agg` has no order of its own, so the keys are sorted here -- two
   * reads of an unchanged assignment have to be byte-identical, because the
   * audit diff compares JSON and an unstable order would report a change on
   * every write.
   */
  async rolesOf(userId: string): Promise<AssignedRole[]> {
    const rows = await this.db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
        permissions: sql<
          string[]
        >`coalesce(array_agg(DISTINCT ${permissions.key}) FILTER (WHERE ${permissions.key} IS NOT NULL), '{}')`,
      })
      .from(userRoles)
      .innerJoin(
        roles,
        and(
          eq(roles.id, userRoles.roleId),
          eq(roles.orgId, this.ctx.orgId),
          isNull(roles.deletedAt),
        ),
      )
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId))
      .groupBy(roles.id, roles.name, roles.description, roles.isSystem)
      .orderBy(asc(roles.name));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      permissions: [...row.permissions].sort() as PermissionKey[],
    }));
  }

  /** A live role in this organisation, or null. Guards against another org's id. */
  async findRole(roleId: string): Promise<{ id: string; name: string } | null> {
    const rows = await this.db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(
        and(eq(roles.orgId, this.ctx.orgId), eq(roles.id, roleId), isNull(roles.deletedAt)),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
