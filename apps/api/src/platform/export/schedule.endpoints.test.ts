import {
  SYSTEM_ROLES,
  describeSchedule,
  type ExportJobSummary,
  type Paginated,
  type ReportSchedule,
} from '@vyuha/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { exportJobs, files, reportSchedules } from '../db/schema/index.js';
import type { JobContext } from '../jobs/job-handler.js';
import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import { ScheduleSweepHandler } from './schedule-sweep.handler.js';

/**
 * REQ-J-05 over real HTTP and through the real sweep.
 *
 * The requirement says a saved report configuration is emailed daily, weekly or
 * monthly. There is no mail transport in this product, so a run lands in the
 * Downloads tray -- the same job, the same file, the same retention. What has
 * to be proven is therefore not that a message was sent but that the timer
 * produces a real export, exactly once, covering the right days.
 *
 * "Exactly once" is the assertion that matters most. The sweep runs every
 * fifteen minutes, so a missing idempotency check does not fail: it produces
 * ninety-six identical files a day, each of them valid, and the only symptom is
 * a tray nobody can use.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000c7';
const IST = 'Asia/Kolkata';

/** A job context, since the handler takes one and reads nothing from it. */
const CONTEXT: JobContext = { attempt: 1, jobId: 'schedule-sweep-test' };

let harness: ApiHarness;
let sweep: ScheduleSweepHandler;
let hrToken = '';
let employeeToken = '';
let runId = '';
let started = false;

interface ErrorBody {
  readonly error: { readonly message: string };
}

/** The instant at which it is `hh:mm` on `date` in the organisation's zone. */
function instantAt(date: string, hour: number, minute: number): string {
  // IST is +05:30 and has no daylight saving, so the offset is exact and this
  // needs no timezone library. A zone that observed DST would need one, which
  // is why the *server* asks Postgres rather than computing this.
  const utc = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`);
  return utc.toISOString();
}

/**
 * Leaves exactly one schedule live in the organisation.
 *
 * `runDue` reports how many schedules it started across the whole org, so a
 * count assertion only means something when one schedule can answer it. The
 * describes above leave their own creations behind on purpose -- they are
 * testing creation, not cleanup -- and without this the sweep tests measure
 * them too. Written straight to the table because it is fixture setup, not the
 * behaviour under test.
 */
async function leaveOnlyLive(id: string): Promise<void> {
  await harness.db.execute(
    sql`UPDATE report_schedules SET is_active = (id = ${id}::uuid) WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`,
  );
}

async function schedules(token: string): Promise<ReportSchedule[]> {
  const response = await harness.get<ReportSchedule[]>('/reports/schedules', { token });
  expect(response.status, response.text).toBe(200);
  return response.body;
}

async function trayCount(token: string): Promise<number> {
  const response = await harness.get<Paginated<ExportJobSummary> | ExportJobSummary[]>(
    '/reports/exports?limit=100',
    { token },
  );
  expect(response.status).toBe(200);
  const rows = Array.isArray(response.body) ? response.body : response.body.data;
  return rows.length;
}

async function latestExport(token: string): Promise<ExportJobSummary | undefined> {
  const response = await harness.get<Paginated<ExportJobSummary> | ExportJobSummary[]>(
    '/reports/exports?limit=100',
    { token },
  );
  const rows = Array.isArray(response.body) ? response.body : response.body.data;
  return rows[0];
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Report Schedule Fixture Org', { preservePeople: true });
  runId = Math.random().toString(36).slice(-5).toUpperCase();

  // NFR-05: the sweep asks each organisation what time it is *there*. Without a
  // known zone this suite would pass or fail depending on the machine.
  await harness.db.execute(sql`UPDATE organizations SET timezone = ${IST} WHERE id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM report_schedules WHERE org_id = ${ORG_ID}`);

  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR);
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);

  const hrUser = await harness.createUser({ email: scopedEmail('sched-hr'), roleIds: [hrRoleId] });
  const employee = await harness.createUser({
    email: scopedEmail('sched-emp'),
    roleIds: [employeeRoleId],
  });

  hrToken = (await harness.login(hrUser.email, hrUser.password)).token;
  employeeToken = (await harness.login(employee.email, employee.password)).token;
  expect(hrToken).not.toBe('');

  sweep = harness.resolve(ScheduleSweepHandler);
  started = true;
}, 60_000);

/**
 * The exports this suite produces have to go before the harness resets.
 *
 * `export_jobs.requested_by` is RESTRICT -- a produced file is a record that
 * must survive its requester leaving -- and `resetOrganisation` deletes users.
 * Leaving them behind does not fail this run; it fails the *next* one, in
 * `beforeAll`, with a foreign key error that says nothing about schedules.
 */
afterAll(async () => {
  if (!started) return;

  const produced = await harness.db
    .select({ id: exportJobs.id, fileId: exportJobs.fileId })
    .from(exportJobs)
    .where(eq(exportJobs.orgId, ORG_ID));

  await harness.db.delete(reportSchedules).where(eq(reportSchedules.orgId, ORG_ID));
  if (produced.length > 0) {
    await harness.db.delete(exportJobs).where(eq(exportJobs.orgId, ORG_ID));
    const fileIds = produced.map((row) => row.fileId).filter((id): id is string => id !== null);
    if (fileIds.length > 0) await harness.db.delete(files).where(inArray(files.id, fileIds));
  }

  await harness.close();
}, 60_000);

describe('creating a schedule (REQ-J-05)', () => {
  it('creates a daily schedule and describes it in the words the form used', async () => {
    const created = await harness.post<ReportSchedule & ErrorBody>('/reports/schedules', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        name: `Daily register ${runId}`,
        cadence: 'DAILY',
        hour: 6,
        minute: 30,
      },
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body.isActive).toBe(true);
    // The default is Excel, because REQ-J-03 is an Excel requirement and a
    // schedule that quietly produced CSV would surprise whoever set it.
    expect(created.body.format).toBe('XLSX');
    expect(created.body.lastRunOn).toBeNull();
    expect(describeSchedule(created.body)).toBe('Every day at 06:30');
  });

  it('refuses a weekly schedule with no weekday, rather than one that never fires', async () => {
    const refused = await harness.post<ErrorBody>('/reports/schedules', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        name: 'Broken weekly',
        cadence: 'WEEKLY',
        hour: 6,
      },
    });
    expect(refused.status).toBe(400);
  });

  it('refuses the 31st, because five months a year would silently skip it', async () => {
    const refused = await harness.post<ErrorBody>('/reports/schedules', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        name: 'Broken monthly',
        cadence: 'MONTHLY',
        hour: 6,
        dayOfMonth: 31,
      },
    });
    expect(refused.status).toBe(400);
  });

  it('refuses a caller who may read reports but not export them', async () => {
    // A schedule produces a file on a timer, which is the export risk. An
    // employee holds neither key, so this is the guard answering.
    const refused = await harness.post<ErrorBody>('/reports/schedules', {
      token: employeeToken,
      body: {
        reportKey: 'attendance-register',
        name: 'Not allowed',
        cadence: 'DAILY',
        hour: 6,
      },
    });
    expect(refused.status).toBe(403);
  });

  it('does not accept a stored period, which would export the same days for ever', async () => {
    const created = await harness.post<ReportSchedule & ErrorBody>('/reports/schedules', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        name: `Ignores dates ${runId}`,
        cadence: 'DAILY',
        hour: 6,
        filters: { from: '2026-01-01', to: '2026-01-31' },
      },
    });
    expect(created.status, created.text).toBe(201);
    // Stripped by the schema rather than stored and ignored later: a schedule
    // whose filters say January would be read by a human as exporting January.
    expect(created.body.filters.from).toBeUndefined();
    expect(created.body.filters.to).toBeUndefined();
  });
});

describe('the sweep that runs them', () => {
  let scheduleId = '';

  beforeAll(async () => {
    const created = await harness.post<ReportSchedule>('/reports/schedules', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        name: `Swept daily ${runId}`,
        cadence: 'DAILY',
        hour: 6,
        minute: 0,
      },
    });
    expect(created.status).toBe(201);
    scheduleId = created.body.id;
    await leaveOnlyLive(scheduleId);
  });

  it('does not run before the appointed minute', async () => {
    const before = await trayCount(hrToken);
    const outcome = await sweep.run({ now: instantAt('2026-08-15', 5, 45) }, CONTEXT);
    expect(outcome.started).toBe(0);
    expect(await trayCount(hrToken)).toBe(before);
  });

  it('runs at the appointed minute and puts a real export in the tray', async () => {
    const before = await trayCount(hrToken);
    const outcome = await sweep.run({ now: instantAt('2026-08-15', 6, 5) }, CONTEXT);
    expect(Number(outcome.started)).toBeGreaterThanOrEqual(1);
    expect(await trayCount(hrToken)).toBe(before + 1);

    const job = await latestExport(hrToken);
    expect(job?.reportKey).toBe('attendance-register');
    // REQ-J-03's Excel default, arriving through the schedule.
    expect(job?.filename.endsWith('.xlsx')).toBe(true);
    // The window is yesterday, derived at run time. A schedule running on the
    // 15th covers the 14th -- not the 15th, which is a few hours old.
    expect(job?.filters.from).toBe('2026-08-14');
    expect(job?.filters.to).toBe('2026-08-14');
  }, 60_000);

  /**
   * The assertion this feature lives or dies on.
   *
   * The sweep runs every fifteen minutes. Without `last_run_on` the schedule
   * above would fire again at 06:15, 06:30 and every sweep until midnight --
   * seventy-one more files, each a valid export, and no error anywhere.
   */
  it('does not run a second time on the same day', async () => {
    const before = await trayCount(hrToken);
    for (const minute of [15, 30, 45]) {
      const outcome = await sweep.run({ now: instantAt('2026-08-15', 6, minute) }, CONTEXT);
      expect(outcome.started).toBe(0);
    }
    expect(await trayCount(hrToken)).toBe(before);
  });

  it('runs again the next day', async () => {
    const before = await trayCount(hrToken);
    const outcome = await sweep.run({ now: instantAt('2026-08-16', 6, 5) }, CONTEXT);
    expect(Number(outcome.started)).toBeGreaterThanOrEqual(1);
    expect(await trayCount(hrToken)).toBe(before + 1);

    const job = await latestExport(hrToken);
    expect(job?.filters.from).toBe('2026-08-15');
  }, 60_000);

  it('records the run against the schedule, so the list can say when it last ran', async () => {
    const row = (await schedules(hrToken)).find((s) => s.id === scheduleId);
    expect(row?.lastRunOn).toBe('2026-08-16');
    expect(row?.lastExportJobId).not.toBeNull();
    // Read through the join rather than stored twice: the tray already knows
    // whether the file was produced.
    expect(['QUEUED', 'RUNNING', 'DONE']).toContain(row?.lastRunStatus);
  });

  it('never runs while paused', async () => {
    const paused = await harness.post<ReportSchedule>(`/reports/schedules/${scheduleId}/active`, {
      token: hrToken,
      body: { isActive: false },
    });
    expect(paused.status, paused.text).toBe(201);
    expect(paused.body.isActive).toBe(false);

    const before = await trayCount(hrToken);
    const outcome = await sweep.run({ now: instantAt('2026-08-17', 9, 0) }, CONTEXT);
    expect(outcome.started).toBe(0);
    expect(await trayCount(hrToken)).toBe(before);
  });

  it('runs again once resumed', async () => {
    const resumed = await harness.post<ReportSchedule>(`/reports/schedules/${scheduleId}/active`, {
      token: hrToken,
      body: { isActive: true },
    });
    expect(resumed.status).toBe(201);

    const before = await trayCount(hrToken);
    const outcome = await sweep.run({ now: instantAt('2026-08-18', 9, 0) }, CONTEXT);
    expect(Number(outcome.started)).toBeGreaterThanOrEqual(1);
    expect(await trayCount(hrToken)).toBe(before + 1);
  }, 60_000);

  it('is gone from the list once deleted, and stops running', async () => {
    const removed = await harness.del(`/reports/schedules/${scheduleId}`, { token: hrToken });
    expect(removed.status).toBe(204);
    expect((await schedules(hrToken)).some((s) => s.id === scheduleId)).toBe(false);

    const before = await trayCount(hrToken);
    const outcome = await sweep.run({ now: instantAt('2026-08-19', 9, 0) }, CONTEXT);
    // It was the only live schedule, so nothing at all may run.
    expect(outcome.started).toBe(0);
    expect(await trayCount(hrToken)).toBe(before);
  }, 60_000);
});

describe('a weekly schedule', () => {
  it('fires on its weekday and on no other', async () => {
    const created = await harness.post<ReportSchedule>('/reports/schedules', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        name: `Weekly ${runId}`,
        cadence: 'WEEKLY',
        // Monday, so the seven days it covers are the week that has just ended.
        weekday: 1,
        hour: 7,
      },
    });
    expect(created.status, created.text).toBe(201);
    await leaveOnlyLive(created.body.id);

    // 2026-08-19 is a Wednesday.
    const wednesday = await sweep.run({ now: instantAt('2026-08-19', 8, 0) }, CONTEXT);
    expect(wednesday.started).toBe(0);

    // 2026-08-24 is a Monday.
    const before = await trayCount(hrToken);
    const monday = await sweep.run({ now: instantAt('2026-08-24', 8, 0) }, CONTEXT);
    expect(Number(monday.started)).toBeGreaterThanOrEqual(1);
    expect(await trayCount(hrToken)).toBe(before + 1);

    const job = await latestExport(hrToken);
    // The seven complete days ending yesterday: Sunday the 23rd back to Monday
    // the 17th.
    expect(job?.filters.from).toBe('2026-08-17');
    expect(job?.filters.to).toBe('2026-08-23');
  }, 90_000);
});

/**
 * One tenant must not be able to consume every other tenant's sweep.
 *
 * The sweep has a global budget, and it used to be the *only* budget: rows were
 * ordered by `org_id` and due-ness was decided in JavaScript afterwards, so a
 * tenant with enough never-due schedules filled the limit and the tenants after
 * it were never considered at all. Since organisation ids are uuidv7 that meant
 * the first-onboarded tenant starved every later one, permanently, with no
 * error and no tray row -- reports simply stopped arriving.
 */
describe('the sweep budget', () => {
  it('caps how much of it one organisation can take', async () => {
    // Comfortably above the per-org cap, and all set to an hour that has not
    // arrived, so every one of them is undue.
    const rows = Array.from({ length: 40 }, (_, index) => index);
    for (const index of rows) {
      const created = await harness.post<ReportSchedule>('/reports/schedules', {
        token: hrToken,
        body: {
          reportKey: 'attendance-register',
          name: `Budget probe ${String(index)} ${runId}`,
          cadence: 'DAILY',
          hour: 23,
          minute: 59,
        },
      });
      expect(created.status).toBe(201);
    }

    // Early morning, so none of the 40 is due. Before the fix every one of them
    // would still have been fetched and counted against the global budget.
    const outcome = await sweep.run({ now: instantAt('2026-09-01', 1, 0) }, CONTEXT);
    expect(outcome.started).toBe(0);
    // The point: an undue schedule now costs nothing at all, so a tenant full
    // of them leaves the budget intact for everybody else.
    expect(outcome.considered).toBe(0);
  }, 120_000);
});

describe('who may see a schedule', () => {
  it('does not show one reader another reader\'s schedule', async () => {
    const otherRoleId = await harness.createRole(`Exporter ${runId}`, [
      'report.view',
      'report.export',
    ]);
    const other = await harness.createUser({
      email: scopedEmail('sched-other'),
      roleIds: [otherRoleId],
    });
    const otherToken = (await harness.login(other.email, other.password)).token;

    const mine = await schedules(hrToken);
    expect(mine.length).toBeGreaterThan(0);

    // A schedule delivers to one tray, and that tray is its owner's. Showing
    // it to somebody who cannot collect the file would be a control that does
    // nothing.
    const theirs = await schedules(otherToken);
    expect(theirs).toEqual([]);
  });
});
