import { randomBytes } from 'node:crypto';

import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSION_MATRIX,
  SYSTEM_ROLES,
  type PermissionKey,
  type SystemRoleName,
} from '@vyuha/shared';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';

import type { Database } from '../src/platform/db/db.provider.js';
import {
  organizations,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../src/platform/db/schema/index.js';
import { hashPassword } from '../src/platform/auth/password.js';
import { seedMasterData, type MasterDataReport } from './master-data.js';

/**
 * Technical design §18 and PRD §2.1: one organisation, the four seeded roles
 * with the §2.1 permission matrix, the permission catalogue, and an account
 * that can sign in.
 *
 * **Idempotent, and that is the requirement, not a nicety.** This runs on a
 * fresh developer database, again after a schema change, and again on a
 * staging box that already has data. Every step is written as "make the world
 * match this description", never as "insert this row".
 *
 * The one thing it will not do twice is set a password. A re-run against a
 * database that already has the administrator leaves that account exactly as
 * it is -- otherwise re-seeding would silently rotate the credential someone
 * is currently using, and print a new one nobody was expecting.
 */

/**
 * A fixed id rather than a lookup by name.
 *
 * The organisation's name is editable in the UI (REQ-L-01). Matching on it
 * would mean a re-seed after a rename creates a *second* organisation and
 * every subsequent step attaches to the wrong one -- the worst possible
 * outcome for a script whose contract is idempotency.
 */
export const SEED_ORG_ID = '01900000-0000-7000-8000-000000000001';

export const DEFAULT_SEED_ORG_NAME = 'Vyuha';
export const DEFAULT_ADMIN_EMAIL = 'admin@vyuha.local';

export interface SeedOptions {
  readonly orgName?: string;
  readonly adminEmail?: string;
  /** Overridden only by the idempotency test, so it does not touch the real
   *  seeded organisation on a developer's database. */
  readonly orgId?: string;
}

export interface SeedReport {
  readonly permissions: { inserted: number; updated: number; removed: number };
  readonly organization: { id: string; created: boolean };
  readonly roles: readonly {
    name: SystemRoleName;
    id: string;
    created: boolean;
    granted: number;
    revoked: number;
  }[];
  readonly admin: {
    userId: string;
    email: string;
    created: boolean;
    /** Present only on the run that created the account. Printed once, never stored. */
    password: string | null;
  };
  /** REQ-A-01 … REQ-A-03: locations, departments, designations, employees. */
  readonly masterData: MasterDataReport;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function runSeed(db: Database, options: SeedOptions = {}): Promise<SeedReport> {
  const orgName = options.orgName ?? DEFAULT_SEED_ORG_NAME;
  const orgId = options.orgId ?? SEED_ORG_ID;
  const adminEmail = (options.adminEmail ?? DEFAULT_ADMIN_EMAIL).trim().toLowerCase();

  // The generated password has to exist before the transaction so the hash --
  // which takes tens of milliseconds -- is not computed while holding locks.
  const candidatePassword = generatePassword();
  const candidateHash = await hashPassword(candidatePassword);

  return db.transaction(async (tx) => {
    const permissionReport = await reconcilePermissions(tx);
    const organization = await ensureOrganisation(tx, orgId, orgName);
    const roleReport = await reconcileRoles(tx, orgId);
    const admin = await ensureAdministrator(tx, orgId, adminEmail, candidateHash, candidatePassword);
    // Last, because the departments it creates are headed by the employees it
    // creates, and both need the organisation to exist first.
    const masterData = await seedMasterData(tx, orgId);

    return {
      permissions: permissionReport,
      organization,
      roles: roleReport,
      admin,
      masterData,
    };
  });
}

/**
 * The catalogue is owned by code: `ALL_PERMISSIONS` in `@vyuha/shared` is the
 * definition, and this table is a projection of it that exists so
 * `role_permissions` can carry a foreign key.
 *
 * Keys the code no longer defines are deleted. That cascades to
 * `role_permissions`, which is correct -- a permission nothing checks grants
 * nothing, and leaving it in place means a role screen offering a checkbox
 * with no effect. Each deletion is reported so it is never silent.
 */
async function reconcilePermissions(
  tx: Transaction,
): Promise<{ inserted: number; updated: number; removed: number }> {
  const existing = await tx
    .select({ key: permissions.key, description: permissions.description })
    .from(permissions);

  const byKey = new Map(existing.map((row) => [row.key, row.description]));

  const missing = ALL_PERMISSIONS.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    await tx
      .insert(permissions)
      .values(missing.map((key) => ({ key, description: PERMISSION_DESCRIPTIONS[key] })))
      .onConflictDoNothing({ target: permissions.key });
  }

  let updated = 0;
  for (const key of ALL_PERMISSIONS) {
    const current = byKey.get(key);
    if (current === undefined || current === PERMISSION_DESCRIPTIONS[key]) continue;
    await tx
      .update(permissions)
      .set({ description: PERMISSION_DESCRIPTIONS[key] })
      .where(eq(permissions.key, key));
    updated += 1;
  }

  const orphans = existing.filter((row) => !ALL_PERMISSIONS.includes(row.key as PermissionKey));
  if (orphans.length > 0) {
    await tx.delete(permissions).where(
      inArray(
        permissions.key,
        orphans.map((row) => row.key),
      ),
    );
  }

  return { inserted: missing.length, updated, removed: orphans.length };
}

async function ensureOrganisation(
  tx: Transaction,
  orgId: string,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const found = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (found[0] !== undefined) return { id: found[0].id, created: false };

  // Undoes a previous soft delete as well as inserting: `deletedAt` is set
  // explicitly rather than left to the column default, so a re-seed after
  // someone deleted the organisation restores a usable one.
  const inserted = await tx
    .insert(organizations)
    .values({ id: orgId, name, deletedAt: null })
    .onConflictDoUpdate({ target: organizations.id, set: { deletedAt: null } })
    .returning({ id: organizations.id });

  const row = inserted[0];
  if (row === undefined) throw new Error('Organisation upsert returned no row.');
  return { id: row.id, created: true };
}

/**
 * REQ-B-07 makes role permission sets editable in the UI, so reconciling them
 * back to the matrix is a deliberate reset, not a merge. It is reported per
 * role -- `granted` and `revoked` are non-zero exactly when a re-seed changed
 * something an administrator had configured.
 */
async function reconcileRoles(tx: Transaction, orgId: string): Promise<SeedReport['roles']> {
  const catalogue = await tx
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions);
  const permissionIdByKey = new Map(catalogue.map((row) => [row.key, row.id]));

  const report: {
    name: SystemRoleName;
    id: string;
    created: boolean;
    granted: number;
    revoked: number;
  }[] = [];

  for (const name of Object.values(SYSTEM_ROLES)) {
    const existing = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.name, name), isNull(roles.deletedAt)))
      .limit(1);

    let roleId = existing[0]?.id;
    const created = roleId === undefined;

    if (roleId === undefined) {
      const inserted = await tx
        .insert(roles)
        .values({ orgId, name, isSystem: true })
        .returning({ id: roles.id });
      const row = inserted[0];
      if (row === undefined) throw new Error(`Role insert returned no row for "${name}".`);
      roleId = row.id;
    }

    const wantedKeys = ROLE_PERMISSION_MATRIX[name];
    const wantedIds = wantedKeys.map((key) => {
      const id = permissionIdByKey.get(key);
      if (id === undefined) {
        // Only reachable if reconcilePermissions above did not run, which
        // would be a bug in this file rather than in the database.
        throw new Error(`Permission "${key}" is missing from the catalogue.`);
      }
      return id;
    });

    const granted = await tx
      .insert(rolePermissions)
      .values(wantedIds.map((permissionId) => ({ roleId, permissionId })))
      .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permissionId] })
      .returning({ permissionId: rolePermissions.permissionId });

    const revoked = await tx
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, roleId),
          notInArray(rolePermissions.permissionId, wantedIds),
        ),
      )
      .returning({ permissionId: rolePermissions.permissionId });

    report.push({ name, id: roleId, created, granted: granted.length, revoked: revoked.length });
  }

  return report;
}

async function ensureAdministrator(
  tx: Transaction,
  orgId: string,
  email: string,
  passwordHash: string,
  password: string,
): Promise<SeedReport['admin']> {
  const adminRole = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(eq(roles.orgId, orgId), eq(roles.name, SYSTEM_ROLES.ADMIN), isNull(roles.deletedAt)),
    )
    .limit(1);

  const adminRoleId = adminRole[0]?.id;
  if (adminRoleId === undefined) throw new Error('Admin role is missing after reconciliation.');

  const existing = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)))
    .limit(1);

  const found = existing[0];

  if (found !== undefined) {
    // The role assignment is still reconciled: an administrator who lost the
    // Admin role is exactly the situation someone re-runs the seed to fix.
    await tx
      .insert(userRoles)
      .values({ userId: found.id, roleId: adminRoleId })
      .onConflictDoNothing({ target: [userRoles.userId, userRoles.roleId] });

    return { userId: found.id, email: found.email, created: false, password: null };
  }

  const now = new Date();
  const inserted = await tx
    .insert(users)
    .values({
      orgId,
      email,
      passwordHash,
      status: 'ACTIVE',
      passwordChangedAt: now,
    })
    .returning({ id: users.id, email: users.email });

  const row = inserted[0];
  if (row === undefined) throw new Error('Administrator insert returned no row.');

  await tx
    .insert(userRoles)
    .values({ userId: row.id, roleId: adminRoleId })
    .onConflictDoNothing({ target: [userRoles.userId, userRoles.roleId] });

  return { userId: row.id, email: row.email, created: true, password };
}

/**
 * 24 base64url characters, which is 144 bits. Not a fixed default and not
 * derived from anything -- CLAUDE.md §6: "Do not commit secrets". A seeded
 * default password is the most commonly committed secret there is.
 */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}
