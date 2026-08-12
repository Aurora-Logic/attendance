import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  IRREVOCABLE_LAST_HOLDER_PERMISSION,
  type PermissionKey,
} from '@vyuha/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import {
  organizations,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../db/schema/index.js';

/**
 * Role and permission assignment, and the one invariant REQ-B-07 attaches to
 * it: "The last account holding `roles.manage` cannot be stripped of it."
 *
 * There are two ways to strip it and both are guarded here. Taking the role
 * away from the user is the obvious one. Taking the permission out of the role
 * is the one that gets forgotten, and it is worse, because it can lock every
 * administrator out at once rather than one at a time.
 *
 * The check is done by making the change inside a transaction and counting
 * afterwards, rather than by predicting the outcome. Predicting means writing
 * the membership rules twice -- once to apply them and once to simulate them --
 * and the simulation is the copy that drifts.
 */

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class RbacAdminService {
  private readonly logger = new Logger(RbacAdminService.name);

  constructor(@InjectDatabase() private readonly db: Database) {}

  async assignRoleToUser(orgId: string, userId: string, roleId: string): Promise<void> {
    await this.db
      .insert(userRoles)
      .values({ userId, roleId })
      .onConflictDoNothing({ target: [userRoles.userId, userRoles.roleId] });
    this.logger.log({ msg: 'Role assigned', orgId, userId, roleId });
  }

  /** Refuses when it would leave the organisation with no `roles.manage` holder. */
  async removeRoleFromUser(orgId: string, userId: string, roleId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockOrganisation(tx, orgId);
      await tx
        .delete(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
      await this.assertLastHolderSurvives(tx, orgId, {
        action: 'remove this role from this user',
      });
    });
    this.logger.log({ msg: 'Role removed', orgId, userId, roleId });
  }

  /**
   * Replaces a role's permission set wholesale. REQ-B-07 makes roles editable
   * bundles, so this is the normal edit path, not an administrative escape
   * hatch.
   */
  async setRolePermissions(
    orgId: string,
    roleId: string,
    keys: readonly PermissionKey[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockOrganisation(tx, orgId);

      const role = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.orgId, orgId), isNull(roles.deletedAt)))
        .limit(1);
      if (role[0] === undefined) throw AppError.notFound('Role', roleId);

      const wanted =
        keys.length === 0
          ? []
          : await tx
              .select({ id: permissions.id, key: permissions.key })
              .from(permissions)
              .where(inArray(permissions.key, [...keys]));

      const missing = keys.filter((key) => !wanted.some((row) => row.key === key));
      if (missing.length > 0) {
        // The catalogue is reconciled by the seed against ALL_PERMISSIONS, so
        // a key with no row means the seed has not been run against this
        // database -- a deployment problem, not a request problem.
        throw AppError.validation('Unknown permission key.', { keys: missing });
      }

      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (wanted.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(wanted.map((row) => ({ roleId, permissionId: row.id })));
      }

      await this.assertLastHolderSurvives(tx, orgId, {
        action: "change this role's permissions",
      });
    });
    this.logger.log({ msg: 'Role permissions replaced', orgId, roleId, count: keys.length });
  }

  /**
   * Two administrators editing roles at the same moment could each see one
   * remaining holder and each remove their own, leaving none. Serialising on
   * the organisation row is heavy-handed and completely adequate: role edits
   * are rare, and the alternative is an invariant that holds only when nobody
   * is in a hurry.
   */
  private async lockOrganisation(tx: Transaction, orgId: string): Promise<void> {
    await tx.execute(sql`SELECT id FROM ${organizations} WHERE id = ${orgId} FOR UPDATE`);
  }

  private async assertLastHolderSurvives(
    tx: Transaction,
    orgId: string,
    context: { action: string },
  ): Promise<void> {
    const remaining = await this.countHolders(tx, orgId, IRREVOCABLE_LAST_HOLDER_PERMISSION);
    if (remaining > 0) return;

    // Throwing rolls the transaction back, which is what undoes the change.
    throw new AppError(
      ERROR_CODES.LAST_ROLES_MANAGE_HOLDER,
      `Refusing to ${context.action}: it would leave nobody able to manage roles. ` +
        'Grant the permission to another account first.',
      { details: { permission: IRREVOCABLE_LAST_HOLDER_PERMISSION } },
    );
  }

  /**
   * Active accounts only. A suspended or soft-deleted administrator cannot log
   * in, so counting them would satisfy the invariant while leaving the
   * organisation locked out -- exactly the outcome REQ-B-07 exists to prevent.
   */
  async countHolders(
    executor: Database | Transaction,
    orgId: string,
    key: PermissionKey,
  ): Promise<number> {
    const rows = await executor
      .select({ userId: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(
        permissions,
        and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, key)),
      )
      .where(and(eq(users.orgId, orgId), eq(users.status, 'ACTIVE'), isNull(users.deletedAt)))
      .groupBy(users.id);

    return rows.length;
  }
}
