import { PERMISSIONS, uuidv7, type PermissionKey } from '@vyuha/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness } from '../../test-support/api-harness.js';
import { employees } from '../db/schema/index.js';
import type { Principal } from './principal.js';
import { ScopeService } from './scope.service.js';

/**
 * PRD §2: "team = employees whose `reporting_manager_id` chain reaches the
 * user, plus employees in departments the user owns."
 *
 * The hierarchy below is built three levels deep on purpose. A resolver that
 * fetched direct reports and stopped -- the obvious wrong implementation --
 * passes any test with a two-level tree, so a two-level tree proves nothing.
 *
 *   Anita (Ops head)
 *     +- Bharat
 *     |    +- Chetan
 *     |         +- Divya          <- three levels below Anita
 *     +- Esha
 *   Farid  (no relation to Anita, but in the department Anita heads)
 *   Gita   (unrelated to everything)
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000a1';

let harness: ApiHarness;
let scope: ScopeService;

const people: Record<string, string> = {};

function principal(employeeId: string | null, keys: readonly PermissionKey[]): Principal {
  return {
    userId: uuidv7(),
    orgId: ORG_ID,
    employeeId,
    email: 'scope@vyuha.test',
    status: 'ACTIVE',
    sessionId: uuidv7(),
    roles: [],
    permissions: new Set(keys),
  };
}

/** Runs the resolved fragment against `employees` and returns the names found. */
async function visibleNames(resolved: { where: ReturnType<ScopeService['resolve']>['where'] }): Promise<string[]> {
  const rows = await harness.db
    .select({ name: employees.firstName })
    .from(employees)
    .where(and(eq(employees.orgId, ORG_ID), sql`${employees.deletedAt} IS NULL`, resolved.where));
  return rows.map((row) => row.name).sort();
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Scope Fixture Org');
  scope = new ScopeService(harness.db);

  people.anita = await harness.createEmployee({ code: 'SC-ANITA', firstName: 'Anita' });
  people.bharat = await harness.createEmployee({
    code: 'SC-BHARAT',
    firstName: 'Bharat',
    reportingManagerId: people.anita,
  });
  people.chetan = await harness.createEmployee({
    code: 'SC-CHETAN',
    firstName: 'Chetan',
    reportingManagerId: people.bharat,
  });
  people.divya = await harness.createEmployee({
    code: 'SC-DIVYA',
    firstName: 'Divya',
    reportingManagerId: people.chetan,
  });
  people.esha = await harness.createEmployee({
    code: 'SC-ESHA',
    firstName: 'Esha',
    reportingManagerId: people.anita,
  });

  const operations = await harness.createDepartment({ code: 'SC-OPS', name: 'Operations' });
  await harness.setDepartmentHead(operations, people.anita);

  people.farid = await harness.createEmployee({
    code: 'SC-FARID',
    firstName: 'Farid',
    departmentId: operations,
  });
  people.gita = await harness.createEmployee({ code: 'SC-GITA', firstName: 'Gita' });
}, 30_000);

afterAll(async () => {
  await harness.close();
});

describe('ScopeService team resolution (PRD §2)', () => {
  it('has the fixture it thinks it has', async () => {
    // The control every other assertion in this file is measured against. A
    // scope that returns nothing would otherwise look like a correct scope.
    const rows = await harness.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.orgId, ORG_ID));
    expect(rows).toHaveLength(7);
  });

  it('walks the whole reporting chain, not just direct reports', async () => {
    const ids = await scope.teamEmployeeIds(ORG_ID, people.anita ?? '');

    // Divya is three levels down. Chetan is two.
    expect(new Set(ids)).toEqual(
      new Set([people.bharat, people.chetan, people.divya, people.esha, people.farid]),
    );
    expect(ids).not.toContain(people.gita);
  });

  it('includes employees in a department the user heads, with no reporting link', async () => {
    const ids = await scope.teamEmployeeIds(ORG_ID, people.anita ?? '');
    // Farid reports to nobody; he is visible only through the department head
    // branch of the definition.
    expect(ids).toContain(people.farid);
  });

  it('gives a mid-level manager only their own subtree', async () => {
    const ids = await scope.teamEmployeeIds(ORG_ID, people.bharat ?? '');
    expect(new Set(ids)).toEqual(new Set([people.chetan, people.divya]));
  });

  it('gives a leaf employee an empty team', async () => {
    expect(await scope.teamEmployeeIds(ORG_ID, people.divya ?? '')).toEqual([]);
  });

  it('terminates on a reporting cycle instead of recursing forever', async () => {
    // REQ-A-07 forbids a cycle and validates on save, but a repair script
    // could still create one, and an infinite recursion in a query every
    // manager runs is not an acceptable failure mode. UNION deduplicates each
    // round, which is what makes this terminate.
    const loopTop = await harness.createEmployee({ code: 'SC-LOOP1', firstName: 'Loop1' });
    const loopBottom = await harness.createEmployee({
      code: 'SC-LOOP2',
      firstName: 'Loop2',
      reportingManagerId: loopTop,
    });
    await harness.db
      .update(employees)
      .set({ reportingManagerId: loopBottom })
      .where(eq(employees.id, loopTop));

    const ids = await scope.teamEmployeeIds(ORG_ID, loopTop);
    expect(new Set(ids)).toEqual(new Set([loopTop, loopBottom]));

    await harness.db
      .update(employees)
      .set({ reportingManagerId: null })
      .where(eq(employees.id, loopTop));
    await harness.db.delete(employees).where(eq(employees.id, loopBottom));
    await harness.db.delete(employees).where(eq(employees.id, loopTop));
  });

  it('excludes a soft-deleted employee from the team', async () => {
    await harness.db
      .update(employees)
      .set({ deletedAt: new Date() })
      .where(eq(employees.id, people.esha ?? ''));

    expect(await scope.teamEmployeeIds(ORG_ID, people.anita ?? '')).not.toContain(people.esha);

    await harness.db
      .update(employees)
      .set({ deletedAt: null })
      .where(eq(employees.id, people.esha ?? ''));
  });
});

describe('ScopeService breadth resolution', () => {
  const grants = {
    self: PERMISSIONS.ATTENDANCE_VIEW_SELF,
    team: PERMISSIONS.ATTENDANCE_VIEW_TEAM,
    all: PERMISSIONS.ATTENDANCE_VIEW_ALL,
  } as const;

  it('resolves `all` to an unrestricted predicate', async () => {
    const resolved = scope.resolve(
      principal(people.gita ?? null, [grants.all]),
      grants,
      employees.id,
    );
    expect(resolved.scope).toBe('all');
    expect(await visibleNames(resolved)).toHaveLength(7);
  });

  it('resolves `self` to the caller alone', async () => {
    const resolved = scope.resolve(
      principal(people.bharat ?? null, [grants.self]),
      grants,
      employees.id,
    );
    expect(resolved.scope).toBe('self');
    expect(await visibleNames(resolved)).toEqual(['Bharat']);
  });

  it('resolves `team` to the subtree, plus self when self is also held', async () => {
    const teamOnly = scope.resolve(
      principal(people.anita ?? null, [grants.team]),
      grants,
      employees.id,
    );
    expect(teamOnly.scope).toBe('team');
    expect(await visibleNames(teamOnly)).toEqual(['Bharat', 'Chetan', 'Divya', 'Esha', 'Farid']);

    const teamAndSelf = scope.resolve(
      principal(people.anita ?? null, [grants.team, grants.self]),
      grants,
      employees.id,
    );
    expect(await visibleNames(teamAndSelf)).toEqual([
      'Anita',
      'Bharat',
      'Chetan',
      'Divya',
      'Esha',
      'Farid',
    ]);
  });

  it('takes the broadest breadth the caller holds', () => {
    expect(scope.breadth(principal(null, [grants.self, grants.team, grants.all]), grants).valueOf()).toBe(
      'all',
    );
    expect(scope.breadth(principal(null, [grants.self, grants.team]), grants).valueOf()).toBe('team');
    expect(scope.breadth(principal(null, [grants.self]), grants).valueOf()).toBe('self');
    expect(scope.breadth(principal(null, []), grants).valueOf()).toBe('none');
  });

  /**
   * The important negative case. `none` must produce a predicate that matches
   * nothing -- not an absent predicate, which a caller would splice into a
   * WHERE clause and accidentally turn into "everything".
   */
  it('resolves no grant at all to a predicate that matches nothing', async () => {
    const resolved = scope.resolve(principal(people.anita ?? null, []), grants, employees.id);
    expect(resolved.scope).toBe('none');
    expect(await visibleNames(resolved)).toEqual([]);
  });

  it('gives an account with no employee record an empty scope, not an open one', async () => {
    const resolved = scope.resolve(principal(null, [grants.team, grants.self]), grants, employees.id);
    expect(await visibleNames(resolved)).toEqual([]);
  });
});
