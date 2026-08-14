import {
  SYSTEM_ROLES,
  uuidv7,
  type PunchContext,
  type PunchReceipt,
} from '@vyuha/shared';
import { Client } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../../../platform/common/env.js';
import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';
import { localDateIn } from '../day-engine/calendar-date.js';
import { shiftAssignments, shifts } from '../schema/index.js';
import { PUNCH_ORDERING_LOCK_NAMESPACE } from './punch.repository.js';

/**
 * One contended employee must not take the API down.
 *
 * The REQ-D-01 ordering fix put every punch inside a transaction that waits on
 * `pg_advisory_xact_lock`. The wait happens while the transaction holds one of
 * the pool's ten connections and with no bound on how long it may last, so a
 * single stuck lock -- a hung transaction, a session an operator left open in
 * psql, a hashtext collision under a slow query -- parks the whole pool.
 * Measured before the fix: twelve punches for one employee left 10/10 backends
 * active and waiting, `GET /ready` answered 503 after five seconds, and
 * `GET /me/today` and `POST /punches` for *unrelated* employees answered 500.
 *
 * The lock is not the problem; waiting on it with a connection in hand is. So
 * this file holds the real lock from outside the application -- the same
 * namespace and key `withPunchOrderingLock` uses, imported rather than
 * retyped -- and asserts on the traffic that has nothing to do with that
 * employee.
 *
 * What would make it pass while the outage is still there:
 *
 * - Firing one punch. Ten is the pool; twelve is the pool plus two waiting for
 *   a connection, which is the shape of the outage.
 * - Measuring the unrelated request after the contended ones have been
 *   answered. They are still in flight, deliberately unawaited, when the
 *   healthy traffic is timed.
 * - Accepting any non-200 from the contended punches. A 500 is precisely what
 *   was wrong: a PWA outbox cannot tell "retry this" from "this punch is
 *   broken", so the code and the status are both asserted.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e4';
const TIMEZONE = 'Asia/Kolkata';
/** Two more than the pool's `max`, so the exhaustion path is exercised too. */
const CONTENDERS = 12;
/** Generous: the healthy paths are one indexed query each. */
const HEALTHY_BUDGET_MS = 4_000;

let harness: ApiHarness;
let runId: string;
let today: string;
let photoBytes: Buffer;

let stuckEmployeeId: string;
let bystanderEmployeeId: string;
let patientEmployeeId: string;
let stuckToken: string;
let bystanderToken: string;
let patientToken: string;

let holder: Client;

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
  readonly code: string | null;
}

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
    }),
  );

  return async () => {
    const response = await fetch(`${harness.baseUrl}/punches`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      body: form,
      // Longer than any bound the server may apply, so a request that never
      // comes back is reported as a hang rather than as a client timeout.
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const body = (text.length > 0 ? JSON.parse(text) : {}) as PunchReceipt & {
      error?: { code: string };
    };
    return { status: response.status, code: body.error?.code ?? null };
  };
}

/**
 * Backends this API is holding on this database, from the server's own view.
 *
 * Asked over the probe's own connection rather than through `harness.db`. The
 * harness shares the application's pool, so the first version of this measured
 * an exhausted pool by asking the exhausted pool -- and reported a five-second
 * connect timeout instead of a number.
 */
async function activeBackends(): Promise<number> {
  const result = await holder.query<{ value: number }>(`
    SELECT count(*)::int AS value
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND application_name = 'vyuha-api'
       AND state <> 'idle'
  `);
  return result.rows[0]?.value ?? 0;
}

interface Timed {
  readonly status: number;
  readonly ms: number;
}

async function timedGet(path: string, token: string | null): Promise<Timed> {
  const started = Date.now();
  try {
    const response = await fetch(`${harness.baseUrl}${path}`, {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(HEALTHY_BUDGET_MS + 6_000),
    });
    await response.text();
    return { status: response.status, ms: Date.now() - started };
  } catch {
    // A timeout is a measurement, not an error: the point of this file is what
    // unrelated traffic experiences.
    return { status: 0, ms: Date.now() - started };
  }
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Punch Lock Contention Fixture Org', {
    preservePeople: true,
  });
  runId = uuidv7().slice(-8);
  today = localDateIn(new Date(), TIMEZONE);

  photoBytes = await sharp({
    create: { width: 1280, height: 960, channels: 3, background: { r: 20, g: 70, b: 120 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();

  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);
  stuckEmployeeId = await harness.createEmployee({ code: `LC-S-${runId}`, firstName: 'Latika' });
  bystanderEmployeeId = await harness.createEmployee({ code: `LC-B-${runId}`, firstName: 'Bhavin' });
  patientEmployeeId = await harness.createEmployee({ code: `LC-P-${runId}`, firstName: 'Priya' });

  const startCandidate = istTime(-2);
  const startTime = startCandidate > istTime(0) ? '00:00:00' : startCandidate;
  const endHour = Math.min(Number(istTime(0).slice(0, 2)) + 4, 23);
  const endTime = `${String(endHour).padStart(2, '0')}:59:00`;

  const shiftRows = await harness.db
    .insert(shifts)
    .values({
      orgId: ORG_ID,
      code: `LC-${runId}`,
      name: 'Punch Lock Probe Shift (test only)',
      startTime,
      endTime,
      breakMinutes: 0,
    })
    .returning({ id: shifts.id });
  const shiftId = shiftRows[0]?.id;
  if (shiftId === undefined) throw new Error('shift fixture insert returned no row');

  await harness.db.insert(shiftAssignments).values(
    [stuckEmployeeId, bystanderEmployeeId, patientEmployeeId].map((employeeId) => ({
      orgId: ORG_ID,
      employeeId,
      shiftId,
      effectiveFrom: today,
      effectiveTo: today,
    })),
  );

  const logins = await Promise.all(
    [
      ['lc-stuck', stuckEmployeeId],
      ['lc-bystander', bystanderEmployeeId],
      ['lc-patient', patientEmployeeId],
    ].map(async ([label, employeeId]) => {
      const user = await harness.createUser({
        email: scopedEmail(label ?? ''),
        roleIds: [employeeRoleId],
        employeeId,
      });
      return (await harness.login(user.email, user.password)).token;
    }),
  );
  [stuckToken, bystanderToken, patientToken] = logins as [string, string, string];
  expect([stuckToken, bystanderToken, patientToken].every((token) => token !== '')).toBe(true);

  // A connection outside the pool, so the lock it takes cannot be released by
  // anything the application does.
  holder = new Client({ connectionString: env.DATABASE_URL, application_name: 'vyuha-lock-probe' });
  await holder.connect();
}, 60_000);

afterAll(async () => {
  await holder.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
  await holder.end().catch(() => undefined);
  await harness.close();
});

describe('a stuck employee lock does not take the API down', () => {
  it('answers unrelated traffic while twelve punches contend for one held lock', async () => {
    await holder.query(
      'SELECT pg_advisory_lock($1, hashtext($2))',
      [PUNCH_ORDERING_LOCK_NAMESPACE, stuckEmployeeId],
    );

    const fire = Array.from({ length: CONTENDERS }, (_, i) =>
      preparePunch(stuckToken, `lc-stuck-${String(i)}-${runId}`),
    );

    let contended: Attempt[] = [];
    let refused: Attempt = { status: 0, code: null };
    let health: Timed = { status: 0, ms: 0 };
    let today: Timed = { status: 0, ms: 0 };
    let backends = 0;

    const inFlight = Promise.all(fire.map((send) => send()));
    try {
      // Long enough for every one of them to have reached the lock.
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      backends = await activeBackends();
      [health, today, refused] = await Promise.all([
        timedGet('/ready', null),
        timedGet('/me/today', bystanderToken),
        // One more punch, awaited *while* the key is still held, so what a
        // contended caller is told is measured rather than inferred. The
        // twelve above are collected after the release and can legitimately
        // include stragglers that got the key the moment it came free.
        preparePunch(stuckToken, `lc-refused-${runId}`)(),
      ]);
    } finally {
      // Released before the contended requests are collected, not after: an
      // unbounded wait can only end when the key is free, and awaiting them
      // first is a deadlock in the probe rather than a measurement.
      await holder.query('SELECT pg_advisory_unlock_all()');
      contended = await inFlight;
    }

    const detail = JSON.stringify({ backends, health, today, refused, contended });

    // The claim that matters most: nothing about one employee's key reached
    // anybody else's request.
    expect(health.status, detail).toBe(200);
    expect(health.ms, detail).toBeLessThan(HEALTHY_BUDGET_MS);
    expect(today.status, detail).toBe(200);
    expect(today.ms, detail).toBeLessThan(HEALTHY_BUDGET_MS);
    // Fewer than `max`, so the pool was never the thing that was full.
    expect(backends, detail).toBeLessThan(10);

    // And what a contended punch is told. Not 500: a PWA outbox has to be able
    // to tell "try again" from "this punch will never work".
    expect(refused.status, detail).toBe(503);
    expect(refused.code, detail).toBe('SERVICE_BUSY');

    // The twelve either waited out their budget or, once the key came free,
    // met REQ-D-01 on its merits. None of them may be an unhandled fault, and
    // the ordering guarantee still holds over the whole batch.
    for (const attempt of contended) {
      expect([201, 409, 503], detail).toContain(attempt.status);
      expect(attempt.code, detail).not.toBe('INTERNAL_ERROR');
    }
    const accepted = contended.filter((attempt) => attempt.status === 201).length;
    expect(accepted, detail).toBeLessThanOrEqual(1);
  }, 120_000);

  it('still accepts a punch that has to wait a moment for the key', async () => {
    // The bound must be a bound, not a ban. A punch arriving while somebody
    // else holds the key for a few hundred milliseconds -- an ordinary double
    // tap, or a drain finishing its previous entry -- must still be recorded,
    // so a fix that simply refuses under contention fails here.
    await holder.query(
      'SELECT pg_advisory_lock($1, hashtext($2))',
      [PUNCH_ORDERING_LOCK_NAMESPACE, patientEmployeeId],
    );

    const inFlight = preparePunch(patientToken, `lc-patient-${runId}`)();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await holder.query('SELECT pg_advisory_unlock_all()');

    const attempt = await inFlight;
    expect(attempt.status, JSON.stringify(attempt)).toBe(201);

    const context = await harness.get<PunchContext>('/me/today', { token: patientToken });
    expect(context.status, context.text).toBe(200);
    expect(context.body.nextPunchType).toBe('OUT');
  }, 60_000);
});
