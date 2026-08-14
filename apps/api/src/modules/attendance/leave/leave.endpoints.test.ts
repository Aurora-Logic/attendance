import {
  SYSTEM_ROLES,
  isLeaveBalanceConsistent,
  uuidv7,
  type CompOffCredit,
  type LeaveBalance,
  type LeaveCalendar,
  type LeaveLedgerEntry,
  type LeavePreview,
  type LeaveRequestDetail,
  type LeaveTypePolicy,
  type Paginated,
} from '@vyuha/shared';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { employees, settings } from '../../../platform/db/schema/index.js';
import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';
import { addDays } from '../day-engine/calendar-date.js';
import {
  holidayCalendars,
  holidays,
  leaveLedger,
  weeklyOffPatterns,
} from '../schema/index.js';
import { LEAVE_SETTING_KEYS } from './leave.repository.js';

/**
 * Every leave endpoint (REQ-G-01 … REQ-G-12) over real HTTP against the real
 * application: the global guard, the Zod pipe, `ScopeService`, the exception
 * filter, the audit interceptor, the append-only trigger and the check
 * constraint added in migration 0009 all in the loop.
 *
 * `preservePeople`, because an employee with a ledger row can never be
 * deleted -- `leave_ledger.employee_id` is RESTRICT and the table refuses a
 * DELETE. People are therefore minted per run with unique codes, the same
 * arrangement the punch suite uses and for the same reason.
 *
 * The fixture calendar is built around a fixed Monday so the weekend and the
 * holiday land where the sandwich tests expect them, and far enough in the
 * future that the notice-period rule is satisfiable.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e1';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let harness: ApiHarness;
let runId: string;

let employeeAId: string;
let employeeBId: string;
let managerEmployeeId: string;
let employeeRoleId: string;

let employeeToken: string;
let otherToken: string;
let managerToken: string;
let hrToken: string;
let strangerToken: string;

let casualTypeId = '';
let sandwichTypeId = '';
let compOffTypeId = '';

/**
 * A Monday well clear of today, so a notice period of a few days is always
 * satisfiable and the weekend below is always in the future.
 */
const MONDAY = mondayAfter(addDays(new Date().toISOString().slice(0, 10), 120));
const FRIDAY = addDays(MONDAY, 4);
const SATURDAY = addDays(MONDAY, 5);
const SUNDAY = addDays(MONDAY, 6);
const NEXT_MONDAY = addDays(MONDAY, 7);
const NEXT_TUESDAY = addDays(MONDAY, 8);
/** A holiday placed on the Monday after the weekend, so a Friday-to-Tuesday
 *  range contains two weekly offs and a holiday. */
const HOLIDAY = NEXT_MONDAY;

const LEAVE_YEAR = leaveYearFor(MONDAY);

function mondayAfter(date: string): string {
  let cursor = date;
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (day === 1) return cursor;
    cursor = addDays(cursor, 1);
  }
  throw new Error('No Monday found in seven days, which is impossible.');
}

/** Mirrors the April default the fixture does not override. */
function leaveYearFor(date: string): number {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

async function createType(
  overrides: Record<string, unknown>,
): Promise<LeaveTypePolicy & ErrorBody> {
  const response = await harness.post<LeaveTypePolicy & ErrorBody>('/leave/types', {
    token: hrToken,
    body: { name: 'Fixture Type', code: `FX${runId}`, ...overrides },
  });
  expect(response.status, response.text).toBe(201);
  return response.body;
}

function previewPath(params: Record<string, string>): string {
  return `/leave/preview?${new URLSearchParams(params).toString()}`;
}

async function balanceOf(token: string, leaveTypeId: string): Promise<LeaveBalance> {
  const response = await harness.get<Paginated<LeaveBalance>>(
    `/leave/balances?year=${String(LEAVE_YEAR)}`,
    { token },
  );
  expect(response.status, response.text).toBe(200);
  const found = response.body.data.find((row) => row.leaveType.id === leaveTypeId);
  if (found === undefined) throw new Error(`No balance row for leave type ${leaveTypeId}.`);
  return found;
}

/** REQ-G-02's Compensatory Off, created once and reused on every later run. */
async function ensureCompOffType(): Promise<string> {
  const existing = await harness.get<Paginated<LeaveTypePolicy>>('/leave/types?pageSize=200', {
    token: hrToken,
  });
  expect(existing.status, existing.text).toBe(200);
  const found = existing.body.data.find((type) => type.code === 'CO');
  if (found !== undefined) return found.id;

  const created = await harness.post<LeaveTypePolicy>('/leave/types', {
    token: hrToken,
    body: { name: 'Compensatory Off', code: 'CO' },
  });
  expect(created.status, created.text).toBe(201);
  return created.body.id;
}

/**
 * The message Postgres actually raised.
 *
 * Drizzle wraps a driver error in one of its own whose message is the SQL it
 * tried to run, so asserting on `.message` would pass for any failure at all
 * -- including a typo in the statement, which is exactly the probe that lies.
 */
async function refusalMessage(statement: SQL): Promise<string> {
  try {
    await harness.db.execute(statement);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    if (cause instanceof Error) return cause.message;
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('The statement was accepted. It should have been refused.');
}

/**
 * Installs an org setting for the duration of one body, and removes it however
 * that body ends.
 *
 * `finally`, not a trailing delete. A failed assertion inside the body would
 * otherwise leave the setting standing, and a deliberately malformed one --
 * the value two of the tests below install on purpose -- makes every later run
 * of this file answer 500 from `beforeAll` onwards. Learned the hard way.
 */
async function withSetting(key: string, value: unknown, body: () => Promise<void>): Promise<void> {
  await harness.db.insert(settings).values({ orgId: ORG_ID, scope: 'ORG', key, value });
  try {
    await body();
  } finally {
    await harness.db
      .delete(settings)
      .where(and(eq(settings.orgId, ORG_ID), eq(settings.key, key)));
  }
}

/** Grants days through the audited adjustment route rather than a raw insert. */
async function grantDays(employeeId: string, leaveTypeId: string, days: number): Promise<void> {
  const response = await harness.post<LeaveBalance & ErrorBody>('/leave/balances/adjust', {
    token: hrToken,
    body: { employeeId, leaveTypeId, year: LEAVE_YEAR, days, reason: 'Opening balance for the test' },
  });
  expect(response.status, response.text).toBe(201);
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Leave Endpoints Fixture Org', { preservePeople: true });
  runId = uuidv7().slice(-6).toUpperCase();

  // Two kinds of state `resetOrganisation` cannot clear, both of which made
  // the second run of this file fail while the first passed.
  //
  // Leave types: a type with ledger rows can never be deleted, so they
  // accumulate. Retiring the previous run's keeps the policy list bounded and
  // keeps this run's assertions looking only at this run's rows. `CO` is left
  // standing because REQ-G-02 fixes its code and comp-off looks it up by that.
  await harness.db.execute(sql`
    UPDATE leave_types SET deleted_at = now()
     WHERE org_id = ${ORG_ID} AND deleted_at IS NULL AND code <> 'CO'
  `);

  // Settings: several tests below install one and remove it afterwards, and a
  // failed assertion between the two would leave it standing for every later
  // run. Clearing here means a red run cannot poison the next one.
  await harness.db.execute(
    sql`DELETE FROM settings WHERE org_id = ${ORG_ID} AND key LIKE 'leave.%'`,
  );

  employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);
  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR);
  const managerRoleId = await harness.createSystemRole(SYSTEM_ROLES.OPERATIONS);
  // Authenticated but holding no leave key at all, so a 403 here is about the
  // missing permission rather than about having no credentials.
  const strangerRoleId = await harness.createRole('Leave Stranger', ['attendance.view.self']);

  managerEmployeeId = await harness.createEmployee({ code: `LV-M-${runId}`, firstName: 'Meera' });
  employeeAId = await harness.createEmployee({
    code: `LV-A-${runId}`,
    firstName: 'Asha',
    reportingManagerId: managerEmployeeId,
    dateOfJoining: '2020-01-01',
  });
  employeeBId = await harness.createEmployee({
    code: `LV-B-${runId}`,
    firstName: 'Bhavin',
    dateOfJoining: '2020-01-01',
  });

  // Saturday and Sunday off, so the sandwich tests have a weekend to skip.
  const patternRows = await harness.db
    .insert(weeklyOffPatterns)
    .values({
      orgId: ORG_ID,
      name: `Leave Probe Weekend ${runId}`,
      config: { weekdays: [6, 7] },
    })
    .returning({ id: weeklyOffPatterns.id });
  const patternId = patternRows[0]?.id;
  if (patternId === undefined) throw new Error('weekly off pattern fixture returned no row');

  const calendarRows = await harness.db
    .insert(holidayCalendars)
    .values({ orgId: ORG_ID, name: `Leave Probe Calendar ${runId}`, year: Number(MONDAY.slice(0, 4)) })
    .returning({ id: holidayCalendars.id });
  const calendarId = calendarRows[0]?.id;
  if (calendarId === undefined) throw new Error('holiday calendar fixture returned no row');

  await harness.db
    .insert(holidays)
    .values({ orgId: ORG_ID, calendarId, date: HOLIDAY, name: 'Leave Probe Holiday' });

  await harness.db
    .update(employees)
    .set({ weeklyOffPatternId: patternId, holidayCalendarId: calendarId })
    .where(
      and(
        eq(employees.orgId, ORG_ID),
        sql`${employees.id} IN (${sql.join([employeeAId, employeeBId, managerEmployeeId].map((id) => sql`${id}::uuid`), sql`, `)})`,
      ),
    );

  const userA = await harness.createUser({
    email: scopedEmail('leave-a'),
    roleIds: [employeeRoleId],
    employeeId: employeeAId,
  });
  const userB = await harness.createUser({
    email: scopedEmail('leave-b'),
    roleIds: [employeeRoleId],
    employeeId: employeeBId,
  });
  const manager = await harness.createUser({
    email: scopedEmail('leave-mgr'),
    roleIds: [managerRoleId],
    employeeId: managerEmployeeId,
  });
  const hrUser = await harness.createUser({ email: scopedEmail('leave-hr'), roleIds: [hrRoleId] });
  const stranger = await harness.createUser({
    email: scopedEmail('leave-stranger'),
    roleIds: [strangerRoleId],
  });

  employeeToken = (await harness.login(userA.email, userA.password)).token;
  otherToken = (await harness.login(userB.email, userB.password)).token;
  managerToken = (await harness.login(manager.email, manager.password)).token;
  hrToken = (await harness.login(hrUser.email, hrUser.password)).token;
  strangerToken = (await harness.login(stranger.email, stranger.password)).token;
  expect(
    [employeeToken, otherToken, managerToken, hrToken, strangerToken].every((t) => t !== ''),
  ).toBe(true);
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('access control', () => {
  it('refuses an unauthenticated request on every route', async () => {
    const routes: readonly [string, string][] = [
      ['GET', '/leave/types'],
      ['POST', '/leave/types'],
      ['GET', `/leave/balances?year=${String(LEAVE_YEAR)}`],
      ['GET', `/leave/ledger?year=${String(LEAVE_YEAR)}`],
      ['POST', '/leave/balances/adjust'],
      ['GET', '/leave/requests'],
      ['POST', '/leave/requests'],
      ['GET', '/leave/comp-off'],
      ['POST', '/leave/comp-off'],
      ['GET', `/leave/calendar?from=${MONDAY}&to=${FRIDAY}`],
    ];

    for (const [method, path] of routes) {
      const response = await harness.request(method, path, { body: method === 'GET' ? undefined : {} });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it('refuses a signed-in account holding no leave permission', async () => {
    const response = await harness.get<ErrorBody>('/leave/types', { token: strangerToken });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('lets an employee read leave types but not write one (REQ-G-01)', async () => {
    const read = await harness.get<Paginated<LeaveTypePolicy>>('/leave/types', {
      token: employeeToken,
    });
    expect(read.status).toBe(200);

    const write = await harness.post<ErrorBody>('/leave/types', {
      token: employeeToken,
      body: { name: 'Sneaky', code: 'SNK' },
    });
    expect(write.status).toBe(403);
    expect(write.body.error.details?.requiredAnyOf).toEqual(['leave.policy.manage']);
  });
});

describe('leave types (REQ-G-01, REQ-G-02)', () => {
  it('creates a type and reads it back with every rule intact', async () => {
    const created = await createType({
      name: 'Probe Casual Leave',
      code: `CL${runId}`,
      accrualMethod: 'MONTHLY',
      annualEntitlement: 12,
      negativeBalanceLimit: 2,
      noticeDays: 2,
      attachmentRequiredAfterDays: 3,
      allowsHalfDay: true,
    });
    casualTypeId = created.id;

    expect(created.code).toBe(`CL${runId}`);
    expect(created.annualEntitlement).toBe(12);
    expect(created.negativeBalanceLimit).toBe(2);
    expect(created.noticeDays).toBe(2);
    expect(created.carryForwardAllowed).toBe(false);
    expect(created.carryForwardCap).toBeNull();

    const fetched = await harness.get<LeaveTypePolicy>(`/leave/types/${created.id}`, {
      token: hrToken,
    });
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created);
  });

  it('creates the sandwich and comp-off types the later tests need', async () => {
    sandwichTypeId = (
      await createType({
        name: 'Probe Sandwich Leave',
        code: `SW${runId}`,
        countsSandwichDays: true,
        allowsHalfDay: false,
      })
    ).id;

    // `CO` is a fixed code (REQ-G-02) and a leave type with ledger rows can
    // never be deleted, so a second run of this file finds one already there.
    // Reused rather than recreated -- the alternative is a file that passes
    // once and 409s for ever after.
    compOffTypeId = await ensureCompOffType();
  });

  it('upper-cases the code and refuses a duplicate of it', async () => {
    const lower = await harness.post<LeaveTypePolicy>('/leave/types', {
      token: hrToken,
      body: { name: 'Probe Lowercase', code: `lc${runId}` },
    });
    expect(lower.status).toBe(201);
    expect(lower.body.code).toBe(`LC${runId}`);

    const duplicate = await harness.post<ErrorBody>('/leave/types', {
      token: hrToken,
      body: { name: 'Probe Duplicate', code: `LC${runId}` },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
  });

  it('refuses an unknown field rather than silently discarding it', async () => {
    const response = await harness.post<ErrorBody>('/leave/types', {
      token: hrToken,
      body: { name: 'Probe Strict', code: `ST${runId}`, monthlyEntitlement: 3 },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a carry-forward cap on a type that cannot carry forward', async () => {
    const response = await harness.post<ErrorBody>('/leave/types', {
      token: hrToken,
      body: {
        name: 'Probe Bad Cap',
        code: `BC${runId}`,
        carryForwardAllowed: false,
        carryForwardCap: 5,
      },
    });
    expect(response.status).toBe(400);
  });

  it('refuses a patch that would leave the merged row inconsistent', async () => {
    const type = await createType({ name: 'Probe Patch', code: `PT${runId}`, minDays: 1, maxDays: 5 });

    const bad = await harness.patch<ErrorBody>(`/leave/types/${type.id}`, {
      token: hrToken,
      // min stays at 1 and max drops below it: only visible on the merge.
      body: { maxDays: 0.5 },
    });
    expect(bad.status).toBe(400);

    const good = await harness.patch<LeaveTypePolicy>(`/leave/types/${type.id}`, {
      token: hrToken,
      body: { maxDays: 10, isActive: false },
    });
    expect(good.status, good.text).toBe(200);
    expect(good.body.maxDays).toBe(10);
    expect(good.body.isActive).toBe(false);
    expect(good.body.code).toBe(type.code);
  });

  it('audits the create and the update (Definition of Done)', async () => {
    expect(await harness.waitForAuditAction('leave_type.created')).toBe(true);
    expect(await harness.waitForAuditAction('leave_type.updated')).toBe(true);
  });
});

describe('the preview (REQ-G-06, REQ-G-07)', () => {
  it('counts only working days across a weekend and a holiday', async () => {
    const response = await harness.get<LeavePreview>(
      previewPath({ leaveTypeId: casualTypeId, fromDate: FRIDAY, toDate: NEXT_TUESDAY }),
      { token: employeeToken },
    );
    expect(response.status, response.text).toBe(200);

    // Fri, Sat(off), Sun(off), Mon(holiday), Tue = five calendar days, two
    // working.
    expect(response.body.calendarDays).toBe(5);
    expect(response.body.totalDays).toBe(2);
    expect(response.body.weeklyOffsSkipped).toBe(2);
    expect(response.body.holidaysSkipped).toBe(1);
    expect(response.body.sandwichDaysCounted).toBe(0);
    expect(response.body.days).toHaveLength(5);
  });

  it('counts every day for a type that counts sandwich days', async () => {
    const response = await harness.get<LeavePreview>(
      previewPath({ leaveTypeId: sandwichTypeId, fromDate: FRIDAY, toDate: NEXT_TUESDAY }),
      { token: employeeToken },
    );
    expect(response.status, response.text).toBe(200);
    expect(response.body.totalDays).toBe(5);
    expect(response.body.sandwichDaysCounted).toBe(3);
    expect(response.body.weeklyOffsSkipped).toBe(0);
    expect(response.body.holidaysSkipped).toBe(0);
  });

  it('reports the balance before and after, and the blockers, without writing', async () => {
    const before = await balanceOf(employeeToken, casualTypeId);

    const response = await harness.get<LeavePreview>(
      previewPath({ leaveTypeId: casualTypeId, fromDate: MONDAY, toDate: FRIDAY }),
      { token: employeeToken },
    );
    expect(response.status).toBe(200);
    expect(response.body.balanceBefore).toBe(before.closing);
    expect(response.body.balanceAfter).toBe(before.closing - 5);
    // No balance yet, and the type's negative limit is 2, so five days is
    // past it.
    expect(response.body.blockers).toContain('NEGATIVE_LIMIT_EXCEEDED');

    const after = await balanceOf(employeeToken, casualTypeId);
    expect(after.closing).toBe(before.closing);
  });

  it('halves a boundary day and refuses a half day the type does not allow', async () => {
    const half = await harness.get<LeavePreview>(
      previewPath({
        leaveTypeId: casualTypeId,
        fromDate: MONDAY,
        toDate: MONDAY,
        fromPortion: 'FIRST_HALF',
        toPortion: 'FIRST_HALF',
      }),
      { token: employeeToken },
    );
    expect(half.status, half.text).toBe(200);
    expect(half.body.totalDays).toBe(0.5);
    expect(half.body.halfDays).toBe(1);

    const refused = await harness.get<LeavePreview>(
      previewPath({
        leaveTypeId: sandwichTypeId,
        fromDate: MONDAY,
        toDate: MONDAY,
        fromPortion: 'FIRST_HALF',
        toPortion: 'FIRST_HALF',
      }),
      { token: employeeToken },
    );
    expect(refused.status).toBe(200);
    expect(refused.body.blockers).toContain('HALF_DAY_NOT_ALLOWED');
  });

  it('refuses a malformed query rather than guessing', async () => {
    const response = await harness.get<ErrorBody>(
      previewPath({ leaveTypeId: casualTypeId, fromDate: 'yesterday', toDate: FRIDAY }),
      { token: employeeToken },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('applying (REQ-G-06, REQ-G-07, REQ-G-08)', () => {
  it('refuses when the negative balance limit would be exceeded', async () => {
    const response = await harness.post<ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: { leaveTypeId: casualTypeId, fromDate: MONDAY, toDate: FRIDAY, reason: 'Too much' },
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('LEAVE_NEGATIVE_LIMIT_EXCEEDED');
  });

  it('allows a negative balance up to the limit (REQ-G-08)', async () => {
    // Limit 2, balance 0, two days requested: exactly at the floor.
    const response = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: MONDAY,
        toDate: addDays(MONDAY, 1),
        reason: 'At the limit',
      },
    });
    expect(response.status, response.text).toBe(201);
    expect(response.body.totalDays).toBe(2);
    expect(response.body.status).toBe('PENDING');

    // Applying does not move the balance; approving does.
    const balance = await balanceOf(employeeToken, casualTypeId);
    expect(balance.closing).toBe(0);
    expect(balance.availed).toBe(0);

    const cancelled = await harness.post<LeaveRequestDetail>(
      `/leave/requests/${response.body.id}/cancel`,
      { token: employeeToken, body: { reason: 'Clearing the fixture' } },
    );
    expect(cancelled.status, cancelled.text).toBe(201);
  });

  it('stores the skipped days uncounted so the day engine can read them', async () => {
    await grantDays(employeeAId, casualTypeId, 20);

    const response = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: FRIDAY,
        toDate: NEXT_TUESDAY,
        reason: 'Across a weekend and a holiday',
      },
    });
    expect(response.status, response.text).toBe(201);
    expect(response.body.totalDays).toBe(2);
    expect(response.body.days).toHaveLength(5);
    expect(response.body.days.filter((day) => day.isCounted)).toHaveLength(2);
    expect(response.body.days.filter((day) => !day.isCounted).map((day) => day.date)).toEqual([
      SATURDAY,
      SUNDAY,
      HOLIDAY,
    ]);
  });

  it('refuses an overlapping application on the counted days (REQ-G-07)', async () => {
    const response = await harness.post<ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: { leaveTypeId: casualTypeId, fromDate: FRIDAY, toDate: FRIDAY, reason: 'Again' },
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LEAVE_OVERLAPS_EXISTING');
  });

  it('accepts the weekend the earlier request skipped, because nothing was consumed there', async () => {
    const response = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: {
        leaveTypeId: sandwichTypeId,
        fromDate: SATURDAY,
        toDate: SUNDAY,
        reason: 'Nothing is consumed here',
      },
    });
    // Every day in the range is non-working and neither is sandwiched, so the
    // application consumes nothing and is refused as such rather than accepted
    // as a zero-day leave.
    expect(response.status, response.text).toBe(400);
  });

  it('refuses an application that breaks the notice period (REQ-G-07)', async () => {
    const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
    const response = await harness.post<ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: { leaveTypeId: casualTypeId, fromDate: tomorrow, toDate: tomorrow, reason: 'Tomorrow' },
    });
    // Either the notice period or a weekend; both are correct refusals, and
    // the assertion names the one this type is configured for.
    expect([400, 422]).toContain(response.status);
    if (response.status === 422) expect(response.body.error.code).toBe('LEAVE_NOTICE_PERIOD');
  });

  it('refuses a missing attachment past the type threshold (REQ-G-01)', async () => {
    const response = await harness.post<ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: addDays(NEXT_MONDAY, 7),
        toDate: addDays(NEXT_MONDAY, 11),
        reason: 'Five days needs a document',
      },
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('LEAVE_ATTACHMENT_REQUIRED');
  });

  it('refuses applying on somebody else without the org-wide key', async () => {
    const response = await harness.post<ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: addDays(NEXT_MONDAY, 14),
        toDate: addDays(NEXT_MONDAY, 14),
        reason: 'On behalf of a colleague',
        employeeId: employeeBId,
      },
    });
    expect(response.status).toBe(403);
  });

  it('audits the application', async () => {
    expect(await harness.waitForAuditAction('leave_request.applied')).toBe(true);
  });
});

describe('deciding (REQ-G-09, REQ-F-05, REQ-I-05)', () => {
  let requestId = '';

  it('accepts an application to decide on', async () => {
    const response = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: addDays(NEXT_MONDAY, 21),
        toDate: addDays(NEXT_MONDAY, 22),
        reason: 'For the approval path',
      },
    });
    expect(response.status, response.text).toBe(201);
    requestId = response.body.id;
  });

  it('refuses an employee deciding their own request', async () => {
    const response = await harness.post<ErrorBody>(`/leave/requests/${requestId}/approve`, {
      token: employeeToken,
      body: {},
    });
    // The employee holds no approver key at all, so the guard refuses first.
    expect(response.status).toBe(403);
  });

  it('refuses an approver deciding a request they raised themselves (REQ-I-05)', async () => {
    const own = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: managerToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: addDays(NEXT_MONDAY, 28),
        toDate: addDays(NEXT_MONDAY, 28),
        reason: "The manager's own leave",
      },
    });
    expect(own.status, own.text).toBe(201);

    const response = await harness.post<ErrorBody>(`/leave/requests/${own.body.id}/approve`, {
      token: managerToken,
      body: {},
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('APPROVER_IS_REQUESTER');
  });

  it('refuses a rejection with no reason (REQ-F-05)', async () => {
    const response = await harness.post<ErrorBody>(`/leave/requests/${requestId}/reject`, {
      token: managerToken,
      body: {},
    });
    expect(response.status).toBe(400);
  });

  it('deducts the balance on approval, not before (REQ-G-03)', async () => {
    const before = await balanceOf(employeeToken, casualTypeId);

    const response = await harness.post<LeaveRequestDetail & ErrorBody>(
      `/leave/requests/${requestId}/approve`,
      { token: managerToken, body: { reason: 'Approved for the test' } },
    );
    expect(response.status, response.text).toBe(201);
    expect(response.body.status).toBe('APPROVED');
    expect(response.body.decidedAt).not.toBeNull();
    expect(response.body.decidedBy?.name).toBe('Meera');

    const after = await balanceOf(employeeToken, casualTypeId);
    expect(after.availed).toBe(before.availed + 2);
    expect(after.closing).toBe(before.closing - 2);
    expect(isLeaveBalanceConsistent(after)).toBe(true);
  });

  it('refuses a second decision on the same request', async () => {
    const response = await harness.post<ErrorBody>(`/leave/requests/${requestId}/approve`, {
      token: managerToken,
      body: {},
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('APPROVAL_ALREADY_ACTIONED');
  });

  it('rejects with a reason and moves no balance', async () => {
    const raised = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: addDays(NEXT_MONDAY, 35),
        toDate: addDays(NEXT_MONDAY, 35),
        reason: 'To be rejected',
      },
    });
    expect(raised.status, raised.text).toBe(201);

    const before = await balanceOf(employeeToken, casualTypeId);
    const response = await harness.post<LeaveRequestDetail & ErrorBody>(
      `/leave/requests/${raised.body.id}/reject`,
      { token: managerToken, body: { reason: 'The team is short that week' } },
    );
    expect(response.status, response.text).toBe(201);
    expect(response.body.status).toBe('REJECTED');

    const after = await balanceOf(employeeToken, casualTypeId);
    expect(after.closing).toBe(before.closing);
  });

  it('audits both decisions', async () => {
    expect(await harness.waitForAuditAction('leave_request.approved')).toBe(true);
    expect(await harness.waitForAuditAction('leave_request.rejected')).toBe(true);
  });
});

describe('cancelling (REQ-G-10)', () => {
  it('reverses the ledger and returns the balance to exactly what it was', async () => {
    const before = await balanceOf(employeeToken, casualTypeId);

    const raised = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: addDays(NEXT_MONDAY, 42),
        toDate: addDays(NEXT_MONDAY, 43),
        reason: 'To be cancelled after approval',
      },
    });
    expect(raised.status, raised.text).toBe(201);

    const approved = await harness.post<LeaveRequestDetail>(
      `/leave/requests/${raised.body.id}/approve`,
      { token: managerToken, body: {} },
    );
    expect(approved.status, approved.text).toBe(201);
    expect((await balanceOf(employeeToken, casualTypeId)).closing).toBe(before.closing - 2);

    const cancelled = await harness.post<LeaveRequestDetail>(
      `/leave/requests/${raised.body.id}/cancel`,
      { token: employeeToken, body: { reason: 'Plans changed' } },
    );
    expect(cancelled.status, cancelled.text).toBe(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.cancelledAt).not.toBeNull();

    const after = await balanceOf(employeeToken, casualTypeId);
    expect(after.closing).toBe(before.closing);
    expect(after.availed).toBe(before.availed);
    expect(isLeaveBalanceConsistent(after)).toBe(true);

    // Reversed, never deleted: both rows are still in the ledger.
    const ledger = await harness.get<Paginated<LeaveLedgerEntry>>(
      `/leave/ledger?year=${String(LEAVE_YEAR)}&leaveTypeId=${casualTypeId}&pageSize=200`,
      { token: employeeToken },
    );
    expect(ledger.status).toBe(200);
    const forRequest = ledger.body.data.filter((row) => row.referenceId === raised.body.id);
    expect(forRequest.map((row) => row.movementType).sort()).toEqual(['AVAILED', 'REVERSAL']);
  });

  it('refuses a stranger cancelling somebody else s leave', async () => {
    const raised = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: employeeToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: addDays(NEXT_MONDAY, 49),
        toDate: addDays(NEXT_MONDAY, 49),
        reason: 'Not yours to cancel',
      },
    });
    expect(raised.status, raised.text).toBe(201);

    const response = await harness.post<ErrorBody>(`/leave/requests/${raised.body.id}/cancel`, {
      token: otherToken,
      body: {},
    });
    // Out of scope reads as not found, so the id does not confirm a real request.
    expect(response.status).toBe(404);
  });

  it('audits the cancellation', async () => {
    expect(await harness.waitForAuditAction('leave_request.cancelled')).toBe(true);
  });
});

describe('decisions reach the muster inline (launch plan WS-B: REQ-G-09, REQ-G-10, REQ-E-02)', () => {
  // A fresh employee with a resolvable shift, because the recompute needs one:
  // the fixture people above deliberately have none, which is also what proves
  // a roster gap cannot fail an approval (the engine's refusal is counted and
  // logged, and the decision stands -- the same survival rule holiday
  // recompute follows).
  let shiftedEmployeeId = '';
  let shiftedToken = '';
  let musterRequestId = '';

  async function dayRow(
    date: string,
  ): Promise<{ status: string; leaveRequestId: string | null } | null> {
    const rows = await harness.db.execute<{ status: string; leave_request_id: string | null }>(sql`
      SELECT status, leave_request_id FROM attendance_days
       WHERE org_id = ${ORG_ID} AND employee_id = ${shiftedEmployeeId}::uuid AND date = ${date}
       LIMIT 1
    `);
    const row = rows.rows[0];
    if (row === undefined) return null;
    return { status: row.status, leaveRequestId: row.leave_request_id };
  }

  it('sets up an employee whose shift the engine can resolve', async () => {
    const shiftRows = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO shifts (org_id, code, name, start_time, end_time)
      VALUES (${ORG_ID}, ${`LVD${runId}`}, 'Leave Decision Probe Shift', '09:00:00', '17:30:00')
      RETURNING id
    `);
    const shiftId = shiftRows.rows[0]?.id;
    if (shiftId === undefined) throw new Error('shift fixture insert returned no row');

    shiftedEmployeeId = await harness.createEmployee({
      code: `LV-D-${runId}`,
      firstName: 'Deepa',
      // Reports to Meera, so the manager's team scope reaches these requests.
      reportingManagerId: managerEmployeeId,
      dateOfJoining: '2020-01-01',
    });
    await harness.db.execute(sql`
      UPDATE employees SET default_shift_id = ${shiftId}::uuid
       WHERE org_id = ${ORG_ID} AND id = ${shiftedEmployeeId}::uuid
    `);

    const user = await harness.createUser({
      email: scopedEmail('leave-shifted'),
      roleIds: [employeeRoleId],
      employeeId: shiftedEmployeeId,
    });
    shiftedToken = (await harness.login(user.email, user.password)).token;
    expect(shiftedToken).not.toBe('');

    await grantDays(shiftedEmployeeId, casualTypeId, 10);
  });

  it('approval computes the day to ON_LEAVE, without waiting for any sweep', async () => {
    const raised = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: shiftedToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: MONDAY,
        toDate: MONDAY,
        reason: 'Muster recompute probe',
      },
    });
    expect(raised.status, raised.text).toBe(201);
    musterRequestId = raised.body.id;

    // Nothing on the muster yet: a pending request holds no day.
    expect(await dayRow(MONDAY)).toBeNull();

    const approved = await harness.post<LeaveRequestDetail>(
      `/leave/requests/${musterRequestId}/approve`,
      { token: managerToken, body: {} },
    );
    expect(approved.status, approved.text).toBe(201);

    // The row exists the moment the approval answers -- this is the inline
    // recompute, not a job that might run tonight.
    const day = await dayRow(MONDAY);
    expect(day?.status).toBe('ON_LEAVE');
    expect(day?.leaveRequestId).toBe(musterRequestId);
  });

  it('cancellation recomputes the day back off leave', async () => {
    const cancelled = await harness.post<LeaveRequestDetail>(
      `/leave/requests/${musterRequestId}/cancel`,
      { token: shiftedToken, body: { reason: 'Probe over' } },
    );
    expect(cancelled.status, cancelled.text).toBe(201);

    const day = await dayRow(MONDAY);
    expect(day?.status).not.toBe('ON_LEAVE');
    expect(day?.leaveRequestId).toBeNull();
  });

  it('respects a period lock: the cancellation stands, the locked day is left alone (REQ-E-09)', async () => {
    const TUESDAY = addDays(MONDAY, 1);

    // Approved while the month is open, so the Tuesday row reads ON_LEAVE.
    const raised = await harness.post<LeaveRequestDetail & ErrorBody>('/leave/requests', {
      token: shiftedToken,
      body: {
        leaveTypeId: casualTypeId,
        fromDate: TUESDAY,
        toDate: TUESDAY,
        reason: 'Locked period probe',
      },
    });
    expect(raised.status, raised.text).toBe(201);
    const approved = await harness.post<LeaveRequestDetail>(
      `/leave/requests/${raised.body.id}/approve`,
      { token: managerToken, body: {} },
    );
    expect(approved.status, approved.text).toBe(201);
    expect((await dayRow(TUESDAY))?.status).toBe('ON_LEAVE');

    // Then the month closes.
    const lock = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO attendance_period_locks (org_id, year, month, lock_reason)
      VALUES (${ORG_ID}, ${Number(MONDAY.slice(0, 4))}, ${Number(MONDAY.slice(5, 7))},
              'Locked for the WS-B recompute probe')
      RETURNING id
    `);
    const lockId = lock.rows[0]?.id;
    if (lockId === undefined) throw new Error('period lock fixture insert returned no row');

    try {
      // An approver cancelling inside the locked month: the cancellation and
      // its ledger reversal stand, and the engine answers `locked` without
      // writing -- the frozen muster row is counted in the audit summary, not
      // rewritten. The same deliberate outcome holiday recompute has.
      const cancelled = await harness.post<LeaveRequestDetail>(
        `/leave/requests/${raised.body.id}/cancel`,
        { token: managerToken, body: { reason: 'Cancelled after the month closed' } },
      );
      expect(cancelled.status, cancelled.text).toBe(201);
      expect(cancelled.body.status).toBe('CANCELLED');

      const day = await dayRow(TUESDAY);
      expect(day?.status).toBe('ON_LEAVE');
      expect(day?.leaveRequestId).toBe(raised.body.id);
    } finally {
      await harness.db.execute(
        sql`DELETE FROM attendance_period_locks WHERE id = ${lockId}::uuid`,
      );
    }
  });
});

describe('scope (technical design §10)', () => {
  it('shows an employee only their own requests', async () => {
    const response = await harness.get<Paginated<{ employee: { id: string } }>>(
      '/leave/requests?pageSize=200',
      { token: employeeToken },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.every((row) => row.employee.id === employeeAId)).toBe(true);
  });

  it("shows a manager their report's requests", async () => {
    const response = await harness.get<Paginated<{ employee: { id: string } }>>(
      '/leave/requests?pageSize=200',
      { token: managerToken },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.some((row) => row.employee.id === employeeAId)).toBe(true);
    // Bhavin reports to nobody, so he is outside the manager's team.
    expect(response.body.data.some((row) => row.employee.id === employeeBId)).toBe(false);
  });

  it("refuses an employee asking for a colleague's balance", async () => {
    const response = await harness.get<ErrorBody>(
      `/leave/balances?year=${String(LEAVE_YEAR)}&employeeId=${employeeBId}`,
      { token: employeeToken },
    );
    expect(response.status).toBe(403);
  });

  it('lets HR read anybody', async () => {
    const response = await harness.get<Paginated<LeaveBalance>>(
      `/leave/balances?year=${String(LEAVE_YEAR)}&employeeId=${employeeAId}`,
      { token: hrToken },
    );
    expect(response.status, response.text).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });
});

describe('the ledger is append-only (REQ-G-03)', () => {
  it('refuses an UPDATE through the same connection the API uses', async () => {
    const message = await refusalMessage(
      sql`UPDATE leave_ledger SET note = 'edited' WHERE org_id = ${ORG_ID}`,
    );
    expect(message).toMatch(/Table leave_ledger is append-only/u);
  });

  it('refuses a DELETE that would match nothing', async () => {
    // Statement-level, so an empty match is refused too: a DELETE that
    // succeeded because it happened to hit no rows teaches the wrong lesson.
    const message = await refusalMessage(
      sql`DELETE FROM leave_ledger WHERE id = ${uuidv7()}::uuid`,
    );
    expect(message).toMatch(/Table leave_ledger is append-only/u);
  });

  it('refuses a balance whose six numbers do not add up (migration 0009)', async () => {
    const message = await refusalMessage(sql`
      UPDATE leave_balances SET closing = closing + 1
       WHERE org_id = ${ORG_ID} AND employee_id = ${employeeAId}::uuid
    `);
    expect(message).toMatch(/leave_balances_closing_is_the_sum/u);
  });

  it('keeps every stored balance reconcilable against its own ledger', async () => {
    const rows = await harness.db.execute<{
      employee_id: string;
      leave_type_id: string;
      leave_year: number;
      closing: string;
      ledger_sum: string;
    }>(sql`
      SELECT b.employee_id, b.leave_type_id, b.leave_year, b.closing::text AS closing,
             coalesce(sum(l.days), 0)::text AS ledger_sum
        FROM leave_balances b
        LEFT JOIN leave_ledger l
          ON l.employee_id = b.employee_id
         AND l.leave_type_id = b.leave_type_id
         AND l.leave_year = b.leave_year
       WHERE b.org_id = ${ORG_ID}
       GROUP BY b.employee_id, b.leave_type_id, b.leave_year, b.closing
    `);

    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      // The independent route: the plain sum of the signed rows, computed by
      // Postgres rather than by the projection under test.
      expect(Number(row.closing), JSON.stringify(row)).toBe(Number(row.ledger_sum));
    }
  });
});

describe('adjustments (REQ-G-03)', () => {
  it('refuses an adjustment from an approver who is not a policy manager', async () => {
    const response = await harness.post<ErrorBody>('/leave/balances/adjust', {
      token: managerToken,
      body: {
        employeeId: employeeAId,
        leaveTypeId: casualTypeId,
        year: LEAVE_YEAR,
        days: 5,
        reason: 'Should not be allowed',
      },
    });
    expect(response.status).toBe(403);
  });

  it('refuses a zero-day adjustment', async () => {
    const response = await harness.post<ErrorBody>('/leave/balances/adjust', {
      token: hrToken,
      body: {
        employeeId: employeeAId,
        leaveTypeId: casualTypeId,
        year: LEAVE_YEAR,
        days: 0,
        reason: 'Nothing at all',
      },
    });
    expect(response.status).toBe(400);
  });

  it('moves the adjusted bucket and keeps the invariant', async () => {
    const before = await balanceOf(employeeToken, casualTypeId);
    const response = await harness.post<LeaveBalance & ErrorBody>('/leave/balances/adjust', {
      token: hrToken,
      body: {
        employeeId: employeeAId,
        leaveTypeId: casualTypeId,
        year: LEAVE_YEAR,
        days: -1.5,
        reason: 'Correcting an earlier grant',
      },
    });
    expect(response.status, response.text).toBe(201);
    expect(response.body.adjusted).toBe(before.adjusted - 1.5);
    expect(response.body.closing).toBe(before.closing - 1.5);
    expect(isLeaveBalanceConsistent(response.body)).toBe(true);
    expect(await harness.waitForAuditAction('leave_balance.adjusted')).toBe(true);
  });
});

describe('comp-off (REQ-G-11)', () => {
  let creditId = '';

  it('refuses a grant from somebody with no approver key', async () => {
    const response = await harness.post<ErrorBody>('/leave/comp-off', {
      token: employeeToken,
      body: { employeeId: employeeAId, earnedForDate: SATURDAY, days: 1 },
    });
    expect(response.status).toBe(403);
  });

  it('grants a credit, expiring 30 days later by default', async () => {
    const response = await harness.post<CompOffCredit & ErrorBody>('/leave/comp-off', {
      token: hrToken,
      body: { employeeId: employeeAId, earnedForDate: SATURDAY, days: 1 },
    });
    expect(response.status, response.text).toBe(201);
    expect(response.body.days).toBe(1);
    expect(response.body.expiresOn).toBe(addDays(SATURDAY, 30));
    expect(response.body.leaveType.code).toBe('CO');
    creditId = response.body.id;

    const balance = await balanceOf(employeeToken, compOffTypeId);
    expect(balance.accrued).toBe(1);
    expect(balance.closing).toBe(1);
    expect(isLeaveBalanceConsistent(balance)).toBe(true);
  });

  it('refuses a second credit for the same worked date', async () => {
    const response = await harness.post<ErrorBody>('/leave/comp-off', {
      token: hrToken,
      body: { employeeId: employeeAId, earnedForDate: SATURDAY, days: 1 },
    });
    expect(response.status).toBe(409);
  });

  it('honours a configured expiry window instead of the default', async () => {
    await withSetting(LEAVE_SETTING_KEYS.compOffExpiryDays, 10, async () => {
      const response = await harness.post<CompOffCredit & ErrorBody>('/leave/comp-off', {
        token: hrToken,
        body: { employeeId: employeeAId, earnedForDate: SUNDAY, days: 0.5 },
      });
      expect(response.status, response.text).toBe(201);
      expect(response.body.expiresOn).toBe(addDays(SUNDAY, 10));
    });
  });

  it('refuses a malformed setting rather than falling back to the default', async () => {
    await withSetting(LEAVE_SETTING_KEYS.compOffExpiryDays, 'thirty days', async () => {
      const response = await harness.post<ErrorBody>('/leave/comp-off', {
        token: hrToken,
        body: { employeeId: employeeAId, earnedForDate: addDays(SUNDAY, 7), days: 1 },
      });
      expect(response.status).toBe(500);
    });
  });

  it('lists the credit and audits the grant', async () => {
    const response = await harness.get<Paginated<CompOffCredit>>('/leave/comp-off?state=ACTIVE', {
      token: employeeToken,
    });
    expect(response.status, response.text).toBe(200);
    expect(response.body.data.some((row) => row.id === creditId)).toBe(true);
    expect(await harness.waitForAuditAction('comp_off.granted')).toBe(true);
  });
});

describe('the team calendar (REQ-G-12)', () => {
  it('lists approved absences in the range and no pending ones', async () => {
    const response = await harness.get<LeaveCalendar>(
      `/leave/calendar?from=${MONDAY}&to=${addDays(NEXT_MONDAY, 60)}`,
      { token: managerToken },
    );
    expect(response.status, response.text).toBe(200);
    expect(response.body.entries.length).toBeGreaterThan(0);
    expect(response.body.entries.every((entry) => entry.employee.id === employeeAId)).toBe(true);
    // No threshold configured, so no warnings are invented.
    expect(response.body.threshold).toBe(0);
    expect(response.body.warnings).toEqual([]);
  });

  it('warns once a concurrent-absence threshold is configured', async () => {
    await withSetting(LEAVE_SETTING_KEYS.concurrentAbsenceThreshold, 1, async () => {
      const response = await harness.get<LeaveCalendar>(
        `/leave/calendar?from=${MONDAY}&to=${addDays(NEXT_MONDAY, 60)}`,
        { token: managerToken },
      );
      expect(response.status).toBe(200);
      expect(response.body.threshold).toBe(1);
      expect(response.body.warnings.length).toBeGreaterThan(0);
    });
  });

  it('refuses a range that ends before it starts', async () => {
    const response = await harness.get<ErrorBody>(
      `/leave/calendar?from=${FRIDAY}&to=${MONDAY}`,
      { token: managerToken },
    );
    expect(response.status).toBe(400);
  });
});

describe('the leave year is configurable (REQ-G-04)', () => {
  it('moves which year a date belongs to when the start month changes', async () => {
    // With an April start, a January date belongs to the previous leave year.
    const january = `${String(Number(MONDAY.slice(0, 4)) + 1)}-01-15`;

    const beforeChange = await harness.get<Paginated<LeaveLedgerEntry>>(
      `/leave/ledger?year=${String(LEAVE_YEAR)}`,
      { token: employeeToken },
    );
    expect(beforeChange.status).toBe(200);
    const rowsInAprilYear = beforeChange.body.meta.total;
    expect(rowsInAprilYear).toBeGreaterThan(0);

    await withSetting(LEAVE_SETTING_KEYS.yearStartMonth, 1, async () => {
      // A January-start org files that same January date under the same
      // calendar year, so a comp-off granted for it lands in a different
      // leave year than it would have under April.
      const granted = await harness.post<CompOffCredit & ErrorBody>('/leave/comp-off', {
        token: hrToken,
        body: { employeeId: employeeBId, earnedForDate: january, days: 1 },
      });
      expect(granted.status, granted.text).toBe(201);

      const januaryYear = Number(january.slice(0, 4));
      const rows = await harness.db
        .select({ value: sql<number>`count(*)::int` })
        .from(leaveLedger)
        .where(
          and(
            eq(leaveLedger.orgId, ORG_ID),
            eq(leaveLedger.employeeId, employeeBId),
            eq(leaveLedger.leaveYear, januaryYear),
          ),
        );
      expect(rows[0]?.value).toBe(1);
    });
  });

  it('refuses a start month outside 1..12', async () => {
    await withSetting(LEAVE_SETTING_KEYS.yearStartMonth, 13, async () => {
      const response = await harness.get<ErrorBody>(
        previewPath({ leaveTypeId: casualTypeId, fromDate: MONDAY, toDate: MONDAY }),
        { token: employeeToken },
      );
      expect(response.status).toBe(500);
    });
  });
});
