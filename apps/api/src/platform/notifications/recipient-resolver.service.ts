import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../db/db.provider.js';
import {
  permissions,
  rolePermissions,
  userRoles,
  users,
} from '../db/schema/index.js';
import type { Recipient } from './notification-channel.js';
import type { NotificationAudience } from './notification-events.js';

/**
 * Turns "who this is for" into accounts that can actually receive something.
 *
 * Technical design §12: "A dispatcher resolves recipients." Three rules cover
 * everything the product needs, and each one filters to `ACTIVE` users in the
 * named organisation -- a suspended account must not keep receiving mail, and
 * an invited-but-not-accepted one has no inbox to speak of in this system.
 *
 * The `permission` audience is what lets a Phase 1 call site say "tell whoever
 * reviews flagged punches" without naming a role, a person, or a department.
 * PRD §2: "Roles are not hardcoded into logic."
 */
@Injectable()
export class RecipientResolver {
  constructor(@InjectDatabase() private readonly db: Database) {}

  async resolve(orgId: string, audience: NotificationAudience): Promise<readonly Recipient[]> {
    switch (audience.kind) {
      case 'users':
        return this.byUserIds(orgId, audience.userIds);
      case 'employees':
        return this.byEmployeeIds(orgId, audience.employeeIds);
      case 'permission':
        return this.byPermission(orgId, audience.key);
    }
  }

  private async byUserIds(
    orgId: string,
    userIds: readonly string[],
  ): Promise<readonly Recipient[]> {
    if (userIds.length === 0) return [];

    const rows = await this.db
      .select({ userId: users.id, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.orgId, orgId),
          inArray(users.id, [...userIds]),
          eq(users.status, 'ACTIVE'),
          isNull(users.deletedAt),
        ),
      );

    return rows.map((row) => ({ userId: row.userId, orgId, email: row.email }));
  }

  private async byEmployeeIds(
    orgId: string,
    employeeIds: readonly string[],
  ): Promise<readonly Recipient[]> {
    if (employeeIds.length === 0) return [];

    // REQ-B-02: an employee record may have no login at all. Those simply drop
    // out of the result -- there is nowhere to deliver to, and inventing a
    // fallback would mean guessing at an address.
    const rows = await this.db
      .select({ userId: users.id, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.orgId, orgId),
          inArray(users.employeeId, [...employeeIds]),
          eq(users.status, 'ACTIVE'),
          isNull(users.deletedAt),
        ),
      );

    return rows.map((row) => ({ userId: row.userId, orgId, email: row.email }));
  }

  private async byPermission(orgId: string, key: string): Promise<readonly Recipient[]> {
    const rows = await this.db
      .selectDistinct({ userId: users.id, email: users.email })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(users.orgId, orgId),
          eq(permissions.key, key),
          eq(users.status, 'ACTIVE'),
          isNull(users.deletedAt),
        ),
      );

    return rows.map((row) => ({ userId: row.userId, orgId, email: row.email }));
  }
}
