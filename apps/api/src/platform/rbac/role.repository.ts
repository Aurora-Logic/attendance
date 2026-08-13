import type { PermissionKey, RoleSummary } from '@vyuha/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../db/db.provider.js';
import { permissions, rolePermissions, roles, userRoles, users } from '../db/schema/index.js';
import type { OrgContext } from '../db/scoped-repository.js';

/**
 * Reads and writes for `roles` (REQ-B-07).
 *
 * Not a `ScopedRepository` subclass: every read here is an aggregate over three
 * join tables, and the base class covers single-table selects. The rule it
 * exists to enforce is kept by hand and stated on every statement — `org_id`
 * from `ctx` and `deleted_at IS NULL` — with the one deliberate exception being
 * `findDeleted`, which selects *for* deletedness so the recycle bin can restore
 * a role.
 *
 * Permission sets are not written here. `RbacAdminService.setRolePermissions`
 * owns that, because it also owns the REQ-B-07 invariant that the last
 * `roles.manage` holder cannot be stripped, and splitting the write from the
 * check is how the check gets skipped.
 */
export class RoleRepository {
  constructor(
    private readonly db: Database,
    private readonly ctx: OrgContext,
  ) {}

  /**
   * Every live role with its permission keys and its active membership.
   *
   * Two aggregates in one pass rather than N+1 queries per role. `count(DISTINCT
   * ...)` on the users join rather than `count(*)`: a user holding the role
   * through two paths would otherwise be counted twice, and an administrator
   * reading "3 members" of a two-person role has no way to tell it is wrong.
   */
  async list(): Promise<RoleSummary[]> {
    const rows = await this.db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
        permissions: sql<
          string[]
        >`coalesce(array_agg(DISTINCT ${permissions.key}) FILTER (WHERE ${permissions.key} IS NOT NULL), '{}')`,
        memberCount: sql<number>`count(DISTINCT ${users.id})::int`,
      })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .leftJoin(userRoles, eq(userRoles.roleId, roles.id))
      .leftJoin(
        users,
        and(
          eq(users.id, userRoles.userId),
          eq(users.orgId, this.ctx.orgId),
          eq(users.status, 'ACTIVE'),
          isNull(users.deletedAt),
        ),
      )
      .where(and(eq(roles.orgId, this.ctx.orgId), isNull(roles.deletedAt)))
      .groupBy(roles.id, roles.name, roles.description, roles.isSystem)
      .orderBy(asc(roles.name));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      // Sorted so two reads of an unchanged role are byte-identical:
      // `array_agg` has no order of its own and the audit diff compares JSON.
      permissions: [...row.permissions].sort() as PermissionKey[],
      memberCount: row.memberCount,
    }));
  }

  async summary(id: string): Promise<RoleSummary | null> {
    const all = await this.list();
    return all.find((role) => role.id === id) ?? null;
  }

  async findLive(id: string): Promise<{ id: string; name: string; isSystem: boolean } | null> {
    const rows = await this.db
      .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
      .from(roles)
      .where(and(eq(roles.orgId, this.ctx.orgId), eq(roles.id, id), isNull(roles.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Case-insensitive: "admin" and "Admin" must not both exist. */
  async findIdByName(name: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(
          eq(roles.orgId, this.ctx.orgId),
          sql`lower(${roles.name}) = lower(${name})`,
          isNull(roles.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async insert(input: { name: string; description: string | null }): Promise<string> {
    const now = new Date();
    const rows = await this.db
      .insert(roles)
      .values({
        orgId: this.ctx.orgId,
        name: input.name,
        description: input.description,
        // Never from a request. A caller who could set this would be able to
        // mint a role that the delete and rename guards then refuse to touch.
        isSystem: false,
        createdAt: now,
        updatedAt: now,
        createdBy: this.ctx.actorUserId,
        updatedBy: this.ctx.actorUserId,
      })
      .returning({ id: roles.id });

    const row = rows[0];
    if (row === undefined) throw new Error('Role insert returned no row.');
    return row.id;
  }

  async updateFields(
    id: string,
    values: { name?: string; description?: string | null },
  ): Promise<boolean> {
    if (values.name === undefined && values.description === undefined) return true;

    const rows = await this.db
      .update(roles)
      .set({ ...values, updatedAt: new Date(), updatedBy: this.ctx.actorUserId })
      .where(and(eq(roles.orgId, this.ctx.orgId), eq(roles.id, id), isNull(roles.deletedAt)))
      .returning({ id: roles.id });
    return rows.length > 0;
  }

}
