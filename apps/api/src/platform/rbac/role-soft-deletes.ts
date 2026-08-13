import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ERROR_CODES, PERMISSIONS, type BlockingReference } from '@vyuha/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { AppError } from '../common/errors.js';
import type { Database } from '../db/db.provider.js';
import { roles, userRoles, users } from '../db/schema/index.js';
import type { OrgContext } from '../db/scoped-repository.js';
import { SoftDeletableRegistry } from '../recycle-bin/soft-deletable.js';

/**
 * REQ-B-07 / REQ-B-09a: a role is deletable and restorable like any other
 * record, through the same routes and the same recycle bin.
 *
 * Two of its rules do not fit the declarative reference shape, which is why
 * `extraBlockers` exists:
 *
 * - Membership runs through `user_roles`, a join table with no `org_id` and no
 *   `deleted_at`, so there is no scoped table with a foreign key to point at.
 * - A seeded role must refuse outright rather than report a count.
 */

/** Enough names in a refusal to act on, few enough to read. */
const MEMBERS_NAMED = 5;

@Injectable()
export class RoleSoftDeletes implements OnModuleInit {
  constructor(private readonly registry: SoftDeletableRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      entityType: 'role',
      label: 'Role',
      table: roles,
      nameColumn: roles.name,
      // A role is named, not coded. The name is what the unique index is on, so
      // it is also what a restore can collide with.
      codeColumn: null,
      uniqueColumn: roles.name,
      managePermission: PERMISSIONS.ROLES_MANAGE,
      references: [],
      extraBlockers: roleBlockers,
    });
  }
}

async function roleBlockers(
  db: Database,
  ctx: OrgContext,
  id: string,
): Promise<readonly BlockingReference[]> {
  const roleRows = await db
    .select({ name: roles.name, isSystem: roles.isSystem })
    .from(roles)
    .where(and(eq(roles.orgId, ctx.orgId), eq(roles.id, id), isNull(roles.deletedAt)))
    .limit(1);

  const role = roleRows[0];
  // The caller already loaded the row; a disappearance between the two reads is
  // its problem to report, not this hook's to invent a blocker for.
  if (role === undefined) return [];

  if (role.isSystem) {
    throw new AppError(
      ERROR_CODES.SYSTEM_ROLE_PROTECTED,
      `"${role.name}" is one of the four seeded roles and cannot be deleted. The seed recreates ` +
        'it by name on every run, so deleting it here would be a delay rather than a delete. ' +
        'Its permissions and description are editable; take the role off the accounts that ' +
        'hold it instead.',
      { details: { roleId: id, name: role.name } },
    );
  }

  // Active holders only. A suspended account cannot sign in, so counting it
  // would block a delete on somebody the role does nothing for.
  const holders = await db
    .select({
      email: users.email,
      total: sql<number>`count(*) OVER ()::int`,
    })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.roleId, id),
        eq(users.orgId, ctx.orgId),
        eq(users.status, 'ACTIVE'),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(users.email))
    .limit(MEMBERS_NAMED);

  const total = holders[0]?.total ?? 0;
  if (total === 0) return [];

  return [
    {
      entityType: 'users',
      label: 'active accounts',
      count: total,
      examples: holders.map((row) => row.email),
    },
  ];
}
