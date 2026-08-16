import { PERMISSIONS } from '@vyuha/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness } from '../../test-support/api-harness.js';
import { roles } from '../db/schema/index.js';
import type { Principal } from './principal.js';
import { PrincipalService } from './principal.service.js';
import { ScopeService } from './scope.service.js';

/**
 * REQ-P-03 / D-15: a user may hold more than one role.
 *
 * A salesperson is also an employee -- they punch, they apply for leave, and
 * they raise sales orders. `08` §2.1 rejects the two alternatives to this: a
 * composite "Sales + Employee" role multiplies with every module added, and
 * duplicating attendance permissions into Sales means a permission change has
 * to be made in several places and will eventually be made in only one.
 *
 * `10` §2 states the acceptance as "a user holding two roles gets the union of
 * both, and the wider of two scopes ... asserted by a test with a Sales+Employee
 * fixture". This is that test.
 *
 * It is worth writing even though both properties already hold. `user_roles`
 * has always been a many-to-many with a `(user_id, role_id)` primary key and
 * `loadGrants` has always collected into a Set, so D-15 needs no migration --
 * but nothing asserted it, which means nothing would have caught a later
 * "optimisation" that took the first role and stopped. The union is now a
 * property under test rather than an accident of the query.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000f8';

let harness: ApiHarness;
let principals: PrincipalService;
let scopes: ScopeService;

/** Two roles that overlap in one key and differ in breadth, as the real pair does. */
const EMPLOYEE_KEYS = [
  PERMISSIONS.PUNCH_SELF,
  PERMISSIONS.ATTENDANCE_VIEW_SELF,
  PERMISSIONS.LEAVE_APPLY_SELF,
] as const;

const SALES_LIKE_KEYS = [
  // The overlap. If the union were a concatenation rather than a set, this
  // would appear twice and the count assertion below would catch it.
  PERMISSIONS.ATTENDANCE_VIEW_SELF,
  PERMISSIONS.ATTENDANCE_VIEW_ALL,
  PERMISSIONS.EMPLOYEE_VIEW,
] as const;

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Multi-role Fixture Org');
  principals = harness.resolve(PrincipalService);
  scopes = harness.resolve(ScopeService);
});

afterAll(async () => {
  await harness.close();
});

/**
 * A principal carrying real grants and nothing else.
 *
 * `PrincipalService.resolve` wants a session id and a token issue time, and
 * neither has any bearing on what `breadth` reads. Building the record from
 * `loadGrants` keeps the fixture to the thing under test -- a session fixture
 * would add failure modes belonging to authentication.
 */
async function principalFor(userId: string): Promise<Principal> {
  const grants = await principals.loadGrants(userId, ORG_ID);
  return {
    userId,
    orgId: ORG_ID,
    employeeId: null,
    email: 'fixture@example.com',
    status: 'ACTIVE',
    sessionId: '01900000-0000-7000-8000-0000000000ff',
    roles: grants.roles,
    permissions: grants.permissions,
  };
}

describe('a user holding two roles', () => {
  it('holds the union of both roles, not the first or the last', async () => {
    const employeeRole = await harness.createRole('Fixture Employee', EMPLOYEE_KEYS);
    const salesRole = await harness.createRole('Fixture Sales', SALES_LIKE_KEYS);
    const user = await harness.createUser({
      email: 'both-roles@example.com',
      roleIds: [employeeRole, salesRole],
    });

    const grants = await principals.loadGrants(user.id, ORG_ID);

    // Every key from each side, and the overlap counted once.
    for (const key of [...EMPLOYEE_KEYS, ...SALES_LIKE_KEYS]) {
      expect(grants.permissions.has(key)).toBe(true);
    }
    expect(grants.permissions.size).toBe(
      new Set([...EMPLOYEE_KEYS, ...SALES_LIKE_KEYS]).size,
    );

    // And both roles are reported, because the UI names what somebody holds.
    expect(grants.roles.map((r) => r.name).sort()).toEqual([
      'Fixture Employee',
      'Fixture Sales',
    ]);
  });

  it('resolves to the wider of two scopes, whichever role granted it', async () => {
    const narrow = await harness.createRole('Fixture Narrow', [
      PERMISSIONS.ATTENDANCE_VIEW_SELF,
    ]);
    const wide = await harness.createRole('Fixture Wide', [PERMISSIONS.ATTENDANCE_VIEW_ALL]);

    const user = await harness.createUser({
      email: 'narrow-and-wide@example.com',
      roleIds: [narrow, wide],
    });
    const principal = await principalFor(user.id);

    const breadth = scopes.breadth(principal, {
      self: PERMISSIONS.ATTENDANCE_VIEW_SELF,
      team: PERMISSIONS.ATTENDANCE_VIEW_TEAM,
      all: PERMISSIONS.ATTENDANCE_VIEW_ALL,
    });

    // Not 'self', which is what a resolver that stopped at the first matching
    // role would return -- the narrow role is listed first.
    expect(breadth).toBe('all');
  });

  it('narrows again when the wider role is taken away', async () => {
    const narrow = await harness.createRole('Fixture Narrow Only', [
      PERMISSIONS.ATTENDANCE_VIEW_SELF,
    ]);
    const user = await harness.createUser({
      email: 'narrow-only@example.com',
      roleIds: [narrow],
    });
    const principal = await principalFor(user.id);

    // The mirror of the test above. Without it, a `breadth` that returned 'all'
    // unconditionally would pass the previous assertion.
    expect(
      scopes.breadth(principal, {
        self: PERMISSIONS.ATTENDANCE_VIEW_SELF,
        team: PERMISSIONS.ATTENDANCE_VIEW_TEAM,
        all: PERMISSIONS.ATTENDANCE_VIEW_ALL,
      }),
    ).toBe('self');
  });

  it('holds nothing from a role that was soft-deleted', async () => {
    const live = await harness.createRole('Fixture Live', [PERMISSIONS.ATTENDANCE_VIEW_SELF]);
    const doomed = await harness.createRole('Fixture Doomed', [PERMISSIONS.ATTENDANCE_VIEW_ALL]);
    const user = await harness.createUser({
      email: 'one-role-deleted@example.com',
      roleIds: [live, doomed],
    });

    await harness.db.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, doomed));

    const grants = await principals.loadGrants(user.id, ORG_ID);
    // A union across roles must not resurrect a role somebody removed -- the
    // join filters on `roles.deleted_at IS NULL`, and this is what says so.
    expect(grants.permissions.has(PERMISSIONS.ATTENDANCE_VIEW_ALL)).toBe(false);
    expect(grants.permissions.has(PERMISSIONS.ATTENDANCE_VIEW_SELF)).toBe(true);
    expect(grants.roles).toHaveLength(1);
  });
});
