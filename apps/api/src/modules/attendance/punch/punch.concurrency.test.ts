import { SYSTEM_ROLES, uuidv7, type PunchReceipt } from '@vyuha/shared';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';
import { localDateIn } from '../day-engine/calendar-date.js';
import { punches, shiftAssignments, shifts } from '../schema/index.js';
import { PunchRepository, PUNCH_ORDERING_LOCK_NAMESPACE } from './punch.repository.js';

/**
 * REQ-D-01, under concurrency.
 *
 * "Alternating, strictly ordered per attendance day" was enforced correctly in
 * sequence and not at all in parallel. `assertOrdering` read `hasOpenIn` from
 * candidates computed before the insert, with no lock and no covering
 * constraint, so two requests arriving together both read "nothing open" and
 * both were accepted: rows 10ms apart, same employee, same attendance date,
 * both `punch_type = IN`. Repeating it with OUT produced IN, IN, OUT, IN, OUT,
 * OUT on one day. The idempotency index cannot help -- the two requests carry
 * genuinely different keys, which is exactly what a double-tapped button and a
 * drained offline outbox both produce.
 *
 * The muster being wrong is the one thing this product cannot be, so this file
 * exists separately from `punch.endpoints.test.ts`: the fix is a lock, and a
 * lock is the sort of thing that is quietly disabled by a later refactor while
 * every sequential test carries on passing.
 *
 * What would make these tests pass while the bug is still there:
 *
 * - Firing the requests in sequence. `Promise.all` over pre-built requests is
 *   not enough on its own either, so the bodies are built first and only the
 *   `fetch` calls are raced.
 * - Racing so few that the window is missed. Five, and the window is wide --
 *   it spans decoding, stripping, stamping and uploading a photograph.
 * - Asserting only the status codes. The row count is asserted too: the
 *   guarantee is about what is in the table, not about what the API said.
 * - Serialising every punch in the product to get there. The last two cases
 *   are the ones that would fail if the lock were global rather than per
 *   employee, or if it broke idempotent replay.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000d8';
const TIMEZONE = 'Asia/Kolkata';
const RACERS = 5;

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let harness: ApiHarness;
let runId: string;
let today: string;
let photoBytes: Buffer;

let racerEmployeeId: string;
let outEmployeeId: string;
let replayEmployeeId: string;
let soloAEmployeeId: string;
let soloBEmployeeId: string;

let racerToken: string;
let outToken: string;
let replayToken: string;
let soloAToken: string;
let soloBToken: string;

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

interface Attempt {
  readonly status: number;
  readonly body: PunchReceipt & ErrorBody;
}

/**
 * Builds the whole request up front and hands back a thunk that only performs
 * the `fetch`.
 *
 * The separation is the point. Building a multipart body allocates and copies
 * a megabyte of JPEG, and doing that inside the raced callbacks staggers the
 * requests by more than the window being tested -- the first version of this
 * file passed against the unfixed server for exactly that reason.
 */
function preparePunch(
  token: string,
  key: string,
  overrides: Record<string, unknown> = {},
): () => Promise<Attempt> {
  const form = new FormData();
  form.append('photo', new Blob([new Uint8Array(photoBytes)], { type: 'image/jpeg' }), 'punch.jpg');
  form.append(
    'payload',
    JSON.stringify({
      type: 'IN',
      clientTime: new Date().toISOString(),
      source: 'MOBILE',
      consentAccepted: true,
      ...overrides,
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
      body: (text.length > 0 ? JSON.parse(text) : null) as PunchReceipt & ErrorBody,
    };
  };
}

async function punchRows(employeeId: string): Promise<{ type: string; date: string }[]> {
  const rows = await harness.db
    .select({ type: punches.punchType, date: punches.attendanceDate })
    .from(punches)
    .where(and(eq(punches.orgId, ORG_ID), eq(punches.employeeId, employeeId)))
    .orderBy(punches.serverTime, punches.id);
  return rows;
}

function statusTally(attempts: readonly Attempt[]): Record<number, number> {
  const tally: Record<number, number> = {};
  for (const attempt of attempts) tally[attempt.status] = (tally[attempt.status] ?? 0) + 1;
  return tally;
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Punch Concurrency Fixture Org', {
    preservePeople: true,
  });
  runId = uuidv7().slice(-8);
  today = localDateIn(new Date(), TIMEZONE);

  photoBytes = await sharp({
    create: { width: 1280, height: 960, channels: 3, background: { r: 30, g: 90, b: 140 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();

  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);

  racerEmployeeId = await harness.createEmployee({ code: `PC-R-${runId}`, firstName: 'Rani' });
  outEmployeeId = await harness.createEmployee({ code: `PC-O-${runId}`, firstName: 'Omkar' });
  replayEmployeeId = await harness.createEmployee({ code: `PC-P-${runId}`, firstName: 'Pooja' });
  soloAEmployeeId = await harness.createEmployee({ code: `PC-SA-${runId}`, firstName: 'Sanjay' });
  soloBEmployeeId = await harness.createEmployee({ code: `PC-SB-${runId}`, firstName: 'Sneha' });

  // Same clamping as `punch.endpoints.test.ts`, and for the same reason: the
  // window has to contain the real wall clock, and `istTime(-2)` wraps to the
  // previous day in the first two minutes after midnight IST, which migration
  // 0006's shifts_schedule_ordered now refuses outright.
  const startCandidate = istTime(-2);
  const startTime = startCandidate > istTime(0) ? '00:00:00' : startCandidate;
  const endHour = Math.min(Number(istTime(0).slice(0, 2)) + 4, 23);
  const endTime = `${String(endHour).padStart(2, '0')}:59:00`;

  const shiftRows = await harness.db
    .insert(shifts)
    .values({
      orgId: ORG_ID,
      code: `PC-${runId}`,
      name: 'Punch Concurrency Probe Shift (test only)',
      startTime,
      endTime,
      breakMinutes: 0,
    })
    .returning({ id: shifts.id });
  const shiftId = shiftRows[0]?.id;
  if (shiftId === undefined) throw new Error('shift fixture insert returned no row');

  await harness.db.insert(shiftAssignments).values(
    [racerEmployeeId, outEmployeeId, replayEmployeeId, soloAEmployeeId, soloBEmployeeId].map(
      (employeeId) => ({
        orgId: ORG_ID,
        employeeId,
        shiftId,
        effectiveFrom: today,
        effectiveTo: today,
      }),
    ),
  );

  const logins = await Promise.all(
    [
      ['pc-racer', racerEmployeeId],
      ['pc-out', outEmployeeId],
      ['pc-replay', replayEmployeeId],
      ['pc-solo-a', soloAEmployeeId],
      ['pc-solo-b', soloBEmployeeId],
    ].map(async ([label, employeeId]) => {
      const user = await harness.createUser({
        email: scopedEmail(label ?? ''),
        roleIds: [employeeRoleId],
        employeeId,
      });
      const session = await harness.login(user.email, user.password);
      return session.token;
    }),
  );

  [racerToken, outToken, replayToken, soloAToken, soloBToken] = logins as [
    string,
    string,
    string,
    string,
    string,
  ];
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('concurrent punches of the same type (REQ-D-01)', () => {
  it('accepts exactly one of five simultaneous INs and refuses the rest', async () => {
    const fire = Array.from({ length: RACERS }, (_, i) =>
      preparePunch(racerToken, `pc-in-${String(i)}-${runId}`),
    );

    const attempts = await Promise.all(fire.map((send) => send()));
    const tally = statusTally(attempts);
    const detail = JSON.stringify({ tally, codes: attempts.map((a) => a.body.error?.code ?? 'ok') });

    expect(tally[201] ?? 0, detail).toBe(1);
    expect(tally[409] ?? 0, detail).toBe(RACERS - 1);

    for (const refused of attempts.filter((attempt) => attempt.status === 409)) {
      expect(refused.body.error.code).toBe('PUNCH_OUT_OF_ORDER');
      expect(refused.body.error.details?.expected).toBe('OUT');
    }

    // The table, not the API, is the guarantee. Two INs on one attendance day
    // is the muster being wrong regardless of what any response said.
    const rows = await punchRows(racerEmployeeId);
    expect(rows.map((row) => row.type), JSON.stringify(rows)).toEqual(['IN']);
  }, 60_000);

  it('accepts exactly one of five simultaneous OUTs and refuses the rest', async () => {
    const opened = await preparePunch(outToken, `pc-open-${runId}`)();
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);

    // An OUT now falls outside the shift's out window, and the org default is
    // ALLOW_WITH_REASON, so every racer carries a reason -- otherwise they
    // would all be refused 422 and the race would never reach the guard.
    const fire = Array.from({ length: RACERS }, (_, i) =>
      preparePunch(outToken, `pc-out-${String(i)}-${runId}`, {
        type: 'OUT',
        reason: 'Racing the ordering guard on the way out.',
      }),
    );

    const attempts = await Promise.all(fire.map((send) => send()));
    const tally = statusTally(attempts);
    const detail = JSON.stringify({ tally, codes: attempts.map((a) => a.body.error?.code ?? 'ok') });

    expect(tally[201] ?? 0, detail).toBe(1);
    expect(tally[409] ?? 0, detail).toBe(RACERS - 1);

    const rows = await punchRows(outEmployeeId);
    expect(rows.map((row) => row.type), JSON.stringify(rows)).toEqual(['IN', 'OUT']);
  }, 60_000);

  it('still replays a repeated Idempotency-Key rather than refusing it (REQ-D-11)', async () => {
    const key = `pc-replay-${runId}`;

    const first = await preparePunch(replayToken, key)();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.replayed).toBe(false);

    // The same key again is the retry a phone on one bar makes. It must come
    // back 200 with the original punch -- not the 409 the ordering guard would
    // give it, since an IN is now open.
    const again = await preparePunch(replayToken, key)();
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.punch.id).toBe(first.body.punch.id);

    const rows = await punchRows(replayEmployeeId);
    expect(rows).toHaveLength(1);
  }, 60_000);

  it('lets two different employees punch at the same instant', async () => {
    // Both must be accepted. This alone would still pass if the lock were
    // global -- the two would simply queue -- so the scope itself is asserted
    // separately, below.
    const fire = [
      preparePunch(soloAToken, `pc-solo-a-${runId}`),
      preparePunch(soloBToken, `pc-solo-b-${runId}`),
    ];

    const attempts = await Promise.all(fire.map((send) => send()));
    expect(attempts.map((attempt) => attempt.status), JSON.stringify(attempts.map((a) => a.body))).toEqual([
      201, 201,
    ]);

    expect((await punchRows(soloAEmployeeId)).map((row) => row.type)).toEqual(['IN']);
    expect((await punchRows(soloBEmployeeId)).map((row) => row.type)).toEqual(['IN']);
  }, 60_000);
});

describe('the ordering lock is scoped to one employee', () => {
  /**
   * "Two employees are not refused" is not the same claim as "two employees do
   * not queue behind each other", and only the second one is the requirement --
   * everybody in the office punches within the same few minutes, so a lock
   * taken on anything coarser than the employee would serialise the entire
   * workforce at 09:00 and nothing above would notice.
   *
   * `pg_try_advisory_xact_lock` answers it without a stopwatch: it returns
   * false instead of blocking, so a second connection can ask "is this key
   * taken?" and get a definite answer either way. The lock under test is taken
   * by the real `withPunchOrderingLock`, and the namespace is imported rather
   * than retyped, so a change to either cannot leave this test agreeing with
   * something the server no longer does.
   */
  it('holds the key of the employee punching and no other', async () => {
    const repository = new PunchRepository(harness.db, {
      orgId: ORG_ID,
      actorUserId: null,
    });

    const probes = await repository.withPunchOrderingLock(soloAEmployeeId, async () => {
      const ask = async (employeeId: string): Promise<boolean> => {
        // A separate transaction, and therefore a separate pooled connection:
        // asking on the connection that already holds the lock would always
        // say yes, advisory locks being re-entrant within a session.
        const rows = await harness.db.transaction(async (tx) =>
          tx.execute<{ taken: boolean }>(
            sql`SELECT pg_try_advisory_xact_lock(${PUNCH_ORDERING_LOCK_NAMESPACE}, hashtext(${employeeId})) AS taken`,
          ),
        );
        return rows.rows[0]?.taken === true;
      };

      return {
        sameEmployee: await ask(soloAEmployeeId),
        otherEmployee: await ask(soloBEmployeeId),
      };
    });

    // Refused for the employee whose punch is in flight...
    expect(probes.sameEmployee).toBe(false);
    // ...and freely available for anybody else.
    expect(probes.otherEmployee).toBe(true);
  }, 30_000);
});

describe('the ordering guard is still correct in sequence', () => {
  it('counts one punch per employee for every row this file wrote', async () => {
    // A lock that refused everything would pass every assertion above except
    // this one: five employees, five distinct people, and the totals the
    // individual tests expect.
    const rows = await harness.db
      .select({ employeeId: punches.employeeId, value: sql<number>`count(*)::int` })
      .from(punches)
      .where(eq(punches.orgId, ORG_ID))
      .groupBy(punches.employeeId);

    const byEmployee = new Map(rows.map((row) => [row.employeeId, row.value]));
    expect(byEmployee.get(racerEmployeeId)).toBe(1);
    expect(byEmployee.get(outEmployeeId)).toBe(2);
    expect(byEmployee.get(replayEmployeeId)).toBe(1);
    expect(byEmployee.get(soloAEmployeeId)).toBe(1);
    expect(byEmployee.get(soloBEmployeeId)).toBe(1);
  });
});
