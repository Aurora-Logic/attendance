import {
  PERMISSIONS,
  REPORT_DEFINITIONS,
  SYSTEM_ROLES,
  uuidv7,
  type ExportDownload,
  type ExportJobSummary,
  type Paginated,
  type ReportKey,
} from '@vyuha/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../../../platform/common/env.js';
import { exportJobs, files } from '../../../platform/db/schema/index.js';
import { JobRunner } from '../../../platform/jobs/job-runner.service.js';
import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';
import {
  attendanceDays,
  leaveBalances,
  leaveLedger,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
  regularizations,
} from '../schema/index.js';

/**
 * The report definitions REQ-J-01 names, over real HTTP against the real
 * application (REQ-J-01, REQ-J-03, REQ-J-06).
 *
 * Two things are asserted for every one of them, and they are the two that
 * matter. The rows have to be the rows -- an aggregate that quietly counted a
 * page instead of a period would still return a plausible number, so the
 * fixtures are built so the right answer and the page-one answer differ. And
 * the scope has to bite: the same request from a manager returns strictly less
 * than it does from HR, proved by asking as the manager rather than by reading
 * the code that is supposed to narrow it.
 *
 * `preservePeople`, and per-run codes, for the reason the leave suite gives:
 * `leave_ledger` is append-only by trigger and RESTRICTs its employee, so an
 * employee with a ledger row can never be deleted. Every run mints its own
 * department, its own people and its own leave type, and every assertion
 * filters by the department -- which is also what keeps a previous run's rows
 * out of this run's totals.
 *
 * Payroll Input (REQ-J-04) is absent throughout, deliberately: the client
 * dropped it, and the last test in this file asserts the key answers 404 rather
 * than an empty table nobody could tell from a quiet month.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e8';
const RUN = uuidv7().slice(-8);

/** March 2026: fixed, because the people are unique per run and the dates need not be. */
const MONTH_FROM = '2026-03-01';
const MONTH_TO = '2026-03-31';

let harness: ApiHarness;
let runner: JobRunner;
let started = false;

let hrToken = '';
let managerToken = '';

let departmentId = '';
let locationId = '';
let managerEmployeeId = '';
let teamEmployeeId = '';
let outsideEmployeeId = '';
let leaveTypeId = '';

const createdExportIds: string[] = [];
const createdFileIds: string[] = [];

const TEAM_CODE = `DA-${RUN}`;
const OUTSIDE_CODE = `DX-${RUN}`;
const MANAGER_CODE = `DM-${RUN}`;

async function rows<T>(
  token: string,
  reportKey: ReportKey,
  query = '',
): Promise<Paginated<T>> {
  const result = await harness.get<Paginated<T>>(
    `/reports/${reportKey}/rows?from=${MONTH_FROM}&to=${MONTH_TO}&departmentId=${departmentId}${query}`,
    { token },
  );
  expect(result.status, `${reportKey} answered ${String(result.status)}`).toBe(200);
  return result.body;
}

async function waitForExport(token: string, id: string): Promise<ExportJobSummary> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const result = await harness.get<ExportJobSummary>(`/reports/exports/${id}`, { token });
    expect(result.status).toBe(200);
    if (result.body.status === 'DONE' || result.body.status === 'FAILED') return result.body;
    if (Date.now() >= deadline) {
      throw new Error(`Export ${id} never finished; last status ${result.body.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function downloadText(token: string, id: string): Promise<string> {
  const link = await harness.get<ExportDownload>(`/reports/exports/${id}/download`, { token });
  expect(link.status).toBe(200);
  const response = await fetch(link.body.url);
  expect(response.status).toBe(200);
  return response.text();
}

/** See the note in `report.endpoints.test.ts`: a crashed run pins the user it names. */
async function clearExportRowsBeforeStart(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    await pool.query('DELETE FROM export_jobs WHERE org_id = $1', [ORG_ID]);
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  await clearExportRowsBeforeStart();
  harness = await ApiHarness.start(ORG_ID, 'Vyuha Report Definitions', { preservePeople: true });
  started = true;
  runner = harness.resolve(JobRunner);
  await harness.ensurePermissionCatalogue();

  locationId = await harness.createLocation({ code: `RL-${RUN}`, name: `Plant ${RUN}` });
  departmentId = await harness.createDepartment({ code: `RD-${RUN}`, name: `Reporting ${RUN}` });

  // A March joiner, so headcount has one.
  managerEmployeeId = await harness.createEmployee({
    code: MANAGER_CODE,
    firstName: 'Meera',
    lastName: 'Nair',
    departmentId,
    locationId,
    dateOfJoining: '2026-03-05',
  });
  teamEmployeeId = await harness.createEmployee({
    code: TEAM_CODE,
    firstName: 'Asha',
    lastName: 'Menon',
    departmentId,
    locationId,
    reportingManagerId: managerEmployeeId,
    dateOfJoining: '2026-01-02',
  });
  // In the same department, so the department filter keeps both -- and outside
  // the manager's reporting chain, so the scope has to be what excludes them.
  // A March leaver, so headcount has one of those too.
  outsideEmployeeId = await harness.createEmployee({
    code: OUTSIDE_CODE,
    firstName: 'Vikram',
    lastName: 'Rao',
    departmentId,
    locationId,
    dateOfJoining: '2026-01-05',
    dateOfLeaving: '2026-03-20',
  });

  const hrRole = await harness.createSystemRole(SYSTEM_ROLES.HR);
  // A manager who may export, and whose keys are exactly the team-breadth ones
  // for each family a report reads: attendance, leave and people.
  const managerRole = await harness.createRole(`Report definitions manager ${RUN}`, [
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.ATTENDANCE_VIEW_TEAM,
    PERMISSIONS.LEAVE_APPROVE_TEAM,
    PERMISSIONS.EMPLOYEE_VIEW,
  ]);

  const hr = await harness.createUser({ email: scopedEmail('defs.hr'), roleIds: [hrRole] });
  const manager = await harness.createUser({
    email: scopedEmail('defs.manager'),
    roleIds: [managerRole],
    employeeId: managerEmployeeId,
  });

  hrToken = (await harness.login(hr.email, hr.password)).token;
  managerToken = (await harness.login(manager.email, manager.password)).token;

  await harness.db.insert(attendanceDays).values([
    // The team employee's March. Late, early, overtime, absent and a missing
    // punch, so every exception report has something of its own to find.
    {
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      date: '2026-03-02',
      status: 'PRESENT',
      workedMinutes: 492,
      otMinutes: 30,
      lateMinutes: 15,
      flags: ['late'],
    },
    {
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      date: '2026-03-03',
      status: 'PRESENT',
      workedMinutes: 400,
      otMinutes: 12,
      lateMinutes: 5,
      earlyExitMinutes: 45,
      flags: ['late', 'early_exit'],
    },
    {
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      date: '2026-03-04',
      status: 'ABSENT',
      workedMinutes: 0,
      flags: [],
    },
    {
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      date: '2026-03-05',
      status: 'PENDING',
      workedMinutes: 0,
      flags: ['missing_punch'],
    },
    { orgId: ORG_ID, employeeId: teamEmployeeId, date: '2026-03-07', status: 'WEEKLY_OFF', flags: [] },
    { orgId: ORG_ID, employeeId: teamEmployeeId, date: '2026-03-08', status: 'HOLIDAY', flags: [] },
    { orgId: ORG_ID, employeeId: teamEmployeeId, date: '2026-03-09', status: 'ON_LEAVE', flags: [] },
    // The last day of the month. Both people have one, so the daily muster --
    // which answers for the end of whatever period it is handed -- has rows to
    // return; an empty muster would let the export assertions below pass by
    // comparing nothing to nothing.
    { orgId: ORG_ID, employeeId: teamEmployeeId, date: '2026-03-31', status: 'WEEKLY_OFF', flags: [] },

    // The employee outside the reporting line, with larger numbers on every
    // measure -- so a scope that leaked would change the answer, not just the
    // row count.
    {
      orgId: ORG_ID,
      employeeId: outsideEmployeeId,
      date: '2026-03-02',
      status: 'PRESENT',
      workedMinutes: 480,
      otMinutes: 90,
      lateMinutes: 60,
      earlyExitMinutes: 90,
      flags: ['late', 'early_exit'],
    },
    {
      orgId: ORG_ID,
      employeeId: outsideEmployeeId,
      date: '2026-03-04',
      status: 'ABSENT',
      workedMinutes: 0,
      flags: [],
    },
    {
      orgId: ORG_ID,
      employeeId: outsideEmployeeId,
      date: '2026-03-05',
      status: 'PENDING',
      workedMinutes: 0,
      flags: ['missing_punch'],
    },
    { orgId: ORG_ID, employeeId: outsideEmployeeId, date: '2026-03-31', status: 'WEEKLY_OFF', flags: [] },
  ]);

  // REQ-J-01: the missing-punch report shows "their regularization status".
  await harness.db.insert(regularizations).values({
    orgId: ORG_ID,
    employeeId: teamEmployeeId,
    date: '2026-03-05',
    kind: 'MISSING_OUT',
    reason: 'Phone battery died on site',
    status: 'APPROVED',
    decidedAt: new Date('2026-03-06T05:00:00.000Z'),
    decidedBy: uuidv7(),
  });

  const insertedType = await harness.db
    .insert(leaveTypes)
    .values({
      orgId: ORG_ID,
      name: `Report casual ${RUN}`,
      code: `RC${RUN}`.slice(0, 12),
      isPaid: true,
    })
    .returning({ id: leaveTypes.id });
  leaveTypeId = insertedType[0]?.id ?? '';
  expect(leaveTypeId).toBeTruthy();

  // Leave year 2025, because 05-decisions starts the leave year in April and
  // March 2026 therefore belongs to the year that opened in April 2025. The
  // report derives that itself, which is part of what this fixture checks.
  await harness.db.insert(leaveBalances).values([
    {
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      leaveTypeId,
      leaveYear: 2025,
      opening: 2,
      accrued: 6,
      availed: 3,
      closing: 5,
    },
    {
      orgId: ORG_ID,
      employeeId: outsideEmployeeId,
      leaveTypeId,
      leaveYear: 2025,
      opening: 1,
      accrued: 1,
      closing: 2,
    },
  ]);

  await harness.db.insert(leaveLedger).values([
    {
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      leaveTypeId,
      leaveYear: 2025,
      movementType: 'AVAILED',
      days: -1.5,
      note: `March leave ${RUN}`,
      createdAt: new Date('2026-03-10T06:00:00.000Z'),
    },
    {
      orgId: ORG_ID,
      employeeId: outsideEmployeeId,
      leaveTypeId,
      leaveYear: 2025,
      movementType: 'ACCRUAL',
      days: 1,
      createdAt: new Date('2026-03-11T06:00:00.000Z'),
    },
    // Posted outside the period, so the ledger's date filter has something to
    // exclude rather than only something to include.
    {
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      leaveTypeId,
      leaveYear: 2025,
      movementType: 'ACCRUAL',
      days: 1,
      note: `February accrual ${RUN}`,
      createdAt: new Date('2026-02-10T06:00:00.000Z'),
    },
    // 20:00 UTC on the last day of February is 01:30 on 1 March in
    // Asia/Kolkata, which is the organisation's clock. A ledger bounded at UTC
    // midnight would drop it out of March; one bounded at local midnight keeps
    // it. The pair below is the whole point of the +05:30 handling.
    {
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      leaveTypeId,
      leaveYear: 2025,
      movementType: 'ADJUSTMENT',
      days: 1,
      note: `First minutes of March ${RUN}`,
      createdAt: new Date('2026-02-28T20:00:00.000Z'),
    },
    // ...and 19:00 UTC on the last day of March is already 1 April locally.
    {
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      leaveTypeId,
      leaveYear: 2025,
      movementType: 'ADJUSTMENT',
      days: -1,
      note: `Already April ${RUN}`,
      createdAt: new Date('2026-03-31T19:00:00.000Z'),
    },
  ]);

  const teamRequest = await harness.db
    .insert(leaveRequests)
    .values({
      orgId: ORG_ID,
      employeeId: teamEmployeeId,
      leaveTypeId,
      fromDate: '2026-03-09',
      toDate: '2026-03-10',
      totalDays: 1.5,
      status: 'APPROVED',
    })
    .returning({ id: leaveRequests.id });
  const outsideRequest = await harness.db
    .insert(leaveRequests)
    .values({
      orgId: ORG_ID,
      employeeId: outsideEmployeeId,
      leaveTypeId,
      fromDate: '2026-03-12',
      toDate: '2026-03-12',
      totalDays: 1,
      status: 'APPROVED',
    })
    .returning({ id: leaveRequests.id });

  const teamRequestId = teamRequest[0]?.id ?? '';
  const outsideRequestId = outsideRequest[0]?.id ?? '';

  await harness.db.insert(leaveRequestDays).values([
    { orgId: ORG_ID, leaveRequestId: teamRequestId, date: '2026-03-09', portion: 'FULL' },
    { orgId: ORG_ID, leaveRequestId: teamRequestId, date: '2026-03-10', portion: 'FIRST_HALF' },
    { orgId: ORG_ID, leaveRequestId: outsideRequestId, date: '2026-03-12', portion: 'FULL' },
  ]);

  runner.startWorkers();
}, 180_000);

afterAll(async () => {
  if (!started) return;

  if (createdExportIds.length > 0) {
    const produced = await harness.db
      .select({ fileId: exportJobs.fileId })
      .from(exportJobs)
      .where(inArray(exportJobs.id, createdExportIds));
    for (const row of produced) {
      if (row.fileId !== null) createdFileIds.push(row.fileId);
    }
    await harness.db.delete(exportJobs).where(inArray(exportJobs.id, createdExportIds));
  }
  // Attendance days and regularizations are deletable; `leave_ledger` is not
  // (REQ-G-03's trigger), which is why every employee here is unique to the run.
  await harness.db.delete(attendanceDays).where(eq(attendanceDays.orgId, ORG_ID));
  await harness.db.delete(regularizations).where(eq(regularizations.orgId, ORG_ID));
  if (createdFileIds.length > 0) {
    await harness.db.delete(files).where(inArray(files.id, createdFileIds));
  }
  await harness.close();
}, 60_000);

/** REQ-L-01: how a `YYYY-MM-DD` appears in a file this organisation produces. */
function asOrgDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

describe('the catalogue', () => {
  it('offers every report REQ-J-01 names, and not the one the client dropped', () => {
    const keys = Object.keys(REPORT_DEFINITIONS);
    expect(keys).toEqual(
      expect.arrayContaining([
        'daily-muster',
        'monthly-muster',
        'late-arrivals',
        'early-exits',
        'absenteeism',
        'missing-punch',
        'overtime',
        'leave-balance',
        'leave-ledger',
        'leave-availed',
        'punch-audit',
        'headcount',
      ]),
    );
    expect(keys).not.toContain('payroll-input');
  });

  it('offers a report only to a caller whose keys can return rows for it', async () => {
    // Both hold `report.view`; only one holds the leave and employee families.
    const forHr = await harness.get<{ data: { key: string }[] }>('/reports', { token: hrToken });
    const forManager = await harness.get<{ data: { key: string }[] }>('/reports', {
      token: managerToken,
    });

    expect(forHr.body.data.map((r) => r.key)).toContain('leave-ledger');
    expect(forManager.body.data.map((r) => r.key)).toContain('leave-ledger');

    // A reader with attendance but nothing else is not offered the leave
    // reports, which would answer "nothing in this period" for them forever.
    const attendanceOnly = await harness.createRole(`Attendance only ${RUN}`, [
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.ATTENDANCE_VIEW_ALL,
    ]);
    const reader = await harness.createUser({
      email: scopedEmail('defs.attendance-only'),
      roleIds: [attendanceOnly],
    });
    const session = await harness.login(reader.email, reader.password);
    const forReader = await harness.get<{ data: { key: string }[] }>('/reports', {
      token: session.token,
    });
    const keys = forReader.body.data.map((r) => r.key);
    expect(keys).toContain('monthly-muster');
    expect(keys).toContain('missing-punch');
    expect(keys).not.toContain('leave-balance');
    expect(keys).not.toContain('leave-availed');
    expect(keys).not.toContain('headcount');
  });

  it('answers 404 for the payroll input, rather than an empty report', async () => {
    const missing = await harness.get('/reports/payroll-input/rows', { token: hrToken });
    expect(missing.status).toBe(404);
  });
});

describe('the daily muster', () => {
  interface DayRow {
    employeeCode: string;
    date: string;
    status: string;
    workedMinutes: number;
  }

  it('answers for one date, whatever range it is handed', async () => {
    // The shell sends a single date; a hand-written URL may not. Either way the
    // muster is for a day, and it is the end of the period asked for.
    const page = await rows<DayRow>(hrToken, 'daily-muster');
    // Not `every` alone: it is trivially true of an empty page, which is
    // exactly what a muster answering for the wrong day would produce.
    expect(page.meta.total).toBe(2);
    expect(page.data.every((row) => row.date === MONTH_TO)).toBe(true);

    const second = await harness.get<Paginated<DayRow>>(
      `/reports/daily-muster/rows?from=2026-03-02&to=2026-03-02&departmentId=${departmentId}`,
      { token: hrToken },
    );
    expect(second.body.meta.total).toBe(2);
    expect(second.body.data.map((row) => row.employeeCode).sort()).toEqual(
      [OUTSIDE_CODE, TEAM_CODE].sort(),
    );
  });

  it('shows a manager their team and nobody else', async () => {
    const forManager = await harness.get<Paginated<DayRow>>(
      `/reports/daily-muster/rows?from=2026-03-02&to=2026-03-02&departmentId=${departmentId}`,
      { token: managerToken },
    );
    expect(forManager.body.meta.total).toBe(1);
    expect(forManager.body.data[0]?.employeeCode).toBe(TEAM_CODE);
  });
});

describe('the monthly muster grid', () => {
  interface GridRow {
    employeeCode: string;
    days: Record<string, string>;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    weeklyOffDays: number;
    holidayDays: number;
    workedMinutes: number;
    otMinutes: number;
    lateDays: number;
  }

  it('puts each day of the month in its own cell, with the totals beside it', async () => {
    const page = await rows<GridRow>(hrToken, 'monthly-muster');
    const row = page.data.find((entry) => entry.employeeCode === TEAM_CODE);

    expect(row?.days).toMatchObject({
      d02: 'P',
      d03: 'P',
      d04: 'A',
      d05: '?',
      d07: 'WO',
      d08: 'H',
      d09: 'L',
      d31: 'WO',
    });
    // Only the days that exist. An absent key is a day with no row, which the
    // grid renders empty rather than as a status nobody recorded.
    expect(row?.days.d01).toBeUndefined();

    expect(row?.presentDays).toBe(2);
    expect(row?.absentDays).toBe(1);
    expect(row?.leaveDays).toBe(1);
    expect(row?.weeklyOffDays).toBe(2);
    expect(row?.holidayDays).toBe(1);
    expect(row?.workedMinutes).toBe(892);
    expect(row?.otMinutes).toBe(42);
    expect(row?.lateDays).toBe(2);
  });

  it('refuses a period that spans more than one month', async () => {
    const refused = await harness.get(
      `/reports/monthly-muster/rows?from=2026-02-01&to=2026-03-31&departmentId=${departmentId}`,
      { token: hrToken },
    );
    expect(refused.status).toBe(400);
    expect((refused.body as { error: { message: string } }).error.message).toContain(
      'one calendar month',
    );
  });

  it('narrows to the manager team', async () => {
    const forManager = await rows<GridRow>(managerToken, 'monthly-muster');
    const forHr = await rows<GridRow>(hrToken, 'monthly-muster');
    expect(forManager.meta.total).toBeLessThan(forHr.meta.total);
    expect(forManager.data.map((row) => row.employeeCode)).toEqual([TEAM_CODE]);
  });
});

describe('the exception summaries', () => {
  interface ExceptionRow {
    employeeCode: string;
    departmentName: string | null;
    locationName: string | null;
    occurrences: number;
    totalMinutes: number;
    averageMinutes: number;
    worstMinutes: number;
    firstDate: string;
    lastDate: string;
  }

  it('counts late arrivals over the whole period, not over one page', async () => {
    // Deliberately a page of one. A report that summed what a page returned
    // would answer 15 here rather than 20, and 1 occurrence rather than 2.
    const page = await rows<ExceptionRow>(hrToken, 'late-arrivals', '&pageSize=1&sort=employeeCode');
    expect(page.meta.total).toBe(2);

    const team = (
      await rows<ExceptionRow>(hrToken, 'late-arrivals', `&employeeId=${teamEmployeeId}`)
    ).data[0];
    expect(team?.occurrences).toBe(2);
    expect(team?.totalMinutes).toBe(20);
    expect(team?.averageMinutes).toBe(10);
    expect(team?.worstMinutes).toBe(15);
    expect(team?.firstDate).toBe('2026-03-02');
    expect(team?.lastDate).toBe('2026-03-03');
    expect(team?.departmentName).toBe(`Reporting ${RUN}`);
    expect(team?.locationName).toBe(`Plant ${RUN}`);
  });

  it('mirrors it for early exits, and measures overtime the same way', async () => {
    const early = await rows<ExceptionRow>(hrToken, 'early-exits', `&employeeId=${teamEmployeeId}`);
    expect(early.data[0]?.occurrences).toBe(1);
    expect(early.data[0]?.totalMinutes).toBe(45);

    const overtime = await rows<ExceptionRow>(hrToken, 'overtime', `&employeeId=${teamEmployeeId}`);
    expect(overtime.data[0]?.occurrences).toBe(2);
    expect(overtime.data[0]?.totalMinutes).toBe(42);
    expect(overtime.data[0]?.worstMinutes).toBe(30);
  });

  it('orders by the measure when asked, biggest first', async () => {
    const page = await rows<ExceptionRow>(hrToken, 'late-arrivals', '&sort=-totalMinutes');
    expect(page.data.map((row) => row.employeeCode)).toEqual([OUTSIDE_CODE, TEAM_CODE]);
  });

  it('shows a manager only their team, on all three', async () => {
    for (const key of ['late-arrivals', 'early-exits', 'overtime'] as const) {
      const forManager = await rows<ExceptionRow>(managerToken, key);
      const forHr = await rows<ExceptionRow>(hrToken, key);
      expect(forManager.meta.total, key).toBeLessThan(forHr.meta.total);
      expect(forManager.data.map((row) => row.employeeCode), key).toEqual([TEAM_CODE]);
    }
  });
});

describe('absenteeism', () => {
  interface AbsenceRow {
    employeeCode: string;
    month: string;
    scheduledDays: number;
    presentDays: number;
    leaveDays: number;
    absentDays: number;
    absencePercent: number;
  }

  it('divides absent days by the days the person was expected', async () => {
    const page = await rows<AbsenceRow>(hrToken, 'absenteeism', `&employeeId=${teamEmployeeId}`);
    const row = page.data[0];

    expect(row?.month).toBe('2026-03');
    // Seven rows, less the weekly off and the holiday.
    expect(row?.scheduledDays).toBe(5);
    expect(row?.presentDays).toBe(2);
    expect(row?.leaveDays).toBe(1);
    expect(row?.absentDays).toBe(1);
    expect(row?.absencePercent).toBe(20);
  });

  it('leaves out the people who were never absent', async () => {
    await harness.db.insert(attendanceDays).values({
      orgId: ORG_ID,
      employeeId: managerEmployeeId,
      date: '2026-03-11',
      status: 'PRESENT',
      workedMinutes: 480,
      flags: [],
    });

    const page = await rows<AbsenceRow>(hrToken, 'absenteeism');
    expect(page.data.map((row) => row.employeeCode)).not.toContain(MANAGER_CODE);
    expect(page.data.map((row) => row.employeeCode).sort()).toEqual(
      [OUTSIDE_CODE, TEAM_CODE].sort(),
    );
  });

  it('narrows to the manager team', async () => {
    const forManager = await rows<AbsenceRow>(managerToken, 'absenteeism');
    const forHr = await rows<AbsenceRow>(hrToken, 'absenteeism');
    expect(forManager.meta.total).toBeLessThan(forHr.meta.total);
    expect(forManager.data.map((row) => row.employeeCode)).toEqual([TEAM_CODE]);
  });
});

describe('missing punch', () => {
  interface MissingRow {
    employeeCode: string;
    date: string;
    status: string;
    flags: string[];
    regularizationStatus: string | null;
    regularizationKind: string | null;
    regularizationReason: string | null;
  }

  it('lists the flagged days and where their correction stands', async () => {
    const page = await rows<MissingRow>(hrToken, 'missing-punch', '&sort=employeeCode');
    expect(page.meta.total).toBe(2);

    const team = page.data.find((row) => row.employeeCode === TEAM_CODE);
    expect(team?.date).toBe('2026-03-05');
    expect(team?.flags).toContain('missing_punch');
    expect(team?.regularizationStatus).toBe('APPROVED');
    expect(team?.regularizationKind).toBe('MISSING_OUT');
    expect(team?.regularizationReason).toBe('Phone battery died on site');

    // Nobody raised one for the other employee, and null is the honest answer:
    // "NONE" would read as a decision somebody made.
    const outside = page.data.find((row) => row.employeeCode === OUTSIDE_CODE);
    expect(outside?.regularizationStatus).toBeNull();
  });

  it('shows only the flagged days, not the rest of the month', async () => {
    const page = await rows<MissingRow>(hrToken, 'missing-punch');
    expect(page.data.every((row) => row.flags.includes('missing_punch'))).toBe(true);
  });

  it('narrows to the manager team', async () => {
    const forManager = await rows<MissingRow>(managerToken, 'missing-punch');
    expect(forManager.meta.total).toBe(1);
    expect(forManager.data[0]?.employeeCode).toBe(TEAM_CODE);
  });
});

describe('the leave reports', () => {
  interface BalanceRow {
    employeeCode: string;
    leaveTypeName: string;
    leaveYear: number;
    opening: number;
    accrued: number;
    availed: number;
    closing: number;
  }
  interface LedgerRow {
    employeeCode: string;
    movementType: string;
    days: number;
    note: string | null;
    postedAt: string;
  }
  interface AvailedRow {
    employeeCode: string;
    leaveTypeCode: string;
    isPaid: boolean;
    requests: number;
    days: number;
    firstDate: string;
    lastDate: string;
  }

  it('reads balances for the leave year the period falls in', async () => {
    const page = await rows<BalanceRow>(hrToken, 'leave-balance', `&employeeId=${teamEmployeeId}`);
    const row = page.data.find((entry) => entry.leaveTypeName === `Report casual ${RUN}`);

    // March 2026 is inside the leave year that opened in April 2025.
    expect(row?.leaveYear).toBe(2025);
    expect(row?.opening).toBe(2);
    expect(row?.accrued).toBe(6);
    expect(row?.availed).toBe(3);
    expect(row?.closing).toBe(5);
  });

  it('shows the ledger movements posted inside the period and no others', async () => {
    const page = await rows<LedgerRow>(hrToken, 'leave-ledger');
    const notes = page.data.map((row) => row.note);

    expect(notes).toContain(`March leave ${RUN}`);
    // Posted in February; the period is March.
    expect(notes).not.toContain(`February accrual ${RUN}`);

    const availed = page.data.find((row) => row.movementType === 'AVAILED');
    // Signed as stored: an AVAILED movement is negative.
    expect(availed?.days).toBe(-1.5);
    expect(availed?.postedAt).toBe('2026-03-10T06:00:00.000Z');
  });

  it('bounds the period at local midnight, not at UTC', async () => {
    const page = await rows<LedgerRow>(hrToken, 'leave-ledger', '&pageSize=100');
    const notes = page.data.map((row) => row.note);

    // 2026-02-28T20:00Z is 01:30 on 1 March in Asia/Kolkata. A UTC-bounded
    // query drops it; this one must keep it.
    expect(notes).toContain(`First minutes of March ${RUN}`);
    // 2026-03-31T19:00Z is 00:30 on 1 April locally, and is out.
    expect(notes).not.toContain(`Already April ${RUN}`);
  });

  it('counts availed leave by the days inside the period, half days as halves', async () => {
    const page = await rows<AvailedRow>(hrToken, 'leave-availed', `&employeeId=${teamEmployeeId}`);
    const row = page.data[0];

    expect(row?.requests).toBe(1);
    // One full day and one first half.
    expect(row?.days).toBe(1.5);
    expect(row?.isPaid).toBe(true);
    expect(row?.firstDate).toBe('2026-03-09');
    expect(row?.lastDate).toBe('2026-03-10');
  });

  it('counts only the days inside the period when a request straddles its edge', async () => {
    const page = await rows<AvailedRow>(
      hrToken,
      'leave-availed',
      `&employeeId=${teamEmployeeId}&pageSize=50`,
    );
    expect(page.data[0]?.days).toBe(1.5);

    // The same request, asked about a period holding only its first day.
    const clipped = await harness.get<Paginated<AvailedRow>>(
      `/reports/leave-availed/rows?from=2026-03-09&to=2026-03-09&departmentId=${departmentId}&employeeId=${teamEmployeeId}`,
      { token: hrToken },
    );
    expect(clipped.body.data[0]?.days).toBe(1);
  });

  it('narrows all three to the manager team', async () => {
    for (const key of ['leave-balance', 'leave-ledger', 'leave-availed'] as const) {
      const forManager = await rows<{ employeeCode: string }>(managerToken, key);
      const forHr = await rows<{ employeeCode: string }>(hrToken, key);
      expect(forManager.meta.total, key).toBeLessThan(forHr.meta.total);
      expect(
        forManager.data.every((row) => row.employeeCode === TEAM_CODE),
        key,
      ).toBe(true);
    }
  });
});

describe('headcount', () => {
  interface HeadcountRow {
    month: string;
    opening: number;
    joiners: number;
    leavers: number;
    closing: number;
  }

  it('reports a row per month, with the arithmetic closing where it opened', async () => {
    const page = await harness.get<Paginated<HeadcountRow>>(
      `/reports/headcount/rows?from=2026-01-01&to=2026-04-30&departmentId=${departmentId}`,
      { token: hrToken },
    );

    expect(page.status).toBe(200);
    // Four months, including the ones in which nothing happened: a gap in a
    // headcount series reads as a month with no staff.
    expect(page.body.data.map((row) => row.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);

    const march = page.body.data.find((row) => row.month === '2026-03');
    expect(march?.opening).toBe(2);
    expect(march?.joiners).toBe(1);
    expect(march?.leavers).toBe(1);
    expect(march?.closing).toBe(2);

    for (const row of page.body.data) {
      expect(row.opening + row.joiners - row.leavers, row.month).toBe(row.closing);
    }
    // February's close is March's open, which is what makes the series a series.
    expect(page.body.data.find((row) => row.month === '2026-02')?.closing).toBe(march?.opening);
  });

  it('counts only the people a manager may see', async () => {
    const forManager = await harness.get<Paginated<HeadcountRow>>(
      `/reports/headcount/rows?from=${MONTH_FROM}&to=${MONTH_TO}&departmentId=${departmentId}`,
      { token: managerToken },
    );
    const forHr = await harness.get<Paginated<HeadcountRow>>(
      `/reports/headcount/rows?from=${MONTH_FROM}&to=${MONTH_TO}&departmentId=${departmentId}`,
      { token: hrToken },
    );

    // The month is a month either way; the counts inside it are not.
    expect(forManager.body.data[0]?.leavers).toBe(0);
    expect(forHr.body.data[0]?.leavers).toBe(1);
    expect(forManager.body.data[0]?.opening).toBeLessThan(forHr.body.data[0]?.opening ?? 0);
  });

  it('refuses a request with no period, having nothing to enumerate', async () => {
    const refused = await harness.get('/reports/headcount/rows', { token: hrToken });
    expect(refused.status).toBe(400);
  });
});

describe('exporting a derived report', () => {
  /** Queues an export, waits for it, and hands back the produced text. */
  async function exportReport(
    token: string,
    reportKey: ReportKey,
    body: Record<string, unknown> = {},
  ): Promise<{ job: ExportJobSummary; csv: string }> {
    const accepted = await harness.post<ExportJobSummary>('/reports/exports', {
      token,
      body: {
        reportKey,
        filters: { from: MONTH_FROM, to: MONTH_TO, departmentId },
        ...body,
      },
    });
    expect(accepted.status, `${reportKey} export was refused`).toBe(202);
    createdExportIds.push(accepted.body.id);

    const job = await waitForExport(token, accepted.body.id);
    expect(job.status, `${reportKey}: ${job.error ?? ''}`).toBe('DONE');
    return { job, csv: await downloadText(token, accepted.body.id) };
  }

  it('writes the same rows the screen shows, for every report', async () => {
    // The claim the whole design rests on: the file and the screen read the
    // same cells out of the same rows. Asserted for all of them because each
    // row shape is a separate arm of `cellsFor`, and an arm that returned
    // nothing would produce a file of empty columns that still says DONE.
    const keys: ReportKey[] = [
      'daily-muster',
      'monthly-muster',
      'late-arrivals',
      'early-exits',
      'absenteeism',
      'missing-punch',
      'overtime',
      'leave-balance',
      'leave-ledger',
      'leave-availed',
    ];

    for (const key of keys) {
      const onScreen = await rows<unknown>(hrToken, key);
      // Before comparing them: two zeroes are equal, and a report that returned
      // nothing would pass this check while proving nothing at all.
      expect(onScreen.meta.total, `${key} has no rows to compare`).toBeGreaterThan(0);

      const { job } = await exportReport(hrToken, key);
      expect(job.rowCount, `${key} exported a different number of rows than it shows`).toBe(
        onScreen.meta.total,
      );
    }
  }, 180_000);

  it('states the single date rather than a range for the daily muster', async () => {
    const { csv } = await exportReport(hrToken, 'daily-muster');
    expect(csv).toContain('Daily muster');
    // REQ-L-01: the caption is written the organisation's way, not ISO --
    // the same way the Generated line below it is.
    expect(csv).toContain(`Date,${asOrgDate(MONTH_TO)}`);
    expect(csv).not.toContain(`Period,${asOrgDate(MONTH_FROM)} to ${asOrgDate(MONTH_TO)}`);
  }, 120_000);

  it('writes the exception summary as the screen renders it, durations and all', async () => {
    const { csv } = await exportReport(hrToken, 'late-arrivals', {
      columns: ['employeeCode', 'employeeName', 'occurrences', 'totalMinutes', 'worstMinutes'],
      sort: 'employeeCode',
    });

    const lines = csv.split('\r\n');
    const headerIndex = lines.findIndex((line) => line.startsWith('Code,'));
    expect(lines[headerIndex]).toBe('Code,Employee,Late days,Total late,Worst late');

    const body = lines.slice(headerIndex + 1).filter((line) => line.length > 0);
    expect(body).toHaveLength(2);
    // Minutes as HH:mm in the sheet, which is `formatDurationMinutes`; the same
    //20 that the API returned as a number.
    expect(body).toContain(`${TEAM_CODE},Asha Menon,2,00:20,00:15`);
    expect(body).toContain(`${OUTSIDE_CODE},Vikram Rao,1,01:00,01:00`);
  }, 120_000);

  it('writes the grid one column per day, with the status codes the screen shows', async () => {
    const { csv } = await exportReport(hrToken, 'monthly-muster', {
      columns: ['employeeCode', 'd02', 'd04', 'd05', 'd07', 'd08', 'presentDays', 'absentDays'],
      sort: 'employeeCode',
    });

    const lines = csv.split('\r\n');
    const headerIndex = lines.findIndex((line) => line.startsWith('Code,'));
    expect(lines[headerIndex]).toBe('Code,2,4,5,7,8,Present,Absent');

    const body = lines.slice(headerIndex + 1).filter((line) => line.length > 0);
    expect(body).toContain(`${TEAM_CODE},P,A,?,WO,H,2,1`);
  }, 120_000);

  it("holds only the manager's team when the manager asks for it", async () => {
    const { job, csv } = await exportReport(managerToken, 'late-arrivals');
    expect(job.rowCount).toBe(1);
    expect(csv).toContain(TEAM_CODE);
    expect(csv).not.toContain(OUTSIDE_CODE);
  }, 120_000);

  it('refuses a period the report cannot answer for, before queueing anything', async () => {
    const refused = await harness.post('/reports/exports', {
      token: hrToken,
      body: {
        reportKey: 'monthly-muster',
        filters: { from: '2026-02-01', to: '2026-03-31', departmentId },
      },
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { error: { message: string } }).error.message).toContain(
      'one calendar month',
    );

    const queued = await harness.db
      .select({ id: exportJobs.id })
      .from(exportJobs)
      .where(sql`${exportJobs.orgId} = ${ORG_ID} AND ${exportJobs.reportKey} = 'monthly-muster'
                 AND ${exportJobs.filters}->'filters'->>'from' = '2026-02-01'`);
    expect(queued).toHaveLength(0);
  });
});
