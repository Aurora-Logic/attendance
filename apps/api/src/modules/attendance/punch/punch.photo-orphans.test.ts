import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { SYSTEM_ROLES, uuidv7, type PunchReceipt } from '@vyuha/shared';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../../../platform/common/env.js';
import { files } from '../../../platform/db/schema/index.js';
import { ApiHarness, FIXTURE_OFFICE, scopedEmail } from '../../../test-support/api-harness.js';
import { localDateIn } from '../day-engine/calendar-date.js';
import { punches, shiftAssignments, shifts } from '../schema/index.js';

/**
 * What a refused punch leaves behind.
 *
 * `punch.service.ts` opens by promising that "every rejection happens before a
 * single byte is written to object storage, so a refused punch leaves nothing
 * behind to reconcile". Moving the deciding ordering check inside the advisory
 * lock -- correct, and the fix for REQ-D-01 under concurrency -- moved it from
 * before `storePhoto` to after it, and the promise quietly stopped being true:
 * every loser of a race had already sanitised, stamped, compressed,
 * thumbnailed and PUT two objects, and written two `files` rows that no punch
 * would ever reference.
 *
 * That is not only untidy. `purgeExpiredFiles` sweeps `files`, so an object
 * with no row is unreachable forever, and a `files` row with no punch is a
 * photograph of an employee kept for the retention window for no reason
 * anybody can explain -- which is the opposite of what REQ-M-03's notice
 * promises.
 *
 * What would make this file pass while the leak is still there:
 *
 * - Counting punches. One punch row is exactly what the race already produced;
 *   the count that matters is `files` and the objects behind it.
 * - Firing the requests in sequence, where the pre-flight refuses before any
 *   photo is touched. Every case here races prepared requests, as
 *   `punch.concurrency.test.ts` does and for the same reason.
 * - Counting rows but not objects. Both are counted: deleting the row without
 *   the object is the worse of the two failures, because nothing sweeps it.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e3';
const TIMEZONE = 'Asia/Kolkata';
const RACERS = 5;

let harness: ApiHarness;
let runId: string;
let today: string;
let photoBytes: Buffer;

let raceEmployeeId: string;
let retryEmployeeId: string;
let cleanEmployeeId: string;
let raceToken: string;
let retryToken: string;
let cleanToken: string;

let s3: S3Client;

function istTime(offsetMinutes: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(Date.now() + offsetMinutes * 60_000));
}

interface Attempt {
  readonly status: number;
  readonly body: PunchReceipt & { error?: { code: string } };
}

/** Builds the multipart body up front; only the `fetch` is raced. */
function preparePunch(token: string, key: string): () => Promise<Attempt> {
  const form = new FormData();
  form.append('photo', new Blob([new Uint8Array(photoBytes)], { type: 'image/jpeg' }), 'punch.jpg');
  form.append(
    'payload',
    JSON.stringify({
      type: 'IN',
      clientTime: new Date().toISOString(),
      source: 'MOBILE',
      consentAccepted: true,
      latitude: FIXTURE_OFFICE.latitude,
      longitude: FIXTURE_OFFICE.longitude,
      gpsAccuracyM: 8,
    }),
  );

  return async () => {
    const response = await fetch(`${harness.baseUrl}/punches`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      body: form,
    });
    const text = await response.text();
    return {
      status: response.status,
      body: (text.length > 0 ? JSON.parse(text) : {}) as Attempt['body'],
    };
  };
}

interface PhotoTally {
  readonly fileRows: number;
  readonly referenced: number;
  readonly objects: number;
  readonly bytes: number;
}

/**
 * Everything this employee's punches put into storage, counted from both ends
 * -- the table and the bucket -- because the two can disagree and the
 * disagreement is the interesting case.
 */
async function tallyPhotos(employeeId: string): Promise<PhotoTally> {
  const rows = await harness.db
    .select({ id: files.id, storageKey: files.storageKey, bytes: files.bytes })
    .from(files)
    .where(
      and(
        eq(files.orgId, ORG_ID),
        inArray(files.purpose, ['PUNCH_PHOTO', 'PUNCH_PHOTO_THUMB']),
        sql`${files.storageKey} LIKE ${`%/${employeeId}/%`}`,
      ),
    );

  const referencedRows =
    rows.length === 0
      ? []
      : await harness.db
          .select({ photoFileId: punches.photoFileId, thumbnailFileId: punches.thumbnailFileId })
          .from(punches)
          .where(
            and(
              eq(punches.orgId, ORG_ID),
              or(
                inArray(
                  punches.photoFileId,
                  rows.map((row) => row.id),
                ),
                inArray(
                  punches.thumbnailFileId,
                  rows.map((row) => row.id),
                ),
              ),
            ),
          );

  const referenced = new Set<string>();
  for (const row of referencedRows) {
    referenced.add(row.photoFileId);
    referenced.add(row.thumbnailFileId);
  }

  let objects = 0;
  let bytes = 0;
  for (const prefix of ['photos', 'thumbs']) {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET_PHOTOS,
        Prefix: `${prefix}/${ORG_ID}/`,
      }),
    );
    for (const object of listed.Contents ?? []) {
      if (object.Key?.includes(`/${employeeId}/`) !== true) continue;
      objects += 1;
      bytes += object.Size ?? 0;
    }
  }

  return {
    fileRows: rows.length,
    referenced: rows.filter((row) => referenced.has(row.id)).length,
    objects,
    bytes,
  };
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Punch Photo Orphan Fixture Org', {
    preservePeople: true,
  });
  runId = uuidv7().slice(-8);
  today = localDateIn(new Date(), TIMEZONE);

  s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });

  photoBytes = await sharp({
    create: { width: 1280, height: 960, channels: 3, background: { r: 30, g: 90, b: 140 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();

  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);
  raceEmployeeId = await harness.createEmployee({ code: `PO-R-${runId}`, firstName: 'Ravi' });
  retryEmployeeId = await harness.createEmployee({ code: `PO-T-${runId}`, firstName: 'Tara' });
  cleanEmployeeId = await harness.createEmployee({ code: `PO-C-${runId}`, firstName: 'Kiran' });

  const startCandidate = istTime(-2);
  const startTime = startCandidate > istTime(0) ? '00:00:00' : startCandidate;
  const endHour = Math.min(Number(istTime(0).slice(0, 2)) + 4, 23);
  const endTime = `${String(endHour).padStart(2, '0')}:59:00`;

  const shiftRows = await harness.db
    .insert(shifts)
    .values({
      orgId: ORG_ID,
      code: `PO-${runId}`,
      name: 'Punch Orphan Probe Shift (test only)',
      startTime,
      endTime,
      breakMinutes: 0,
    })
    .returning({ id: shifts.id });
  const shiftId = shiftRows[0]?.id;
  if (shiftId === undefined) throw new Error('shift fixture insert returned no row');

  await harness.db.insert(shiftAssignments).values(
    [raceEmployeeId, retryEmployeeId, cleanEmployeeId].map((employeeId) => ({
      orgId: ORG_ID,
      employeeId,
      shiftId,
      effectiveFrom: today,
      effectiveTo: today,
    })),
  );

  const logins = await Promise.all(
    [
      ['po-race', raceEmployeeId],
      ['po-retry', retryEmployeeId],
      ['po-clean', cleanEmployeeId],
    ].map(async ([label, employeeId]) => {
      const user = await harness.createUser({
        email: scopedEmail(label ?? ''),
        roleIds: [employeeRoleId],
        employeeId,
      });
      return (await harness.login(user.email, user.password)).token;
    }),
  );
  [raceToken, retryToken, cleanToken] = logins as [string, string, string];
  expect([raceToken, retryToken, cleanToken].every((token) => token !== '')).toBe(true);
}, 60_000);

afterAll(async () => {
  s3.destroy();
  await harness.close();
});

describe('a refused punch leaves nothing behind (punch.service.ts, REQ-L-03)', () => {
  it('stores one photo and one thumbnail for five racing INs, not ten', async () => {
    const fire = Array.from({ length: RACERS }, (_, i) =>
      preparePunch(raceToken, `po-race-${String(i)}-${runId}`),
    );
    const attempts = await Promise.all(fire.map((send) => send()));

    const accepted = attempts.filter((attempt) => attempt.status === 201).length;
    expect(accepted, JSON.stringify(attempts.map((a) => a.body.error?.code ?? a.status))).toBe(1);

    const tally = await tallyPhotos(raceEmployeeId);
    // One punch, two objects: the full image and its thumbnail. The four
    // losers must leave no row and no object.
    expect(tally.fileRows, JSON.stringify(tally)).toBe(2);
    expect(tally.objects, JSON.stringify(tally)).toBe(2);
    expect(tally.fileRows - tally.referenced, JSON.stringify(tally)).toBe(0);
  }, 90_000);

  it('stores nothing extra for a concurrent retry of the same Idempotency-Key', async () => {
    // The case the service's own comment calls "the phone on one bar, sending
    // twice": one key, two requests in flight, one punch, and two photos.
    const key = `po-retry-${runId}`;
    const fire = [preparePunch(retryToken, key), preparePunch(retryToken, key)];
    const attempts = await Promise.all(fire.map((send) => send()));

    const statuses = attempts.map((attempt) => attempt.status).sort((a, b) => a - b);
    expect(statuses, JSON.stringify(attempts.map((a) => a.body))).toEqual([200, 201]);

    const tally = await tallyPhotos(retryEmployeeId);
    expect(tally.fileRows, JSON.stringify(tally)).toBe(2);
    expect(tally.objects, JSON.stringify(tally)).toBe(2);
    expect(tally.fileRows - tally.referenced, JSON.stringify(tally)).toBe(0);
  }, 90_000);

  it('still keeps the photo of a punch that was accepted', async () => {
    // The cleanup must not be a delete that fires on the winner too: a punch
    // whose photo has been removed is a punch nobody can defend (REQ-D-02).
    const accepted = await preparePunch(cleanToken, `po-clean-${runId}`)();
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);

    const tally = await tallyPhotos(cleanEmployeeId);
    expect(tally.fileRows, JSON.stringify(tally)).toBe(2);
    expect(tally.objects, JSON.stringify(tally)).toBe(2);
    expect(tally.referenced, JSON.stringify(tally)).toBe(2);
    expect(tally.bytes, JSON.stringify(tally)).toBeGreaterThan(0);
  }, 60_000);
});
