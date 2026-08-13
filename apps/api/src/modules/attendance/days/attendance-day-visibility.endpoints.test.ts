import {
  SYSTEM_ROLES,
  uuidv7,
  type AttendanceDayDetail,
  type AttendanceDaySummary,
  type Paginated,
  type PunchContext,
} from '@vyuha/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { organizations } from '../../../platform/db/schema/index.js';
import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';
import { localDateIn } from '../day-engine/calendar-date.js';
import { attendanceDays } from '../schema/index.js';

/**
 * `otMinutes` is withheld from a viewer who may see only their own attendance,
 * over real HTTP.
 *
 * The assertions are on the JSON text and on key presence, not on the parsed
 * value being undefined. `body.otMinutes === undefined` passes just as happily
 * when the request returned no row at all, or returned an error object, which
 * is exactly the probe that would let this ship broken. So every case here also
 * asserts that a sibling field *is* present with its seeded value: the row
 * arrived, it is the right row, and one field is missing from it.
 *
 * `preservePeople` because `attendance_days.employee_id` is RESTRICT -- an
 * employee with a computed day can never be deleted -- so codes are unique per
 * run.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e1';
const RUN = uuidv7().slice(-8);

/** A settled date in the past, so nothing recomputes it while the file runs. */
const DAY = '2026-04-14';

const REPORT_OT_MINUTES = 45;
const REPORT_WORKED_MINUTES = 525;
const MANAGER_OT_MINUTES = 30;
const MANAGER_WORKED_MINUTES = 510;

type DaysPage = Paginated<AttendanceDaySummary>;

let harness: ApiHarness;
let employeeToken = '';
let managerToken = '';
let hrToken = '';
let employeeId = '';
let managerEmployeeId = '';
let orgTimezone = 'Asia/Kolkata';
let today = '';

async function seedDay(input: {
  employeeId: string;
  date: string;
  otMinutes: number;
  workedMinutes: number;
}): Promise<void> {
  await harness.db
    .insert(attendanceDays)
    .values({
      orgId: ORG_ID,
      employeeId: input.employeeId,
      date: input.date,
      status: 'PRESENT',
      workedMinutes: input.workedMinutes,
      otMinutes: input.otMinutes,
      lateMinutes: 0,
      earlyExitMinutes: 0,
    })
    .onConflictDoUpdate({
      target: [attendanceDays.employeeId, attendanceDays.date],
      set: {
        status: 'PRESENT',
        workedMinutes: input.workedMinutes,
        otMinutes: input.otMinutes,
        deletedAt: null,
      },
    });
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Overtime Visibility Fixture Org', {
    preservePeople: true,
  });

  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE, { isSystem: true });
  const operationsRoleId = await harness.createSystemRole(SYSTEM_ROLES.OPERATIONS, {
    isSystem: true,
  });
  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR, { isSystem: true });

  managerEmployeeId = await harness.createEmployee({
    code: `OTM-${RUN}`,
    firstName: 'Meera',
    lastName: 'Nair',
  });
  employeeId = await harness.createEmployee({
    code: `OTE-${RUN}`,
    firstName: 'Arjun',
    lastName: 'Rao',
    reportingManagerId: managerEmployeeId,
  });

  const employeeUser = await harness.createUser({
    email: scopedEmail('ot-employee'),
    roleIds: [employeeRoleId],
    employeeId,
  });
  const managerUser = await harness.createUser({
    email: scopedEmail('ot-manager'),
    roleIds: [operationsRoleId],
    employeeId: managerEmployeeId,
  });
  const hrUser = await harness.createUser({ email: scopedEmail('ot-hr'), roleIds: [hrRoleId] });

  employeeToken = (await harness.login(employeeUser.email, employeeUser.password)).token;
  managerToken = (await harness.login(managerUser.email, managerUser.password)).token;
  hrToken = (await harness.login(hrUser.email, hrUser.password)).token;
  expect(employeeToken).not.toBe('');
  expect(managerToken).not.toBe('');
  expect(hrToken).not.toBe('');

  const org = await harness.db
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, ORG_ID));
  orgTimezone = org[0]?.timezone ?? orgTimezone;
  // The same function `PunchService.context` uses, so `GET /me/today` and this
  // file cannot disagree about which date "today" is for this employee.
  today = localDateIn(new Date(), orgTimezone);

  await seedDay({
    employeeId,
    date: DAY,
    otMinutes: REPORT_OT_MINUTES,
    workedMinutes: REPORT_WORKED_MINUTES,
  });
  await seedDay({
    employeeId: managerEmployeeId,
    date: DAY,
    otMinutes: MANAGER_OT_MINUTES,
    workedMinutes: MANAGER_WORKED_MINUTES,
  });
  await seedDay({
    employeeId,
    date: today,
    otMinutes: REPORT_OT_MINUTES,
    workedMinutes: REPORT_WORKED_MINUTES,
  });
}, 30_000);

afterAll(async () => {
  // Left standing deliberately: the rows are the fixture, the employees cannot
  // be deleted anyway, and the upsert above makes a re-run idempotent.
  await harness.close();
});

describe('GET /attendance/days withholds overtime from a self-only viewer', () => {
  it('sends the employee their own row without an otMinutes key at all', async () => {
    const page = await harness.get<DaysPage>(
      `/attendance/days?employeeId=${employeeId}&from=${DAY}&to=${DAY}`,
      { token: employeeToken },
    );

    expect(page.status, page.text).toBe(200);
    const row = page.body.data[0];
    expect(row, page.text).toBeDefined();
    if (row === undefined) return;

    // The row really is the seeded one, so "no otMinutes" cannot be "no row".
    expect(row.date).toBe(DAY);
    expect(row.workedMinutes).toBe(REPORT_WORKED_MINUTES);

    expect(Object.hasOwn(row, 'otMinutes')).toBe(false);
    // The JSON itself, not the parsed object: a serialiser that emits
    // `"otMinutes":null` would satisfy every assertion above and still put the
    // field on the wire.
    expect(page.text).not.toContain('otMinutes');
  });

  it('keeps the other measurements, so this is one field and not a blanket redaction', async () => {
    const page = await harness.get<DaysPage>(
      `/attendance/days?employeeId=${employeeId}&from=${DAY}&to=${DAY}`,
      { token: employeeToken },
    );
    const row = page.body.data[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.lateMinutes).toBe(0);
    expect(row.earlyExitMinutes).toBe(0);
    expect(row.breakMinutes).toBe(0);
    expect(row.status).toBe('PRESENT');
  });

  it('withholds it from the single-day view as well', async () => {
    const detail = await harness.get<AttendanceDayDetail>(
      `/attendance/days/${employeeId}/${DAY}`,
      { token: employeeToken },
    );

    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.workedMinutes).toBe(REPORT_WORKED_MINUTES);
    expect(Array.isArray(detail.body.punches)).toBe(true);
    expect(Object.hasOwn(detail.body, 'otMinutes')).toBe(false);
    expect(detail.text).not.toContain('otMinutes');
  });

  it("withholds it from the day embedded in GET /me/today", async () => {
    const context = await harness.get<PunchContext>('/me/today', { token: employeeToken });

    expect(context.status, context.text).toBe(200);
    const day = context.body.day;
    expect(day, context.text).not.toBeNull();
    if (day === null) return;

    expect(day.date).toBe(today);
    expect(day.workedMinutes).toBe(REPORT_WORKED_MINUTES);
    expect(Object.hasOwn(day, 'otMinutes')).toBe(false);
    expect(context.text).not.toContain('otMinutes');
  });

  it('still refuses the rows it always refused, so nothing was traded for this', async () => {
    const page = await harness.get<DaysPage>(
      `/attendance/days?employeeId=${managerEmployeeId}&from=${DAY}&to=${DAY}`,
      { token: employeeToken },
    );

    expect(page.status, page.text).toBe(200);
    expect(page.body.data).toHaveLength(0);
  });
});

describe('a viewer holding a management key still sees overtime', () => {
  it('sends it to HR, who holds attendance.view.all', async () => {
    const page = await harness.get<DaysPage>(
      `/attendance/days?employeeId=${employeeId}&from=${DAY}&to=${DAY}`,
      { token: hrToken },
    );

    expect(page.status, page.text).toBe(200);
    const row = page.body.data[0];
    expect(row, page.text).toBeDefined();
    expect(row?.otMinutes).toBe(REPORT_OT_MINUTES);
  });

  it('sends it to HR on the single-day view', async () => {
    const detail = await harness.get<AttendanceDayDetail>(
      `/attendance/days/${employeeId}/${DAY}`,
      { token: hrToken },
    );

    expect(detail.status, detail.text).toBe(200);
    expect(detail.body.otMinutes).toBe(REPORT_OT_MINUTES);
  });

  it('sends it to a manager holding attendance.view.team for their report', async () => {
    const page = await harness.get<DaysPage>(
      `/attendance/days?employeeId=${employeeId}&from=${DAY}&to=${DAY}`,
      { token: managerToken },
    );

    expect(page.status, page.text).toBe(200);
    expect(page.body.data[0]?.otMinutes).toBe(REPORT_OT_MINUTES);
  });

  /**
   * The edge that looks like a bug and is not. The rule is about the key the
   * viewer holds, not about whose row it is, so a manager sees overtime on
   * their own row too. Asserted rather than left to be rediscovered.
   */
  it('sends a manager their own overtime, because they hold the team key', async () => {
    const page = await harness.get<DaysPage>(
      `/attendance/days?employeeId=${managerEmployeeId}&from=${DAY}&to=${DAY}`,
      { token: managerToken },
    );

    expect(page.status, page.text).toBe(200);
    const row = page.body.data[0];
    expect(row, page.text).toBeDefined();
    expect(row?.otMinutes).toBe(MANAGER_OT_MINUTES);
  });
});
