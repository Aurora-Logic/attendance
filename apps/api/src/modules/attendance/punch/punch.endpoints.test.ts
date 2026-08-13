import {
  SYSTEM_ROLES,
  uuidv7,
  type AttendanceDayDetail,
  type AttendanceDaySummary,
  type CursorPaginated,
  type Paginated,
  type PunchContext,
  type PunchReceipt,
  type PunchRecord,
  type PunchSyncReport,
  type SignedPhotoUrl,
} from '@vyuha/shared';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';
import { employees } from '../../../platform/db/schema/index.js';
import { localDateIn } from '../day-engine/calendar-date.js';
import { attendanceDays, punches, shiftAssignments, shifts } from '../schema/index.js';

/**
 * The punch endpoints (REQ-D-01 … REQ-D-13) over real HTTP against the real
 * application: guard, multipart parsing, sharp pipeline, MinIO, the punch
 * trigger, and the inline day engine all in the loop.
 *
 * Started with `preservePeople`: a punch makes its employee permanently
 * undeletable (REQ-D-12 plus RESTRICT), so this file mints new people with
 * unique codes on every run rather than resetting them. The shift is likewise
 * per-run, with its window opened around the wall clock, because the server
 * under test punches at real "now" and a fixed fixture date would put every
 * punch outside every window.
 *
 * The three security assertions the brief calls out -- no photo means no
 * punch, one idempotency key means one punch, alternating IN/OUT -- each live
 * in exactly one test here, so removing the corresponding server-side check
 * fails exactly one named test.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000d1';
const TIMEZONE = 'Asia/Kolkata';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let harness: ApiHarness;
let runId: string;
let today: string;

let employeeAId: string;
let employeeBId: string;
let tokenA: string;
let tokenB: string;
let hrToken: string;
let noPunchToken: string;

let photoWithExifBytes: Buffer;
let firstPunchId = '';
let employeeBPunchId = '';

/** `HH:MM:SS` on the IST wall clock, `offsetMinutes` from now. */
function istTime(offsetMinutes: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(Date.now() + offsetMinutes * 60_000));
}

function isoAgo(milliseconds: number): string {
  return new Date(Date.now() - milliseconds).toISOString();
}

interface MultipartResult<T> {
  readonly status: number;
  readonly body: T;
}

/**
 * The harness speaks JSON; this endpoint speaks multipart, so the request is
 * built here with the same fetch the harness uses underneath.
 */
async function multipart<T>(
  path: string,
  token: string,
  parts: {
    readonly payload: unknown;
    readonly photos?: readonly { field: string; bytes: Buffer }[];
    readonly idempotencyKey?: string | null;
  },
): Promise<MultipartResult<T>> {
  const form = new FormData();
  for (const photo of parts.photos ?? []) {
    form.append(photo.field, new Blob([new Uint8Array(photo.bytes)], { type: 'image/jpeg' }), 'punch.jpg');
  }
  form.append('payload', JSON.stringify(parts.payload));

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (parts.idempotencyKey != null) headers['idempotency-key'] = parts.idempotencyKey;

  const response = await fetch(`${harness.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: (text.length > 0 ? JSON.parse(text) : null) as T };
}

function punchIn(
  token: string,
  key: string,
  overrides: Record<string, unknown> = {},
): Promise<MultipartResult<PunchReceipt & ErrorBody>> {
  return multipart('/punches', token, {
    idempotencyKey: key,
    photos: [{ field: 'photo', bytes: photoWithExifBytes }],
    payload: { type: 'IN', clientTime: new Date().toISOString(), source: 'MOBILE', ...overrides },
  });
}

async function countPunches(employeeId: string): Promise<number> {
  const rows = await harness.db
    .select({ value: sql<number>`count(*)::int` })
    .from(punches)
    .where(and(eq(punches.orgId, ORG_ID), eq(punches.employeeId, employeeId)));
  return rows[0]?.value ?? 0;
}

async function fetchPhoto(
  token: string,
  punchId: string,
  variant: 'full' | 'thumbnail',
): Promise<Buffer> {
  const signed = await harness.get<SignedPhotoUrl>(`/punches/${punchId}/photo?variant=${variant}`, {
    token,
  });
  expect(signed.status, signed.text).toBe(200);
  const object = await fetch(signed.body.url);
  expect(object.status).toBe(200);
  return Buffer.from(await object.arrayBuffer());
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Punch Endpoints Fixture Org', { preservePeople: true });
  runId = uuidv7().slice(-8);
  today = localDateIn(new Date(), TIMEZONE);

  // What a phone actually uploads: larger than the 1280 cap, EXIF attached.
  photoWithExifBytes = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: { r: 40, g: 110, b: 170 } },
  })
    .withExif({
      IFD0: { Make: 'ProbePhone', Model: 'X1', Software: 'probe' },
      IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);
  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR);
  // Holds a view key but not punch.self, so the 403 test refuses for exactly
  // the permission this endpoint requires rather than for having none at all.
  const viewerRoleId = await harness.createRole('Punch Viewer Only', ['attendance.view.self']);

  employeeAId = await harness.createEmployee({ code: `PT-A-${runId}`, firstName: 'Punya' });
  employeeBId = await harness.createEmployee({ code: `PT-B-${runId}`, firstName: 'Bala' });

  // The shift window has to contain the wall clock: opened two minutes ago so
  // an IN right now is inside grace, closing hours away so an OUT right now is
  // outside its window and exercises the reason path. Clamped to the same
  // calendar day -- crossesMidnight stays false.
  //
  // Both ends are clamped, not just the end. `istTime(-2)` wraps to the
  // previous day between 00:00 and 00:02 IST, which produced a start of 23:5x
  // against an end of 04:59 on a shift declaring it does not cross midnight -
  // a two-minute window each night in which this file failed for a reason that
  // had nothing to do with punching. Migration 0006 added
  // shifts_schedule_ordered, which now refuses the row outright, so the
  // latent bug became a hard failure. Comparing the two strings detects the
  // wrap without any date arithmetic: they are same-length zero-padded clocks,
  // so a start that sorts after "now" can only have come from wrapping.
  const startCandidate = istTime(-2);
  const startTime = startCandidate > istTime(0) ? '00:00:00' : startCandidate;
  const endHour = Math.min(Number(istTime(0).slice(0, 2)) + 4, 23);
  const endTime = `${String(endHour).padStart(2, '0')}:59:00`;

  const shiftRows = await harness.db
    .insert(shifts)
    .values({
      orgId: ORG_ID,
      code: `PT-${runId}`,
      name: 'Punch Probe Shift (test only)',
      startTime,
      endTime,
      breakMinutes: 0,
    })
    .returning({ id: shifts.id });
  const shiftId = shiftRows[0]?.id;
  if (shiftId === undefined) throw new Error('shift fixture insert returned no row');

  await harness.db.insert(shiftAssignments).values(
    [employeeAId, employeeBId].map((employeeId) => ({
      orgId: ORG_ID,
      employeeId,
      shiftId,
      effectiveFrom: today,
      effectiveTo: today,
    })),
  );

  const userA = await harness.createUser({
    email: scopedEmail('punch-a'),
    roleIds: [employeeRoleId],
    employeeId: employeeAId,
  });
  const userB = await harness.createUser({
    email: scopedEmail('punch-b'),
    roleIds: [employeeRoleId],
    employeeId: employeeBId,
  });
  const hrUser = await harness.createUser({
    email: scopedEmail('punch-hr'),
    roleIds: [hrRoleId],
  });
  // No employee link: one login per employee (`users_employee_uq`), and the
  // 403 this account exists for is about the missing key, not about identity.
  const viewerUser = await harness.createUser({
    email: scopedEmail('punch-viewer'),
    roleIds: [viewerRoleId],
  });

  tokenA = (await harness.login(userA.email, userA.password)).token;
  tokenB = (await harness.login(userB.email, userB.password)).token;
  hrToken = (await harness.login(hrUser.email, hrUser.password)).token;
  noPunchToken = (await harness.login(viewerUser.email, viewerUser.password)).token;
  expect([tokenA, tokenB, hrToken, noPunchToken].every((token) => token !== '')).toBe(true);
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('access control', () => {
  it('refuses an unauthenticated request on every route', async () => {
    for (const [method, path] of [
      ['POST', '/punches'],
      ['POST', '/punches/sync'],
      ['GET', '/punches'],
      ['GET', '/me/today'],
      ['GET', '/attendance/days'],
    ] as const) {
      const result = await harness.request(method, path);
      expect(result.status, `${method} ${path}`).toBe(401);
    }
  });

  it('refuses a punch to an account without punch.self, naming the key', async () => {
    const result = await punchIn(noPunchToken, `pt-403-${runId}`);
    expect(result.status).toBe(403);
    expect(result.body.error.details?.requiredAnyOf).toEqual(['punch.self']);
  });

  it('refuses a punch with no Idempotency-Key header (REQ-D-11)', async () => {
    const result = await multipart<ErrorBody>('/punches', tokenA, {
      photos: [{ field: 'photo', bytes: photoWithExifBytes }],
      payload: { type: 'IN', clientTime: new Date().toISOString(), source: 'MOBILE' },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.message).toContain('Idempotency-Key');
  });
});

describe('POST /punches (REQ-D-01 … REQ-D-13)', () => {
  it('refuses a punch with no photo, before anything is stored (REQ-D-02)', async () => {
    const before = await countPunches(employeeAId);
    const result = await multipart<ErrorBody>('/punches', tokenA, {
      idempotencyKey: `pt-nophoto-${runId}`,
      payload: { type: 'IN', clientTime: new Date().toISOString(), source: 'MOBILE' },
    });

    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('PUNCH_PHOTO_REQUIRED');
    expect(await countPunches(employeeAId)).toBe(before);
  });

  it('records an IN and computes the day inline (technical design §5)', async () => {
    const result = await punchIn(tokenA, `pt-in-${runId}`);

    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body.replayed).toBe(false);
    expect(result.body.punch.type).toBe('IN');
    expect(result.body.punch.attendanceDate).toBe(today);
    expect(result.body.punch.employee.id).toBe(employeeAId);
    // Two objects per punch, and they are different objects (REQ-D-03a).
    expect(result.body.punch.photo.thumbnailFileId).not.toBe(result.body.punch.photo.fileId);
    // No geofence centre and no fix: flagged as unchecked, never as passed.
    expect(result.body.punch.flags).toContain('geofence_disabled');
    expect(result.body.punch.flags).toContain('no_location');

    // The receipt's day is the engine's inline run, not a cached view.
    expect(result.body.day).not.toBeNull();
    expect(result.body.day?.status).toBe('PENDING');
    // `tokenA` is an Employee, so the day embedded here is subject to the same
    // field visibility as the muster row. A figure withheld from
    // `GET /attendance/days` that arrives in a punch receipt instead is not
    // withheld at all -- see `attendance-day-visibility.endpoints.test.ts`.
    expect(result.body.day === null || Object.hasOwn(result.body.day, 'otMinutes')).toBe(false);

    const rows = await harness.db
      .select({ firstIn: attendanceDays.firstInPunchId, status: attendanceDays.status })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.orgId, ORG_ID),
          eq(attendanceDays.employeeId, employeeAId),
          eq(attendanceDays.date, today),
        ),
      );
    expect(rows[0]?.firstIn).toBe(result.body.punch.id);
    expect(rows[0]?.status).toBe('PENDING');

    firstPunchId = result.body.punch.id;
  });

  it('stores a stamped, EXIF-free photo and a smaller 256px thumbnail (REQ-D-03/03a)', async () => {
    const full = await fetchPhoto(tokenA, firstPunchId, 'full');
    const thumbnail = await fetchPhoto(tokenA, firstPunchId, 'thumbnail');

    // Never the client's bytes.
    expect(full.equals(photoWithExifBytes)).toBe(false);

    const fullMeta = await sharp(full).metadata();
    expect(fullMeta.exif).toBeUndefined();
    expect(fullMeta.width).toBeLessThanOrEqual(1280);

    const thumbMeta = await sharp(thumbnail).metadata();
    expect(thumbMeta.exif).toBeUndefined();
    expect(Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0)).toBeLessThanOrEqual(256);
    expect(thumbnail.length).toBeLessThan(full.length);

    // The stamp is pixels, so it is measured as pixels: bright glyphs over the
    // dark band in the bottom sixth of the image. An unstamped photo of this
    // fixture's flat blue background has zero pixels over the threshold there,
    // so this cannot pass by accident.
    const width = fullMeta.width ?? 0;
    const height = fullMeta.height ?? 0;
    const bandHeight = Math.max(44, Math.round(height * 0.155));
    const band = await sharp(full)
      .extract({ left: 0, top: height - bandHeight, width, height: bandHeight })
      .greyscale()
      .raw()
      .toBuffer();
    let bright = 0;
    for (const value of band) if (value > 200) bright += 1;
    expect(bright).toBeGreaterThan(100);
  });

  it('returns the same punch for a replayed Idempotency-Key (REQ-D-11)', async () => {
    const before = await countPunches(employeeAId);
    const replay = await punchIn(tokenA, `pt-in-${runId}`);

    // 200, not 201: nothing was created the second time.
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.punch.id).toBe(firstPunchId);
    expect(await countPunches(employeeAId)).toBe(before);
  });

  it('refuses a second IN while one is open (REQ-D-01)', async () => {
    const result = await punchIn(tokenA, `pt-in2-${runId}`);

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('PUNCH_OUT_OF_ORDER');
    expect(result.body.error.details?.expected).toBe('OUT');
  });

  it('demands a typed reason for an out-of-window punch, then accepts it (REQ-D-06)', async () => {
    // The shift runs for hours yet, so an OUT now is outside its window and
    // the org default is ALLOW_WITH_REASON (05-decisions).
    const refused = await multipart<ErrorBody>('/punches', tokenA, {
      idempotencyKey: `pt-out-${runId}`,
      photos: [{ field: 'photo', bytes: photoWithExifBytes }],
      payload: { type: 'OUT', clientTime: new Date().toISOString(), source: 'MOBILE' },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('PUNCH_REASON_REQUIRED');

    const accepted = await multipart<PunchReceipt>('/punches', tokenA, {
      idempotencyKey: `pt-out-${runId}`,
      photos: [{ field: 'photo', bytes: photoWithExifBytes }],
      payload: {
        type: 'OUT',
        clientTime: new Date().toISOString(),
        source: 'MOBILE',
        reason: 'Leaving early for a medical appointment.',
      },
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.punch.flags).toContain('outside_window');
    expect(accepted.body.punch.reason).toContain('medical');
    expect(accepted.body.day?.firstInAt).not.toBeNull();
    expect(accepted.body.day?.lastOutAt).not.toBeNull();
    expect(accepted.body.day?.flags).toContain('outside_window');
  });

  it('refuses an OUT when nothing is open (REQ-D-01)', async () => {
    const result = await multipart<ErrorBody>('/punches', tokenB, {
      idempotencyKey: `pt-b-out-first-${runId}`,
      photos: [{ field: 'photo', bytes: photoWithExifBytes }],
      payload: {
        type: 'OUT',
        clientTime: new Date().toISOString(),
        source: 'MOBILE',
        reason: 'Trying to punch out before ever punching in.',
      },
    });
    expect(result.status).toBe(409);
    expect(result.body.error.details?.expected).toBe('IN');
  });

  it('rejects a half day marked on an OUT at the schema (REQ-D-07)', async () => {
    const result = await multipart<ErrorBody>('/punches', tokenB, {
      idempotencyKey: `pt-b-half-out-${runId}`,
      photos: [{ field: 'photo', bytes: photoWithExifBytes }],
      payload: {
        type: 'OUT',
        clientTime: new Date().toISOString(),
        source: 'MOBILE',
        isHalfDay: true,
        halfDayPart: 'FIRST_HALF',
      },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('accepts a half day chosen at IN and reflects it on the day (REQ-D-07)', async () => {
    const result = await multipart<PunchReceipt>('/punches', tokenB, {
      idempotencyKey: `pt-b-in-${runId}`,
      photos: [{ field: 'photo', bytes: photoWithExifBytes }],
      payload: {
        type: 'IN',
        clientTime: new Date().toISOString(),
        source: 'MOBILE',
        isHalfDay: true,
        halfDayPart: 'SECOND_HALF',
      },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body.punch.isHalfDayMarked).toBe(true);
    expect(result.body.punch.halfDayPart).toBe('SECOND_HALF');
    // REQ-E-02: marked at punch, the day derives HALF_DAY regardless of hours.
    expect(result.body.day?.status).toBe('HALF_DAY');
    employeeBPunchId = result.body.punch.id;
  });
});

describe('POST /punches/sync (REQ-D-10)', () => {
  it('drains a queue: fresh accepted with its delay, stale rejected, one bad entry loses nothing', async () => {
    const result = await multipart<PunchSyncReport>('/punches/sync', tokenA, {
      photos: [
        { field: 'photos', bytes: photoWithExifBytes },
        { field: 'photos', bytes: photoWithExifBytes },
      ],
      payload: {
        punches: [
          {
            idempotencyKey: `pt-sync-stale-${runId}`,
            photoIndex: 0,
            type: 'IN',
            clientTime: isoAgo(72 * 3600 * 1000),
            reason: 'Queued while the site had no signal.',
          },
          {
            idempotencyKey: `pt-sync-fresh-${runId}`,
            photoIndex: 1,
            type: 'IN',
            clientTime: isoAgo(7 * 60 * 1000),
            reason: 'Queued while the site had no signal.',
          },
        ],
      },
    });

    expect(result.status).toBe(200);
    expect(result.body.created).toBe(1);
    expect(result.body.rejected).toBe(1);

    const stale = result.body.results.find((entry) => entry.idempotencyKey.includes('stale'));
    expect(stale?.outcome).toBe('rejected');
    expect(stale?.error?.code).toBe('PUNCH_QUEUED_TOO_OLD');

    const fresh = result.body.results.find((entry) => entry.idempotencyKey.includes('fresh'));
    expect(fresh?.outcome).toBe('created');
    expect(fresh?.punch?.source).toBe('OFFLINE_SYNC');
    expect(fresh?.punch?.flags).toContain('offline_sync');
    // REQ-D-10: the delay is recorded -- about seven minutes, and filed as
    // sync delay rather than as a broken clock.
    expect(fresh?.punch?.syncDelaySeconds).toBeGreaterThan(300);
    expect(fresh?.punch?.syncDelaySeconds).toBeLessThan(600);
    expect(fresh?.punch?.clockSkewSeconds).toBeNull();
  });

  it('replays the whole batch without creating anything (REQ-D-11)', async () => {
    const before = await countPunches(employeeAId);
    const result = await multipart<PunchSyncReport>('/punches/sync', tokenA, {
      photos: [
        { field: 'photos', bytes: photoWithExifBytes },
        { field: 'photos', bytes: photoWithExifBytes },
      ],
      payload: {
        punches: [
          {
            idempotencyKey: `pt-sync-stale-${runId}`,
            photoIndex: 0,
            type: 'IN',
            clientTime: isoAgo(72 * 3600 * 1000),
            reason: 'Queued while the site had no signal.',
          },
          {
            idempotencyKey: `pt-sync-fresh-${runId}`,
            photoIndex: 1,
            type: 'IN',
            clientTime: isoAgo(7 * 60 * 1000),
            reason: 'Queued while the site had no signal.',
          },
        ],
      },
    });

    expect(result.status).toBe(200);
    expect(result.body.replayed).toBe(1);
    expect(result.body.created).toBe(0);
    expect(result.body.rejected).toBe(1);
    expect(await countPunches(employeeAId)).toBe(before);
  });
});

describe('reads and scope', () => {
  it('shows an employee only their own feed, and a filter cannot widen it', async () => {
    const own = await harness.get<CursorPaginated<PunchRecord>>('/punches', { token: tokenA });
    expect(own.status).toBe(200);
    expect(own.body.data.length).toBeGreaterThan(0);
    expect(own.body.data.every((punch) => punch.employee.id === employeeAId)).toBe(true);

    const widened = await harness.get<CursorPaginated<PunchRecord>>(
      `/punches?employeeId=${employeeBId}`,
      { token: tokenA },
    );
    expect(widened.status).toBe(200);
    expect(widened.body.data).toEqual([]);
  });

  it('pages the feed by cursor without repeating a row', async () => {
    const first = await harness.get<CursorPaginated<PunchRecord>>('/punches?limit=1', {
      token: hrToken,
    });
    expect(first.body.data).toHaveLength(1);
    expect(first.body.meta.hasMore).toBe(true);
    expect(first.body.meta.nextCursor).not.toBeNull();

    const second = await harness.get<CursorPaginated<PunchRecord>>(
      `/punches?limit=1&cursor=${first.body.meta.nextCursor ?? ''}`,
      { token: hrToken },
    );
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0]?.id).not.toBe(first.body.data[0]?.id);
  });

  it('answers 404, not 403, for a photo outside the caller`s scope', async () => {
    const denied = await harness.get<ErrorBody>(`/punches/${employeeBPunchId}/photo`, {
      token: tokenA,
    });
    expect(denied.status).toBe(404);

    const allowed = await harness.get<SignedPhotoUrl>(`/punches/${employeeBPunchId}/photo`, {
      token: hrToken,
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.expiresInSeconds).toBeLessThanOrEqual(300);
  });

  it('serves the muster as { data, meta } with employee refs (GET /attendance/days)', async () => {
    const page = await harness.get<Paginated<AttendanceDaySummary>>(
      `/attendance/days?from=${today}&to=${today}&employeeId=${employeeAId}`,
      { token: hrToken },
    );

    expect(page.status).toBe(200);
    expect(page.body.meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    const day = page.body.data[0];
    expect(day?.employee).toEqual({ id: employeeAId, name: 'Punya' });
    expect(day?.shift?.name).toBe('Punch Probe Shift (test only)');
    expect(day?.date).toBe(today);
  });

  it('filters the muster by flag', async () => {
    const flagged = await harness.get<Paginated<AttendanceDaySummary>>(
      `/attendance/days?from=${today}&to=${today}&flags=outside_window`,
      { token: hrToken },
    );
    expect(flagged.status).toBe(200);
    expect(flagged.body.data.some((day) => day.employee.id === employeeAId)).toBe(true);
    expect(flagged.body.data.every((day) => day.flags.includes('outside_window'))).toBe(true);
  });

  it('serves one day with its punches, in time order', async () => {
    const detail = await harness.get<AttendanceDayDetail>(
      `/attendance/days/${employeeAId}/${today}`,
      { token: tokenA },
    );

    expect(detail.status).toBe(200);
    expect(detail.body.punches.length).toBeGreaterThanOrEqual(3);
    const times = detail.body.punches.map((punch) => punch.serverTime);
    expect([...times].sort()).toEqual(times);
    // Lists carry the thumbnail id; rendering the full image here is the
    // review failure REQ-D-03a names.
    expect(detail.body.punches.every((punch) => punch.photo.thumbnailFileId.length > 0)).toBe(true);
  });

  it('hides another employee`s day behind 404 (IDOR)', async () => {
    const result = await harness.get<ErrorBody>(`/attendance/days/${employeeAId}/${today}`, {
      token: tokenB,
    });
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed date before it reaches the driver', async () => {
    const result = await harness.get<ErrorBody>(`/attendance/days/${employeeAId}/12-08-2026`, {
      token: hrToken,
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('answers the punch screen`s pre-punch questions (GET /me/today, REQ-D-13)', async () => {
    const context = await harness.get<PunchContext>('/me/today', { token: tokenA });

    expect(context.status).toBe(200);
    expect(context.body.photoRequired).toBe(true);
    expect(context.body.timezone).toBe(TIMEZONE);
    expect(context.body.attendanceDate).toBe(today);
    expect(new Date(context.body.serverTime).getTime()).toBeGreaterThan(0);
    expect(context.body.employee?.id).toBe(employeeAId);
    expect(context.body.shift?.name).toBe('Punch Probe Shift (test only)');
    // The offline-sync IN left the day open, so the next punch must be OUT.
    expect(context.body.canPunch).toBe(true);
    expect(context.body.nextPunchType).toBe('OUT');
    expect(context.body.lastPunch?.type).toBe('IN');
    expect(context.body.day).not.toBeNull();
    // Neither premises control is configured yet (OPEN-QUESTIONS 1 and 3),
    // and the screen is told so rather than shown a control that silently
    // does not exist.
    expect(context.body.geofence.enforced).toBe(false);
    expect(context.body.ipAllowlist.enforced).toBe(false);
  });

  it('left an audit row for the punches (REQ-M-01)', async () => {
    expect(await harness.waitForAuditAction('punch.created')).toBe(true);
    expect(await harness.waitForAuditAction('punch.replayed')).toBe(true);
    expect(await harness.waitForAuditAction('attendance.day.computed')).toBe(true);
  });
});

describe('immutability (REQ-D-12)', () => {
  // Drizzle reports a failed statement as "Failed query: ..." and files the
  // database's own words under `cause`, so the trigger's message is asserted
  // through `describeError` -- the same flattening production logging uses.
  it('lets nothing update or delete a punch, including this test', async () => {
    const { describeError } = await import('../../../platform/common/errors.js');

    const updateError = await harness.db
      .update(punches)
      .set({ reason: 'edited' })
      .where(eq(punches.id, firstPunchId))
      .then(() => null)
      .catch((error: unknown) => error);
    expect(updateError, 'the update was accepted').not.toBeNull();
    expect(describeError(updateError)).toContain('append-only');

    const deleteError = await harness.db
      .delete(punches)
      .where(eq(punches.id, firstPunchId))
      .then(() => null)
      .catch((error: unknown) => error);
    expect(deleteError, 'the delete was accepted').not.toBeNull();
    expect(describeError(deleteError)).toContain('append-only');
  });
});

describe('fixture hygiene', () => {
  it('created this run`s people fresh, as preservePeople requires', async () => {
    const rows = await harness.db
      .select({ code: employees.employeeCode })
      .from(employees)
      .where(and(eq(employees.orgId, ORG_ID), eq(employees.employeeCode, `PT-A-${runId}`)));
    expect(rows).toHaveLength(1);
  });
});
