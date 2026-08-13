import {
  SYSTEM_ROLES,
  uuidv7,
  type HolidayCalendarRecord,
  type HolidayImportReport,
  type HolidayRecord,
  type Paginated,
  type RestrictedHolidayPool,
  type RestrictedHolidayResult,
} from '@vyuha/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { employees, locations } from '../../../platform/db/schema/index.js';
import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';
import { attendanceDays, holidayCalendars, shiftAssignments, shifts } from '../schema/index.js';

/**
 * REQ-H-01 … REQ-H-04 over real HTTP against the real application: the guard,
 * the Zod pipe, the audit interceptor, and -- the part worth the wall clock --
 * the day engine, which every holiday change has to drive (REQ-H-04's "changing
 * a holiday recomputes the affected days").
 *
 * The recompute assertions read `attendance_days` directly rather than a
 * response field. A response could report "3 recomputed" while writing nothing;
 * the row on disk is the thing the muster and the payroll export read, so that
 * is what gets asserted.
 *
 * Started with `preservePeople`: the recompute writes an `attendance_days` row
 * per employee, and `attendance_days.employee_id` is RESTRICT, so an employee
 * this file touches can never be deleted again. People, locations and shifts
 * are therefore minted per run with unique codes, exactly as the punch suite
 * does and for the same reason.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e2';
/** Far enough out that nothing else in the suite computes days here. */
const YEAR = 2031;
const PUBLIC_DATE = `${String(YEAR)}-03-10`;
const RESTRICTED_DATE = `${String(YEAR)}-03-11`;
const MOVE_FROM = `${String(YEAR)}-04-01`;
const MOVE_TO = `${String(YEAR)}-04-02`;

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let harness: ApiHarness;
let runId: string;

/** Inherits the calendar through their location (REQ-H-02). */
let inheritingEmployeeId = '';
/** Points at the calendar directly, overriding a location that has none. */
let overridingEmployeeId = '';
/** No calendar at all; the control for "recomputed nobody it should not". */
let unaffectedEmployeeId = '';

let fixtureCalendarId = '';
let hrToken = '';
let opsToken = '';
let selfToken = '';

async function statusOn(employeeId: string, date: string): Promise<string | null> {
  const rows = await harness.db
    .select({ status: attendanceDays.status })
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date)))
    .limit(1);
  return rows[0]?.status ?? null;
}

async function addHoliday(
  body: { date: string; name: string; restricted?: boolean },
  token = hrToken,
): Promise<{ status: number; body: HolidayRecord & ErrorBody; text: string }> {
  return harness.post<HolidayRecord & ErrorBody>(
    `/holiday-calendars/${fixtureCalendarId}/holidays`,
    { token, body },
  );
}

async function setAllowance(value: number): Promise<void> {
  const result = await harness.patch<HolidayCalendarRecord>(
    `/holiday-calendars/${fixtureCalendarId}`,
    { token: hrToken, body: { restrictedAllowance: value } },
  );
  expect(result.status, result.text).toBe(200);
  expect(result.body.restrictedAllowance).toBe(value);
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Holiday Endpoints Fixture Org', {
    preservePeople: true,
  });
  runId = uuidv7().slice(-8);

  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR);
  const opsRoleId = await harness.createSystemRole(SYSTEM_ROLES.OPERATIONS);
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);

  const calendarRows = await harness.db
    .insert(holidayCalendars)
    .values({ orgId: ORG_ID, name: `Fixture ${runId}`, year: YEAR, restrictedAllowance: 0 })
    .returning({ id: holidayCalendars.id });
  fixtureCalendarId = calendarRows[0]?.id ?? '';
  expect(fixtureCalendarId).not.toBe('');

  const locationRows = await harness.db
    .insert(locations)
    .values({
      orgId: ORG_ID,
      code: `HC-${runId}`,
      name: `Holiday Probe Office ${runId}`,
      holidayCalendarId: fixtureCalendarId,
    })
    .returning({ id: locations.id });
  const locationId = locationRows[0]?.id;
  if (locationId === undefined) throw new Error('location fixture insert returned no row');

  inheritingEmployeeId = await harness.createEmployee({
    code: `HL-INH-${runId}`,
    firstName: 'Ira',
    locationId,
    dateOfJoining: `${String(YEAR - 1)}-01-01`,
  });
  overridingEmployeeId = await harness.createEmployee({
    code: `HL-OWN-${runId}`,
    firstName: 'Omkar',
    dateOfJoining: `${String(YEAR - 1)}-01-01`,
  });
  unaffectedEmployeeId = await harness.createEmployee({
    code: `HL-NON-${runId}`,
    firstName: 'Nina',
    dateOfJoining: `${String(YEAR - 1)}-01-01`,
  });

  // REQ-H-02's second half: an employee-level calendar overrides the location's.
  await harness.db
    .update(employees)
    .set({ holidayCalendarId: fixtureCalendarId })
    .where(eq(employees.id, overridingEmployeeId));

  // The engine refuses a date with no shift (REQ-C-04), and a refusal would be
  // counted as `failed` rather than exercising the recompute. Every affected
  // employee therefore has one covering the whole year.
  const shiftRows = await harness.db
    .insert(shifts)
    .values({
      orgId: ORG_ID,
      code: `HL-${runId}`,
      name: 'Holiday Probe Shift (test only)',
      startTime: '09:00:00',
      endTime: '18:00:00',
      breakMinutes: 60,
    })
    .returning({ id: shifts.id });
  const shiftId = shiftRows[0]?.id;
  if (shiftId === undefined) throw new Error('shift fixture insert returned no row');

  await harness.db.insert(shiftAssignments).values(
    [inheritingEmployeeId, overridingEmployeeId, unaffectedEmployeeId].map((employeeId) => ({
      orgId: ORG_ID,
      employeeId,
      shiftId,
      effectiveFrom: `${String(YEAR)}-01-01`,
      effectiveTo: `${String(YEAR)}-12-31`,
    })),
  );

  const hrUser = await harness.createUser({ email: scopedEmail('hol-hr'), roleIds: [hrRoleId] });
  // employee.view but not holiday.manage: the 403s below then prove the write
  // key is what is missing, rather than the caller having no keys at all.
  const opsUser = await harness.createUser({ email: scopedEmail('hol-ops'), roleIds: [opsRoleId] });
  const selfUser = await harness.createUser({
    email: scopedEmail('hol-self'),
    roleIds: [employeeRoleId],
    employeeId: inheritingEmployeeId,
  });

  hrToken = (await harness.login(hrUser.email, hrUser.password)).token;
  opsToken = (await harness.login(opsUser.email, opsUser.password)).token;
  selfToken = (await harness.login(selfUser.email, selfUser.password)).token;
  expect([hrToken, opsToken, selfToken].every((token) => token !== '')).toBe(true);
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('access control', () => {
  it('refuses an unauthenticated request on every route', async () => {
    for (const [method, path] of [
      ['GET', '/holiday-calendars'],
      ['POST', '/holiday-calendars'],
      ['PATCH', `/holiday-calendars/${fixtureCalendarId}`],
      ['POST', `/holiday-calendars/${fixtureCalendarId}/holidays`],
      ['POST', `/holiday-calendars/${fixtureCalendarId}/holidays/import/validate`],
      ['POST', `/holiday-calendars/${fixtureCalendarId}/holidays/import/commit`],
      ['GET', '/restricted-holidays'],
      ['POST', '/restricted-holidays'],
    ] as const) {
      const result = await harness.request(method, path);
      expect(result.status, `${method} ${path}`).toBe(401);
    }
  });

  it('lets employee.view read the calendars', async () => {
    const result = await harness.get<Paginated<HolidayCalendarRecord>>('/holiday-calendars', {
      token: opsToken,
    });
    expect(result.status, result.text).toBe(200);
  });

  it('refuses every write without holiday.manage', async () => {
    const create = await harness.post('/holiday-calendars', {
      token: opsToken,
      body: { name: `Denied ${runId}`, year: YEAR },
    });
    expect(create.status).toBe(403);

    const patch = await harness.patch(`/holiday-calendars/${fixtureCalendarId}`, {
      token: opsToken,
      body: { name: 'Denied' },
    });
    expect(patch.status).toBe(403);

    const holiday = await addHoliday({ date: `${String(YEAR)}-12-25`, name: 'Denied' }, opsToken);
    expect(holiday.status).toBe(403);

    const commit = await harness.post(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/commit`,
      { token: opsToken, body: { rows: [{ date: `${String(YEAR)}-12-25`, name: 'Denied' }] } },
    );
    expect(commit.status).toBe(403);
  });

  it('refuses a read from an account with neither view nor manage', async () => {
    // The Employee role has attendance.view.self and nothing that names people,
    // so the calendar list is closed to it while its own pool is not.
    const result = await harness.get('/holiday-calendars', { token: selfToken });
    expect(result.status).toBe(403);
  });
});

describe('holiday calendars (REQ-H-01)', () => {
  let createdId = '';

  it('creates one and audits it', async () => {
    const created = await harness.post<HolidayCalendarRecord>('/holiday-calendars', {
      token: hrToken,
      body: { name: `South India ${runId}`, year: YEAR, restrictedAllowance: 2 },
    });

    expect(created.status, created.text).toBe(201);
    expect(created.body.name).toBe(`South India ${runId}`);
    expect(created.body.year).toBe(YEAR);
    expect(created.body.restrictedAllowance).toBe(2);
    // REQ-H-01: "no dates ship assumed" -- a new calendar is empty.
    expect(created.body.holidays).toEqual([]);
    expect(created.body.locations).toEqual([]);
    createdId = created.body.id;

    // Keyed on the id rather than the action: the action name would be
    // satisfied by a row a previous run of this file wrote.
    expect(await harness.waitForAuditEntity(createdId)).toBe(true);
  });

  it('refuses a second calendar with the same name in the same year', async () => {
    const clash = await harness.post<ErrorBody>('/holiday-calendars', {
      token: hrToken,
      body: { name: `South India ${runId}`, year: YEAR },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('CONFLICT');
  });

  it('allows the same name in a different year', async () => {
    const next = await harness.post<HolidayCalendarRecord>('/holiday-calendars', {
      token: hrToken,
      body: { name: `South India ${runId}`, year: YEAR + 1 },
    });
    expect(next.status, next.text).toBe(201);
  });

  it('renames one and changes its allowance', async () => {
    const updated = await harness.patch<HolidayCalendarRecord>(`/holiday-calendars/${createdId}`, {
      token: hrToken,
      body: { name: `Southern ${runId}`, restrictedAllowance: 3 },
    });
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body.name).toBe(`Southern ${runId}`);
    expect(updated.body.restrictedAllowance).toBe(3);
    expect(await harness.waitForAuditAction('holiday.calendar.updated')).toBe(true);
  });

  it('filters by year and names the locations that inherit each calendar (REQ-H-02)', async () => {
    const listed = await harness.get<Paginated<HolidayCalendarRecord>>(
      `/holiday-calendars?year=${String(YEAR)}&pageSize=200`,
      { token: hrToken },
    );
    expect(listed.status, listed.text).toBe(200);
    expect(listed.body.data.every((calendar) => calendar.year === YEAR)).toBe(true);

    const fixture = listed.body.data.find((calendar) => calendar.id === fixtureCalendarId);
    expect(fixture?.locations).toEqual([`Holiday Probe Office ${runId}`]);

    const nextYear = await harness.get<Paginated<HolidayCalendarRecord>>(
      `/holiday-calendars?year=${String(YEAR + 1)}&pageSize=200`,
      { token: hrToken },
    );
    expect(nextYear.body.data.some((calendar) => calendar.id === fixtureCalendarId)).toBe(false);
  });

  it('rejects a year outside the accepted range', async () => {
    const rejected = await harness.post<ErrorBody>('/holiday-calendars', {
      token: hrToken,
      body: { name: `Ancient ${runId}`, year: 1200 },
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('answers 404 for a calendar in no organisation', async () => {
    const missing = await harness.patch<ErrorBody>(`/holiday-calendars/${uuidv7()}`, {
      token: hrToken,
      body: { name: 'Ghost' },
    });
    expect(missing.status).toBe(404);
  });
});

describe('holidays and the recompute they cause (REQ-H-04)', () => {
  let publicHolidayId = '';

  it('adds a holiday and turns the affected employees’ days into HOLIDAY', async () => {
    const created = await addHoliday({ date: PUBLIC_DATE, name: 'Fixture Public Day' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.restricted).toBe(false);
    publicHolidayId = created.body.id;

    // Both routes into REQ-H-02: through the location, and through the
    // employee's own column.
    expect(await statusOn(inheritingEmployeeId, PUBLIC_DATE)).toBe('HOLIDAY');
    expect(await statusOn(overridingEmployeeId, PUBLIC_DATE)).toBe('HOLIDAY');
    // And nobody else. An employee on no calendar must not acquire a day
    // because somebody else's calendar changed.
    expect(await statusOn(unaffectedEmployeeId, PUBLIC_DATE)).toBeNull();

    expect(await harness.waitForAuditEntity(publicHolidayId)).toBe(true);
  });

  it('refuses a second holiday on the same date', async () => {
    const clash = await addHoliday({ date: PUBLIC_DATE, name: 'Another Name' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('CONFLICT');
  });

  it('refuses a date outside the calendar’s year', async () => {
    const wrong = await addHoliday({ date: `${String(YEAR + 1)}-01-01`, name: 'Next Year' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a date that is not a real one', async () => {
    const impossible = await addHoliday({ date: `${String(YEAR)}-02-30`, name: 'Nowhere Day' });
    expect(impossible.status).toBe(400);
  });

  it('moves a holiday and recomputes both the date it left and the date it reached', async () => {
    const created = await addHoliday({ date: MOVE_FROM, name: 'Moving Day' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await statusOn(inheritingEmployeeId, MOVE_FROM)).toBe('HOLIDAY');

    const moved = await harness.patch<HolidayRecord>(`/holidays/${created.body.id}`, {
      token: hrToken,
      body: { date: MOVE_TO },
    });
    expect(moved.status, moved.text).toBe(200);
    expect(moved.body.date).toBe(MOVE_TO);

    // The date it left must stop being a holiday. Recomputing only the new date
    // is the bug this asserts against: the old row would sit there as HOLIDAY
    // with nothing in any calendar to explain it.
    // ABSENT rather than "not HOLIDAY": a missing row would satisfy the
    // weaker assertion, and a missing row is exactly what a recompute that
    // never ran would leave behind.
    expect(await statusOn(inheritingEmployeeId, MOVE_FROM)).toBe('ABSENT');
    expect(await statusOn(inheritingEmployeeId, MOVE_TO)).toBe('HOLIDAY');
    expect(await harness.waitForAuditAction('holiday.updated')).toBe(true);
  });

  it('deletes a holiday, recomputes the date, and answers 204', async () => {
    const removed = await harness.request('DELETE', `/holidays/${publicHolidayId}`, {
      token: hrToken,
    });
    expect(removed.status, removed.text).toBe(204);
    expect(await statusOn(inheritingEmployeeId, PUBLIC_DATE)).toBe('ABSENT');
    expect(await harness.waitForAuditEntity(publicHolidayId)).toBe(true);

    // Gone from the read model too, not merely from the day engine's answer.
    const listed = await harness.get<Paginated<HolidayCalendarRecord>>(
      `/holiday-calendars?year=${String(YEAR)}&pageSize=200`,
      { token: hrToken },
    );
    const fixture = listed.body.data.find((calendar) => calendar.id === fixtureCalendarId);
    expect(fixture?.holidays.some((holiday) => holiday.id === publicHolidayId)).toBe(false);
  });

  it('answers 404 for a holiday that does not exist', async () => {
    const missing = await harness.request('DELETE', `/holidays/${uuidv7()}`, { token: hrToken });
    expect(missing.status).toBe(404);
  });
});

describe('bulk import (REQ-H-04)', () => {
  const rows = [
    { date: `${String(YEAR)}-08-15`, name: 'Independence Day' },
    { date: `${String(YEAR)}-10-02`, name: 'Gandhi Jayanti' },
    { date: RESTRICTED_DATE, name: 'Optional Festival', restricted: true },
  ];

  it('validates without writing anything', async () => {
    const report = await harness.post<HolidayImportReport>(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/validate`,
      { token: hrToken, body: { rows } },
    );

    expect(report.status, report.text).toBe(200);
    expect(report.body.dryRun).toBe(true);
    expect(report.body.counts.CREATE).toBe(3);
    expect(report.body.recompute).toBeUndefined();
    // The proof that "dry" is true: no day moved.
    expect(await statusOn(inheritingEmployeeId, `${String(YEAR)}-08-15`)).toBeNull();
  });

  it('reports a bad row on validate rather than refusing the whole preview', async () => {
    const report = await harness.post<HolidayImportReport>(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/validate`,
      {
        token: hrToken,
        body: { rows: [...rows, { date: `${String(YEAR - 1)}-01-01`, name: 'Last year' }] },
      },
    );
    expect(report.status, report.text).toBe(200);
    expect(report.body.counts.ERROR).toBe(1);
    expect(report.body.rows[3]?.row).toBe(4);
  });

  it('refuses to commit a sheet with a bad row, and writes none of it', async () => {
    const refused = await harness.post<ErrorBody>(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/commit`,
      {
        token: hrToken,
        body: { rows: [...rows, { date: `${String(YEAR - 1)}-01-01`, name: 'Last year' }] },
      },
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
    expect(await statusOn(inheritingEmployeeId, `${String(YEAR)}-08-15`)).toBeNull();
  });

  it('commits, recomputes every created date, and reports what it did', async () => {
    const report = await harness.post<HolidayImportReport>(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/commit`,
      { token: hrToken, body: { rows } },
    );

    expect(report.status, report.text).toBe(200);
    expect(report.body.dryRun).toBe(false);
    expect(report.body.counts.CREATE).toBe(3);
    // Two employees on this calendar, three dates: six employee-days.
    expect(report.body.recompute?.considered).toBe(6);
    expect(report.body.recompute?.failed).toBe(0);

    expect(await statusOn(inheritingEmployeeId, `${String(YEAR)}-08-15`)).toBe('HOLIDAY');
    expect(await statusOn(overridingEmployeeId, `${String(YEAR)}-10-02`)).toBe('HOLIDAY');
    // REQ-H-03: a restricted holiday nobody elected is an ordinary day.
    expect(await statusOn(inheritingEmployeeId, RESTRICTED_DATE)).toBe('ABSENT');

    expect(await harness.waitForAuditAction('holiday.imported')).toBe(true);
  });

  it('is safe to re-run: the second pass changes nothing', async () => {
    const again = await harness.post<HolidayImportReport>(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/commit`,
      { token: hrToken, body: { rows } },
    );
    expect(again.status, again.text).toBe(200);
    expect(again.body.counts.UNCHANGED).toBe(3);
    expect(again.body.counts.CREATE).toBe(0);
    expect(again.body.recompute?.considered).toBe(0);
  });

  it('skips a renamed date unless overwrite is asked for', async () => {
    const renamed = [{ date: `${String(YEAR)}-08-15`, name: 'Independence Day (national)' }];

    const skipped = await harness.post<HolidayImportReport>(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/commit`,
      { token: hrToken, body: { rows: renamed } },
    );
    expect(skipped.body.counts.SKIPPED).toBe(1);

    const overwritten = await harness.post<HolidayImportReport>(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/commit`,
      { token: hrToken, body: { rows: renamed, overwriteExisting: true } },
    );
    expect(overwritten.body.counts.UPDATE).toBe(1);

    const listed = await harness.get<Paginated<HolidayCalendarRecord>>(
      `/holiday-calendars?year=${String(YEAR)}&pageSize=200`,
      { token: hrToken },
    );
    const fixture = listed.body.data.find((calendar) => calendar.id === fixtureCalendarId);
    expect(
      fixture?.holidays.find((holiday) => holiday.date === `${String(YEAR)}-08-15`)?.name,
    ).toBe('Independence Day (national)');
  });

  it('rejects an empty sheet and one past the row cap', async () => {
    const empty = await harness.post<ErrorBody>(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/validate`,
      { token: hrToken, body: { rows: [] } },
    );
    expect(empty.status).toBe(400);

    const huge = await harness.post<ErrorBody>(
      `/holiday-calendars/${fixtureCalendarId}/holidays/import/validate`,
      {
        token: hrToken,
        body: {
          rows: Array.from({ length: 401 }, (_unused, index) => ({
            date: `${String(YEAR)}-01-01`,
            name: `Row ${String(index)}`,
          })),
        },
      },
    );
    expect(huge.status).toBe(400);
  });
});

describe('restricted holidays (REQ-H-03)', () => {
  let restrictedHolidayId = '';
  let secondRestrictedId = '';

  beforeAll(async () => {
    const listed = await harness.get<Paginated<HolidayCalendarRecord>>(
      `/holiday-calendars?year=${String(YEAR)}&pageSize=200`,
      { token: hrToken },
    );
    const fixture = listed.body.data.find((calendar) => calendar.id === fixtureCalendarId);
    restrictedHolidayId =
      fixture?.holidays.find((holiday) => holiday.date === RESTRICTED_DATE)?.id ?? '';
    expect(restrictedHolidayId).not.toBe('');

    const second = await addHoliday({
      date: `${String(YEAR)}-11-04`,
      name: 'Second Optional Festival',
      restricted: true,
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    secondRestrictedId = second.body.id;
  });

  it('lets an employee read their own pool without any management key', async () => {
    const pool = await harness.get<RestrictedHolidayPool>('/restricted-holidays', {
      token: selfToken,
    });
    expect(pool.status, pool.text).toBe(200);
    expect(pool.body.employeeId).toBe(inheritingEmployeeId);
    expect(pool.body.calendarId).toBe(fixtureCalendarId);
    // Only restricted days are in the pool; the public ones are everyone's.
    expect(pool.body.options.every((option) => option.restricted)).toBe(true);
    expect(pool.body.options.some((option) => option.id === restrictedHolidayId)).toBe(true);
  });

  it('answers an empty pool for a year the employee’s calendar is not filed under', async () => {
    const pool = await harness.get<RestrictedHolidayPool>(
      `/restricted-holidays?year=${String(YEAR + 1)}`,
      { token: selfToken },
    );
    expect(pool.status, pool.text).toBe(200);
    expect(pool.body.calendarId).toBeNull();
    expect(pool.body.options).toEqual([]);
  });

  it('refuses an election while the calendar offers no allowance', async () => {
    const refused = await harness.post<ErrorBody>('/restricted-holidays', {
      token: selfToken,
      body: { holidayId: restrictedHolidayId },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details?.reason).toBe('NOT_ENABLED');
  });

  it('elects one once an allowance exists, and marks the day for that employee only', async () => {
    await setAllowance(1);

    const elected = await harness.post<RestrictedHolidayResult>('/restricted-holidays', {
      token: selfToken,
      body: { holidayId: restrictedHolidayId },
    });
    expect(elected.status, elected.text).toBe(201);
    expect(elected.body.pool.used).toBe(1);
    expect(elected.body.pool.remaining).toBe(0);
    expect(elected.body.pool.options.find((o) => o.id === restrictedHolidayId)?.elected).toBe(true);

    // "marks the day HOLIDAY for them only" -- the other employee on the same
    // calendar, who elected nothing, keeps an ordinary day.
    expect(await statusOn(inheritingEmployeeId, RESTRICTED_DATE)).toBe('HOLIDAY');
    expect(await statusOn(overridingEmployeeId, RESTRICTED_DATE)).toBe('ABSENT');

    expect(await harness.waitForAuditAction('holiday.election.created')).toBe(true);
  });

  it('refuses a second election once the allowance is spent', async () => {
    const refused = await harness.post<ErrorBody>('/restricted-holidays', {
      token: selfToken,
      body: { holidayId: secondRestrictedId },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details?.reason).toBe('ALLOWANCE_EXHAUSTED');
  });

  it('refuses to elect the same day twice', async () => {
    const refused = await harness.post<ErrorBody>('/restricted-holidays', {
      token: selfToken,
      body: { holidayId: restrictedHolidayId },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details?.reason).toBe('ALREADY_ELECTED');
  });

  it('refuses to elect a public holiday', async () => {
    const publicHoliday = await addHoliday({
      date: `${String(YEAR)}-12-25`,
      name: 'Christmas',
    });
    expect(publicHoliday.status, JSON.stringify(publicHoliday.body)).toBe(201);

    const refused = await harness.post<ErrorBody>('/restricted-holidays', {
      token: selfToken,
      body: { holidayId: publicHoliday.body.id },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details?.reason).toBe('NOT_RESTRICTED');
  });

  it('refuses to elect on somebody else’s behalf without holiday.manage', async () => {
    const refused = await harness.post<ErrorBody>('/restricted-holidays', {
      token: selfToken,
      body: { holidayId: secondRestrictedId, employeeId: overridingEmployeeId },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
  });

  it('lets holiday.manage record an election for an employee', async () => {
    await setAllowance(2);

    const elected = await harness.post<RestrictedHolidayResult>('/restricted-holidays', {
      token: hrToken,
      body: { holidayId: secondRestrictedId, employeeId: overridingEmployeeId },
    });
    expect(elected.status, elected.text).toBe(201);
    expect(elected.body.pool.employeeId).toBe(overridingEmployeeId);
    expect(await statusOn(overridingEmployeeId, `${String(YEAR)}-11-04`)).toBe('HOLIDAY');
  });

  it('refuses a holiday from a calendar the employee does not follow', async () => {
    const other = await harness.post<HolidayCalendarRecord>('/holiday-calendars', {
      token: hrToken,
      body: { name: `Elsewhere ${runId}`, year: YEAR, restrictedAllowance: 2 },
    });
    expect(other.status, other.text).toBe(201);

    const foreign = await harness.post<HolidayRecord>(
      `/holiday-calendars/${other.body.id}/holidays`,
      { token: hrToken, body: { date: `${String(YEAR)}-05-01`, name: 'Elsewhere Day', restricted: true } },
    );
    expect(foreign.status, foreign.text).toBe(201);

    const refused = await harness.post<ErrorBody>('/restricted-holidays', {
      token: selfToken,
      body: { holidayId: foreign.body.id },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details?.reason).toBe('NOT_ON_CALENDAR');
  });

  it('withdraws an election and gives the day back', async () => {
    const withdrawn = await harness.request<RestrictedHolidayResult>(
      'DELETE',
      `/restricted-holidays/${restrictedHolidayId}`,
      { token: selfToken },
    );
    expect(withdrawn.status, withdrawn.text).toBe(200);
    expect(withdrawn.body.pool.used).toBe(0);
    expect(await statusOn(inheritingEmployeeId, RESTRICTED_DATE)).toBe('ABSENT');
    expect(await harness.waitForAuditAction('holiday.election.withdrawn')).toBe(true);
  });

  it('answers 404 when withdrawing an election that was never made', async () => {
    const missing = await harness.request(
      'DELETE',
      `/restricted-holidays/${restrictedHolidayId}`,
      { token: selfToken },
    );
    expect(missing.status).toBe(404);
  });

  it('withdraws every election when the holiday itself is deleted', async () => {
    const holiday = await addHoliday({
      date: `${String(YEAR)}-09-05`,
      name: 'Doomed Optional Day',
      restricted: true,
    });
    expect(holiday.status, JSON.stringify(holiday.body)).toBe(201);

    const elected = await harness.post<RestrictedHolidayResult>('/restricted-holidays', {
      token: selfToken,
      body: { holidayId: holiday.body.id },
    });
    expect(elected.status, elected.text).toBe(201);
    expect(await statusOn(inheritingEmployeeId, `${String(YEAR)}-09-05`)).toBe('HOLIDAY');

    const removed = await harness.request('DELETE', `/holidays/${holiday.body.id}`, {
      token: hrToken,
    });
    expect(removed.status, removed.text).toBe(204);

    // The election must not survive its holiday: it would keep consuming the
    // allowance for a day that no longer exists.
    expect(await statusOn(inheritingEmployeeId, `${String(YEAR)}-09-05`)).toBe('ABSENT');
    const pool = await harness.get<RestrictedHolidayPool>('/restricted-holidays', {
      token: selfToken,
    });
    expect(pool.body.used).toBe(0);
  });
});
