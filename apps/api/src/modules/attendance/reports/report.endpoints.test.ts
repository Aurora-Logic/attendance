import ExcelJS from 'exceljs';

import {
  MAX_EXPORT_RANGE_DAYS,
  PERMISSIONS,
  REPORT_KEYS,
  SYSTEM_ROLES,
  uuidv7,
  type AttendanceDaySummary,
  type ExportDownload,
  type ExportJobSummary,
  type Paginated,
  type PunchRecord,
  type ReportDefinition,
  type SavedView,
} from '@vyuha/shared';
import type { Job } from 'bullmq';
import { eq, inArray, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';
import { env } from '../../../platform/common/env.js';
import { exportJobs, files } from '../../../platform/db/schema/index.js';
import { FileService } from '../../../platform/files/file.service.js';
import { JobRunner } from '../../../platform/jobs/job-runner.service.js';
import { QUEUES } from '../../../platform/jobs/queue.registry.js';
import { attendanceDays, punches } from '../schema/index.js';

/**
 * The report shell and the export tray (REQ-J-01 … REQ-J-06) over real HTTP,
 * against the real application, with real Redis, MinIO and Postgres.
 *
 * The export assertions read the produced file. "The job completed" is not the
 * requirement -- REQ-J-03 is about what is in the file: the organisation's
 * name, the filters that were applied, a generated-at stamp, and the rows the
 * requester was permitted to see and no others.
 *
 * `preservePeople`, and per-run employee codes, for the reason the punch suite
 * gives: `punches` is append-only by trigger and RESTRICTs its employee, so an
 * employee who has ever punched can never be deleted. Every run mints its own
 * people and its own department, and every assertion filters by them.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e7';
const RUN = uuidv7().slice(-8);

let harness: ApiHarness;
let runner: JobRunner;
let started = false;

let hrToken = '';
let managerToken = '';
let viewerToken = '';
let hrUserId = '';

let departmentId = '';
let managerEmployeeId = '';
let reportEmployeeId = '';
let outsideEmployeeId = '';

/** Fixed dates: the people are unique per run, so the dates need not be. */
const DAY_ONE = '2026-03-02';
const DAY_TWO = '2026-03-03';
const OUTSIDE_DAY = '2026-03-04';

const createdFileIds: string[] = [];
const createdExportIds: string[] = [];

async function settle(job: Job, timeoutMs = 60_000): Promise<'completed' | 'failed'> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await job.getState();
    if (state === 'completed') return 'completed';
    if (state === 'failed') return 'failed';
    if (Date.now() >= deadline) throw new Error(`Job ${job.id ?? '?'} stuck in state "${state}".`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Waits for the tray to report a terminal state, which is what a reader sees. */
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

/** The same download, as bytes, for a format that is not text. */
async function downloadBytes(token: string, id: string): Promise<Buffer> {
  const link = await harness.get<ExportDownload>(`/reports/exports/${id}/download`, { token });
  expect(link.status).toBe(200);
  const response = await fetch(link.body.url);
  expect(response.status).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

async function downloadText(token: string, id: string): Promise<string> {
  const link = await harness.get<ExportDownload>(`/reports/exports/${id}/download`, { token });
  expect(link.status).toBe(200);
  const response = await fetch(link.body.url);
  expect(response.status).toBe(200);
  return response.text();
}

/**
 * Clears this organisation's export rows before the harness resets it.
 *
 * `export_jobs.requested_by` is `ON DELETE RESTRICT`, so a row left behind by a
 * run that crashed halfway pins the user it names -- and `resetOrganisation`
 * deletes users, which then fails for every subsequent run of this file. The
 * constraint is right (REQ-M-04 soft-deletes people in production, so nothing
 * legitimate ever hits it); it is the leftovers that have to go, and they have
 * to go before the harness exists, which is why this opens its own connection.
 */
async function clearExportRowsBeforeStart(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    await pool.query('DELETE FROM export_jobs WHERE org_id = $1', [ORG_ID]);
  } finally {
    await pool.end();
  }
}

/** A punch needs two real objects in storage before it can have a row. */
async function storePunchPhotos(uploadedBy: string): Promise<{ full: string; thumb: string }> {
  const fileService = harness.resolve(FileService);
  const bytes = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 40, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer();

  const full = await fileService.storeImage({
    orgId: ORG_ID,
    uploadedBy,
    purpose: 'PUNCH_PHOTO',
    bytes,
  });
  const thumb = await fileService.storeImage({
    orgId: ORG_ID,
    uploadedBy,
    purpose: 'PUNCH_PHOTO_THUMB',
    bytes,
  });
  // Deliberately not registered for cleanup: `punches.photo_file_id` is
  // RESTRICT and `punches` cannot be deleted at all (REQ-D-12's trigger), so
  // these two rows are as permanent as the punch that points at them.
  return { full: full.id, thumb: thumb.id };
}

beforeAll(async () => {
  await clearExportRowsBeforeStart();
  harness = await ApiHarness.start(ORG_ID, 'Vyuha Reports Test', { preservePeople: true });
  started = true;
  runner = harness.resolve(JobRunner);
  await harness.ensurePermissionCatalogue();

  departmentId = await harness.createDepartment({
    code: `RPT-${RUN}`,
    name: `Reporting ${RUN}`,
  });

  managerEmployeeId = await harness.createEmployee({
    code: `RM-${RUN}`,
    firstName: 'Meera',
    lastName: 'Nair',
    departmentId,
  });
  reportEmployeeId = await harness.createEmployee({
    code: `RA-${RUN}`,
    firstName: 'Asha',
    lastName: 'Menon',
    departmentId,
    reportingManagerId: managerEmployeeId,
  });
  outsideEmployeeId = await harness.createEmployee({
    code: `RX-${RUN}`,
    firstName: 'Vikram',
    lastName: 'Rao',
  });

  const hrRole = await harness.createSystemRole(SYSTEM_ROLES.HR);
  // A manager who may export but only sees their team: exactly the case the
  // brief names. Not a seed role -- the seed matrix gives Operations
  // `report.view` without `report.export` -- so the role is built here.
  const managerRole = await harness.createRole(`Reporting manager ${RUN}`, [
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.ATTENDANCE_VIEW_TEAM,
  ]);
  // Read-only: `report.view` and nothing that lets a file leave the building.
  const viewerRole = await harness.createRole(`Reporting viewer ${RUN}`, [
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ATTENDANCE_VIEW_ALL,
  ]);

  const hr = await harness.createUser({ email: scopedEmail('report.hr'), roleIds: [hrRole] });
  hrUserId = hr.id;
  const manager = await harness.createUser({
    email: scopedEmail('report.manager'),
    roleIds: [managerRole],
    employeeId: managerEmployeeId,
  });
  const viewer = await harness.createUser({
    email: scopedEmail('report.viewer'),
    roleIds: [viewerRole],
  });

  hrToken = (await harness.login(hr.email, hr.password)).token;
  managerToken = (await harness.login(manager.email, manager.password)).token;
  viewerToken = (await harness.login(viewer.email, viewer.password)).token;

  await harness.db.insert(attendanceDays).values([
    {
      orgId: ORG_ID,
      employeeId: reportEmployeeId,
      date: DAY_ONE,
      status: 'PRESENT',
      workedMinutes: 492,
      breakMinutes: 30,
      otMinutes: 12,
      lateMinutes: 7,
      earlyExitMinutes: 0,
      flags: ['late'],
    },
    {
      orgId: ORG_ID,
      employeeId: reportEmployeeId,
      date: DAY_TWO,
      status: 'ABSENT',
      workedMinutes: 0,
      flags: [],
    },
    {
      orgId: ORG_ID,
      employeeId: outsideEmployeeId,
      date: OUTSIDE_DAY,
      status: 'PRESENT',
      workedMinutes: 480,
      flags: [],
    },
  ]);

  const photos = await storePunchPhotos(hrUserId);
  await harness.db.insert(punches).values([
    {
      orgId: ORG_ID,
      employeeId: reportEmployeeId,
      attendanceDate: DAY_ONE,
      punchType: 'IN',
      serverTime: new Date(`${DAY_ONE}T03:37:00.000Z`),
      photoFileId: photos.full,
      thumbnailFileId: photos.thumb,
      source: 'MOBILE',
      latitude: 12.9716,
      longitude: 77.5946,
      gpsAccuracyM: 9,
      // A reason a spreadsheet would execute if the writer did not neutralise it.
      reason: '=cmd|/c calc',
      flags: ['low_gps_accuracy'],
      idempotencyKey: `report-${RUN}-in`,
    },
    {
      orgId: ORG_ID,
      employeeId: outsideEmployeeId,
      attendanceDate: OUTSIDE_DAY,
      punchType: 'IN',
      serverTime: new Date(`${OUTSIDE_DAY}T03:40:00.000Z`),
      photoFileId: photos.full,
      thumbnailFileId: photos.thumb,
      source: 'WEB',
      flags: [],
      idempotencyKey: `report-${RUN}-out`,
    },
  ]);

  runner.startWorkers();
}, 120_000);

afterAll(async () => {
  // The harness may have failed to start; without this the teardown error
  // replaces the one that actually explains the run.
  if (!started) return;

  if (createdExportIds.length > 0) {
    // The produced files are found from the rows, so an export added by a test
    // that was skipped or failed still gets cleaned up.
    const produced = await harness.db
      .select({ fileId: exportJobs.fileId })
      .from(exportJobs)
      .where(inArray(exportJobs.id, createdExportIds));
    for (const row of produced) {
      if (row.fileId !== null) createdFileIds.push(row.fileId);
    }
    await harness.db.delete(exportJobs).where(inArray(exportJobs.id, createdExportIds));
  }
  // Attendance days are deletable; punches are not (REQ-D-12's trigger), which
  // is why every employee here is unique to the run.
  await harness.db.delete(attendanceDays).where(eq(attendanceDays.orgId, ORG_ID));
  if (createdFileIds.length > 0) {
    await harness.db.delete(files).where(inArray(files.id, createdFileIds));
  }
  await harness.close();
}, 60_000);

describe('the report catalogue', () => {
  it('is served to a holder of report.view and refused to everyone else', async () => {
    const allowed = await harness.get<{ data: ReportDefinition[] }>('/reports', {
      token: viewerToken,
    });
    expect(allowed.status).toBe(200);
    // This reader holds `attendance.view.all` and no leave or employee key, so
    // the catalogue offers the attendance reports and withholds the rest. A
    // report they could only ever see empty is not a report they are offered.
    const forViewer = allowed.body.data.map((report) => report.key);
    expect(forViewer).toContain('attendance-register');
    expect(forViewer).toContain('punch-audit');
    expect(forViewer).toContain('monthly-muster');
    expect(forViewer).not.toContain('leave-balance');
    expect(forViewer).not.toContain('leave-ledger');
    expect(forViewer).not.toContain('headcount');

    // HR holds every family, and sees the whole list in its declared order.
    const forHr = await harness.get<{ data: ReportDefinition[] }>('/reports', { token: hrToken });
    expect(forHr.body.data.map((report) => report.key)).toEqual([...REPORT_KEYS]);

    const anonymous = await harness.get('/reports');
    expect(anonymous.status).toBe(401);
  });

  it('answers 404 for a report this build does not have', async () => {
    // Payroll Input (REQ-J-04) is not built: the client dropped it. A stale
    // link to it must not render an empty report, which nobody could tell from
    // a month in which nothing happened.
    const missing = await harness.get('/reports/payroll-input/rows', { token: hrToken });
    expect(missing.status).toBe(404);
  });
});

describe('the attendance register rows', () => {
  it('returns the period the caller asked for, paginated', async () => {
    const result = await harness.get<Paginated<AttendanceDaySummary>>(
      `/reports/attendance-register/rows?from=${DAY_ONE}&to=${DAY_TWO}&departmentId=${departmentId}`,
      { token: hrToken },
    );

    expect(result.status).toBe(200);
    expect(result.body.meta.total).toBe(2);
    expect(result.body.data.map((row) => row.date)).toEqual([DAY_TWO, DAY_ONE]);
    expect(result.body.data[1]?.flags).toContain('late');
  });

  it('narrows to a manager team without being told to', async () => {
    // Same request, no employee filter, wider period: the manager must not see
    // the employee outside their reporting line.
    const forManager = await harness.get<Paginated<AttendanceDaySummary>>(
      `/reports/attendance-register/rows?from=${DAY_ONE}&to=${OUTSIDE_DAY}`,
      { token: managerToken },
    );
    expect(forManager.status).toBe(200);
    expect(forManager.body.data.map((row) => row.employeeCode).sort()).toEqual([
      `RA-${RUN}`,
      `RA-${RUN}`,
    ]);

    const forHr = await harness.get<Paginated<AttendanceDaySummary>>(
      `/reports/attendance-register/rows?from=${DAY_ONE}&to=${OUTSIDE_DAY}`,
      { token: hrToken },
    );
    expect(forHr.body.data.map((row) => row.employeeCode)).toContain(`RX-${RUN}`);
  });

  it('honours the status filter and a sort the report declares', async () => {
    const absent = await harness.get<Paginated<AttendanceDaySummary>>(
      `/reports/attendance-register/rows?from=${DAY_ONE}&to=${DAY_TWO}&departmentId=${departmentId}&status=ABSENT`,
      { token: hrToken },
    );
    expect(absent.body.meta.total).toBe(1);
    expect(absent.body.data[0]?.date).toBe(DAY_TWO);

    const ascending = await harness.get<Paginated<AttendanceDaySummary>>(
      `/reports/attendance-register/rows?from=${DAY_ONE}&to=${DAY_TWO}&departmentId=${departmentId}&sort=date`,
      { token: hrToken },
    );
    expect(ascending.body.data.map((row) => row.date)).toEqual([DAY_ONE, DAY_TWO]);
  });

  it('refuses a caller holding no report permission', async () => {
    const employeeRole = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);
    const employee = await harness.createUser({
      email: scopedEmail('report.employee'),
      roleIds: [employeeRole],
      employeeId: reportEmployeeId,
    });
    const session = await harness.login(employee.email, employee.password);

    const denied = await harness.get(
      `/reports/attendance-register/rows?from=${DAY_ONE}&to=${DAY_TWO}`,
      { token: session.token },
    );
    expect(denied.status).toBe(403);
    expect(
      (denied.body as { error: { details: { requiredAnyOf: string[] } } }).error.details
        .requiredAnyOf,
    ).toContain(PERMISSIONS.REPORT_VIEW);
  });
});

describe('the punch audit rows', () => {
  it('carries a thumbnail id for the list and the full id only for the viewer', async () => {
    const result = await harness.get<Paginated<PunchRecord>>(
      `/reports/punch-audit/rows?from=${DAY_ONE}&to=${DAY_TWO}&departmentId=${departmentId}`,
      { token: hrToken },
    );

    expect(result.status).toBe(200);
    expect(result.body.meta.total).toBe(1);
    const row = result.body.data[0];
    // REQ-D-03a: a list renders the thumbnail. Both ids are on the row and the
    // screen is what must reach for the cheap one.
    expect(row?.photo.thumbnailFileId).toBeTruthy();
    expect(row?.photo.fileId).toBeTruthy();
    expect(row?.photo.fileId).not.toBe(row?.photo.thumbnailFileId);
    expect(row?.flags).toContain('low_gps_accuracy');
    expect(row?.location?.latitude).toBeCloseTo(12.9716, 4);
  });

  it('scopes to the manager team like every other read', async () => {
    const forManager = await harness.get<Paginated<PunchRecord>>(
      `/reports/punch-audit/rows?from=${DAY_ONE}&to=${OUTSIDE_DAY}`,
      { token: managerToken },
    );
    expect(forManager.body.data.every((row) => row.employeeCode === `RA-${RUN}`)).toBe(true);

    const forHr = await harness.get<Paginated<PunchRecord>>(
      `/reports/punch-audit/rows?from=${DAY_ONE}&to=${OUTSIDE_DAY}`,
      { token: hrToken },
    );
    expect(forHr.body.data.map((row) => row.employeeCode)).toContain(`RX-${RUN}`);
  });
});

describe('saved views', () => {
  let viewId = '';

  it('creates one, and lists it back for its owner only', async () => {
    const created = await harness.post<SavedView>('/reports/views', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        name: `Late in March ${RUN}`,
        config: { filters: { from: DAY_ONE, to: DAY_TWO, flags: 'late' }, columns: ['date', 'status'] },
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.isOwn).toBe(true);
    viewId = created.body.id;

    const mine = await harness.get<SavedView[]>(
      '/reports/views?reportKey=attendance-register',
      { token: hrToken },
    );
    expect(mine.body.map((view) => view.id)).toContain(viewId);

    // Not shared, so another reader does not see it.
    const theirs = await harness.get<SavedView[]>(
      '/reports/views?reportKey=attendance-register',
      { token: managerToken },
    );
    expect(theirs.body.map((view) => view.id)).not.toContain(viewId);
  });

  it('replaces rather than duplicating when the same name is saved again', async () => {
    const again = await harness.post<SavedView>('/reports/views', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        // Same name in different case: the unique index is on lower(name).
        name: `late in march ${RUN}`,
        config: { filters: { status: 'ABSENT' }, columns: ['date'] },
        isShared: true,
      },
    });

    expect(again.status).toBe(201);
    expect(again.body.id).toBe(viewId);

    const listed = await harness.get<SavedView[]>(
      '/reports/views?reportKey=attendance-register',
      { token: hrToken },
    );
    expect(listed.body.filter((view) => view.id === viewId)).toHaveLength(1);
    expect(listed.body.find((view) => view.id === viewId)?.config.filters.status).toBe('ABSENT');
  });

  it('shows a shared view to another reader, marked as not theirs', async () => {
    const theirs = await harness.get<SavedView[]>(
      '/reports/views?reportKey=attendance-register',
      { token: managerToken },
    );
    const shared = theirs.body.find((view) => view.id === viewId);
    expect(shared?.isShared).toBe(true);
    expect(shared?.isOwn).toBe(false);
  });

  it('lets only the owner delete it', async () => {
    const refused = await harness.request('DELETE', `/reports/views/${viewId}`, {
      token: managerToken,
    });
    // Not 403: a shared view another person can see should not have its
    // ownership confirmed by the shape of the refusal.
    expect(refused.status).toBe(404);

    const removed = await harness.request('DELETE', `/reports/views/${viewId}`, {
      token: hrToken,
    });
    expect(removed.status).toBe(204);

    const listed = await harness.get<SavedView[]>(
      '/reports/views?reportKey=attendance-register',
      { token: hrToken },
    );
    expect(listed.body.map((view) => view.id)).not.toContain(viewId);
  });
});

describe('requesting an export', () => {
  it('is refused to a reader who may look but not export', async () => {
    const denied = await harness.post('/reports/exports', {
      token: viewerToken,
      body: { reportKey: 'attendance-register', filters: { from: DAY_ONE, to: DAY_TWO } },
    });
    expect(denied.status).toBe(403);
    expect(
      (denied.body as { error: { details: { requiredAnyOf: string[] } } }).error.details
        .requiredAnyOf,
    ).toContain(PERMISSIONS.REPORT_EXPORT);
  });

  it('refuses a period longer than a year, before any work is queued', async () => {
    const refused = await harness.post('/reports/exports', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        filters: { from: '2020-01-01', to: '2026-01-01' },
      },
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { error: { message: string } }).error.message).toBeTruthy();
    expect(MAX_EXPORT_RANGE_DAYS).toBe(366);
  });

  /**
   * REQ-J-03's Excel export, through the whole stack rather than at the writer.
   *
   * The unit tests build a workbook from a fixture; this proves the job, the
   * file store, the signed URL and the download route all carry the bytes
   * unaltered -- an xlsx is a zip, and a layer that helpfully re-encodes it as
   * UTF-8 corrupts it in a way no text export would reveal.
   */
  it('produces a real Excel workbook, not a CSV wearing an .xlsx name', async () => {
    const accepted = await harness.post<ExportJobSummary>('/reports/exports', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        filters: { from: DAY_ONE, to: DAY_TWO },
        format: 'XLSX',
      },
    });
    expect(accepted.status).toBe(202);
    createdExportIds.push(accepted.body.id);
    expect(accepted.body.filename.endsWith('.xlsx')).toBe(true);

    const finished = await waitForExport(hrToken, accepted.body.id);
    expect(finished.status, finished.error ?? '').toBe('DONE');

    const bytes = await downloadBytes(hrToken, accepted.body.id);
    // The zip signature. This is the assertion that a renamed CSV fails.
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = book.worksheets[0];
    expect(sheet).toBeDefined();
    // The formatting REQ-J-03 names, present in the delivered file and not
    // only in the writer's unit test.
    expect(sheet?.views[0]?.state).toBe('frozen');
    expect(typeof sheet?.autoFilter).toBe('string');
    expect(sheet?.getRow(1).getCell(1).text.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('an export, end to end', () => {
  let exportId = '';

  it('is accepted, queued, and audited with the filters that were applied', async () => {
    const accepted = await harness.post<ExportJobSummary>('/reports/exports', {
      token: hrToken,
      body: {
        reportKey: 'attendance-register',
        filters: { from: DAY_ONE, to: DAY_TWO, departmentId },
        columns: ['date', 'employeeCode', 'employeeName', 'workedMinutes', 'status', 'flags'],
      },
    });

    expect(accepted.status).toBe(202);
    expect(accepted.body.status).toBe('QUEUED');
    expect(accepted.body.filename).toMatch(/^attendance-register-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/u);
    expect(accepted.body.downloadable).toBe(false);
    exportId = accepted.body.id;
    createdExportIds.push(exportId);

    // REQ-J-06: who, what, filters, when. The action alone is not the
    // requirement -- the row has to say what was exported.
    expect(await harness.waitForAuditEntity(exportId)).toBe(true);
    const trail = await harness.db.execute<{
      actor_user_id: string;
      after: { reportKey: string; filters: { departmentId?: string }; columns: string[] };
    }>(
      sql`SELECT actor_user_id, after FROM audit_logs
           WHERE org_id = ${ORG_ID} AND entity_id = ${exportId}
             AND action = 'report.export.requested' LIMIT 1`,
    );
    const entry = trail.rows[0];
    expect(entry?.actor_user_id).toBe(hrUserId);
    expect(entry?.after.reportKey).toBe('attendance-register');
    expect(entry?.after.filters.departmentId).toBe(departmentId);
    expect(entry?.after.columns).toContain('workedMinutes');
  }, 60_000);

  it('produces a file whose contents match the request', async () => {
    const finished = await waitForExport(hrToken, exportId);

    expect(finished.status).toBe('DONE');
    expect(finished.error).toBeNull();
    expect(finished.rowCount).toBe(2);
    expect(finished.progress).toBe(100);
    expect(finished.downloadable).toBe(true);

    const csv = await downloadText(hrToken, exportId);
    const lines = csv.split('\r\n');

    // REQ-J-03's header block.
    expect(lines[0]).toContain('Vyuha Reports Test');
    expect(lines[1]).toBe('Attendance register');
    expect(csv).toContain(`Period,${DAY_ONE} to ${DAY_TWO}`);
    expect(csv).toContain(`Department,Reporting ${RUN}`);
    expect(csv).toMatch(/Generated,\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2} \S+/u);
    expect(csv).toContain('Rows,2');

    // Only the columns that were asked for, in the report's own order.
    const headerIndex = lines.findIndex((line) => line.startsWith('Date,'));
    expect(lines[headerIndex]).toBe('Date,Code,Employee,Worked,Status,Flags');

    const body = lines.slice(headerIndex + 1).filter((line) => line.length > 0);
    expect(body).toHaveLength(2);
    expect(body[0]).toBe(`03-03-2026,RA-${RUN},Asha Menon,,ABSENT,`);
    expect(body[1]).toBe(`02-03-2026,RA-${RUN},Asha Menon,08:12,PRESENT,late`);
  }, 120_000);

  it('records the completion, with its row count, in the trail', async () => {
    expect(await harness.waitForAuditAction('report.export.completed')).toBe(true);
  }, 30_000);

  it('appears in the requester tray and nobody else', async () => {
    const mine = await harness.get<{ data: ExportJobSummary[] }>('/reports/exports', {
      token: hrToken,
    });
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((job) => job.id)).toContain(exportId);
    expect(mine.body.data[0]?.expiresAt).toBeTruthy();

    const theirs = await harness.get<{ data: ExportJobSummary[] }>('/reports/exports', {
      token: managerToken,
    });
    expect(theirs.body.data.map((job) => job.id)).not.toContain(exportId);

    // ...and reading it directly is a 404 rather than a 403.
    const direct = await harness.get(`/reports/exports/${exportId}`, { token: managerToken });
    expect(direct.status).toBe(404);
    const download = await harness.get(`/reports/exports/${exportId}/download`, {
      token: managerToken,
    });
    expect(download.status).toBe(404);
  });

  it('sets a seven-day retention on the file, which the purge job already sweeps', async () => {
    const row = (
      await harness.db
        .select({ fileId: exportJobs.fileId })
        .from(exportJobs)
        .where(eq(exportJobs.id, exportId))
    )[0];
    expect(row?.fileId).toBeTruthy();

    const fileId = row?.fileId;
    if (fileId == null) throw new Error('The completed export recorded no file.');
    createdFileIds.push(fileId);

    const file = (
      await harness.db
        .select({ expiresAt: files.expiresAt, purpose: files.purpose, mime: files.mime })
        .from(files)
        .where(eq(files.id, fileId))
    )[0];

    expect(file?.purpose).toBe('EXPORT');
    expect(file?.mime).toContain('text/csv');

    const days = ((file?.expiresAt?.getTime() ?? 0) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});

describe('an export by a manager', () => {
  it('contains only their team, whatever period they ask for', async () => {
    const accepted = await harness.post<ExportJobSummary>('/reports/exports', {
      token: managerToken,
      body: {
        reportKey: 'attendance-register',
        filters: { from: DAY_ONE, to: OUTSIDE_DAY },
      },
    });
    expect(accepted.status).toBe(202);
    createdExportIds.push(accepted.body.id);

    const finished = await waitForExport(managerToken, accepted.body.id);
    expect(finished.status).toBe('DONE');
    // Two days for their report, and nothing for the employee outside the line.
    expect(finished.rowCount).toBe(2);

    const csv = await downloadText(managerToken, accepted.body.id);
    expect(csv).toContain(`RA-${RUN}`);
    expect(csv).not.toContain(`RX-${RUN}`);
  }, 120_000);
});

describe('a punch audit export', () => {
  it('neutralises a reason a spreadsheet would run as a formula', async () => {
    const accepted = await harness.post<ExportJobSummary>('/reports/exports', {
      token: hrToken,
      body: {
        reportKey: 'punch-audit',
        filters: { from: DAY_ONE, to: DAY_TWO, departmentId },
        columns: ['attendanceDate', 'serverTime', 'employeeCode', 'reason', 'flags'],
      },
    });
    expect(accepted.status).toBe(202);
    createdExportIds.push(accepted.body.id);

    const finished = await waitForExport(hrToken, accepted.body.id);
    expect(finished.status).toBe('DONE');
    expect(finished.rowCount).toBe(1);

    const csv = await downloadText(hrToken, accepted.body.id);
    // The stored reason is `=cmd|/c calc`; the written cell is prefixed so a
    // spreadsheet treats it as text.
    expect(csv).toContain("'=cmd|/c calc");
    expect(csv).not.toMatch(/(^|,)=cmd/mu);
    expect(csv).toContain('low_gps_accuracy');
  }, 120_000);
});

describe('the export job itself', () => {
  it('refuses a requester who no longer holds report.export, and says so on the row', async () => {
    // Deterministic rather than a race: the row is written for a user who
    // never had the permission, which is the same state the worker sees when a
    // role is stripped between the request and the run. The endpoint could not
    // have produced this row, and that is the point -- the job re-resolves the
    // requester instead of trusting the moment the button was pressed.
    const viewerOnly = await harness.createUser({ email: scopedEmail('report.stripped') });
    const inserted = await harness.db
      .insert(exportJobs)
      .values({
        orgId: ORG_ID,
        requestedBy: viewerOnly.id,
        reportKey: 'attendance-register',
        filters: { filters: { from: DAY_ONE, to: DAY_TWO }, columns: [] },
        status: 'QUEUED',
        format: 'CSV',
        filename: 'stripped.csv',
        progress: 0,
      })
      .returning({ id: exportJobs.id });

    const rowId = inserted[0]?.id ?? '';
    expect(rowId).toBeTruthy();
    createdExportIds.push(rowId);

    const jobId = await runner.enqueue('generate-report-export', {
      orgId: ORG_ID,
      exportJobId: rowId,
      requestedAt: new Date().toISOString(),
    });
    const job = await runner.queueFor(QUEUES.EXPORT).getJob(jobId);
    // Completed, not failed. A refusal is a decision, and retrying it five
    // times with backoff would put a permanent condition in the failed set.
    expect(await settle(job as Job)).toBe('completed');
    expect(
      ((await runner.queueFor(QUEUES.EXPORT).getJob(jobId))?.returnvalue as
        | { outcome?: string }
        | undefined)?.outcome,
    ).toBe('refused');

    const row = (
      await harness.db
        .select({ status: exportJobs.status, error: exportJobs.error, fileId: exportJobs.fileId })
        .from(exportJobs)
        .where(eq(exportJobs.id, rowId))
    )[0];
    expect(row?.status).toBe('FAILED');
    expect(row?.fileId).toBeNull();
    expect(row?.error).toContain('can no longer export');

    const refusal = await harness.db.execute<{ action: string }>(
      sql`SELECT action FROM audit_logs
           WHERE org_id = ${ORG_ID} AND entity_id = ${rowId}
             AND action = 'report.export.refused' LIMIT 1`,
    );
    expect(refusal.rows).toHaveLength(1);
  }, 120_000);

  it('skips a queued job whose row has been removed, rather than retrying forever', async () => {
    const queue = runner.queueFor(QUEUES.EXPORT);
    const job = await queue.add(
      'generate-report-export',
      {
        orgId: ORG_ID,
        exportJobId: '01900000-0000-7000-8000-00000000dead',
        requestedAt: new Date().toISOString(),
      },
      { attempts: 1, removeOnFail: false, removeOnComplete: false },
    );

    // Completed, not failed: a missing row is nothing to produce and nothing
    // broken, and failing would fill the failed set the monitor reads.
    expect(await settle(job)).toBe('completed');
    const reloaded = await queue.getJob(job.id ?? '');
    expect((reloaded?.returnvalue as { outcome?: string } | undefined)?.outcome).toBe('skipped');
    await reloaded?.remove();
  }, 60_000);
});
