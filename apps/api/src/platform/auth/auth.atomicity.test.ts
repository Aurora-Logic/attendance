import { SYSTEM_ROLES } from '@vyuha/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import { passwordResets, users } from '../db/schema/index.js';
import { JobRunner } from '../jobs/job-runner.service.js';

/**
 * The two controls on this path that are check-then-act, over real HTTP,
 * driven **concurrently**.
 *
 * Every one of these properties already had a sequential test, and every one
 * of those tests passed while the control was defeated by adding `&` to the
 * attacker's loop. That is the whole reason this file exists as its own: a
 * sequential burst never has two requests inside the gap between the check and
 * the write, so it can only ever measure the arithmetic, never the atomicity.
 *
 * Measured against the booted production build before the fix:
 *   - reset cap 3/address/hour: 25 sequential gave 3 emails; 25 concurrent
 *     gave 8 and 100 concurrent gave 59, with the sorted set left holding all
 *     59 -- recorded after they had been let through.
 *   - account lockout, 5/15min: 6 sequential advanced 1,2,3,4,5 and answered
 *     423 on the sixth; 25 concurrent left `failed_attempts = 2` and
 *     `locked_until` null, and 60 concurrent left it at 1.
 *   - per-IP login cap of 20: 60 concurrent produced sixty 401s, not one 429,
 *     and left 60 members in a window capped at 20.
 *
 * `Promise.all` over `fetch` is genuine concurrency here: the harness talks to
 * the app over a real socket, so all N requests are in flight in the server at
 * once rather than interleaved by a single client's await.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000b5';

/** REQ-B-04 and REQ-B-10 -- the caps the fixes have to hold to. */
const RESET_CAP_PER_ADDRESS = 3;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_FAILURES_PER_IP = 20;

let harness: ApiHarness;
let employeeRoleId: string;

interface ErrorBody {
  error: { code: string; message: string };
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Auth Atomicity Fixture Org');
  // The reset mail is delivered by a job, so without a worker nothing is ever
  // sent and "three emails" would pass for the wrong reason.
  harness.resolve(JobRunner).startWorkers();
  employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);
});

afterAll(async () => {
  await harness.close();
});

/** Fires `count` requests and waits for all of them, rather than each in turn. */
function burst<T>(count: number, run: () => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: count }, run));
}

/**
 * The reset rows once the count has stopped moving. A 202 means the job was
 * queued, so a count read the instant the last response lands is a count of
 * whichever jobs happen to have run already.
 */
async function settledResetRows(userId: string): Promise<number> {
  let previous = -1;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const rows = await harness.db
      .select({ id: passwordResets.id })
      .from(passwordResets)
      .where(eq(passwordResets.userId, userId));
    if (rows.length === previous) return rows.length;
    previous = rows.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return previous;
}

async function accountState(userId: string): Promise<{ attempts: number; locked: boolean }> {
  const rows = await harness.db
    .select({ failedAttempts: users.failedAttempts, lockedUntil: users.lockedUntil })
    .from(users)
    .where(eq(users.id, userId));
  const row = rows[0];
  if (row === undefined) throw new Error(`No user ${userId}`);
  return {
    attempts: row.failedAttempts,
    locked: row.lockedUntil !== null && row.lockedUntil.getTime() > Date.now(),
  };
}

describe('POST /auth/password-resets under a concurrent burst (REQ-B-04)', () => {
  it('sends the cap, not the burst, and still answers 202 to every request', async () => {
    const target = await harness.createUser({
      email: scopedEmail('atomic-reset-burst'),
      roleIds: [employeeRoleId],
    });

    const responses = await burst(60, () =>
      harness.post('/auth/password-resets', { body: { email: target.email } }),
    );

    // The silent-202 contract holds whatever the limiter decided: a 429 for a
    // throttled address and a 202 for a fresh one would turn the limiter into
    // the enumeration oracle the endpoint is shaped to avoid.
    expect(new Set(responses.map((response) => response.status))).toEqual(new Set([202]));

    expect(await settledResetRows(target.id)).toBe(RESET_CAP_PER_ADDRESS);

    const delivered = harness.mail.sent.filter(
      (mail) => mail.to.toLowerCase() === target.email.toLowerCase(),
    );
    expect(delivered).toHaveLength(RESET_CAP_PER_ADDRESS);
  });
});

describe('per-account lockout under a concurrent burst (REQ-B-10)', () => {
  it('spends one of the five attempts per concurrent failure', async () => {
    // Four, deliberately: one short of the cap, so the assertion is about the
    // count rather than about the lock. The read-modify-write left this at 1.
    await harness.clearLoginRateLimit();
    const victim = await harness.createUser({ email: scopedEmail('atomic-lock-count') });

    const responses = await burst(MAX_FAILED_ATTEMPTS - 1, () =>
      harness.post<ErrorBody>('/auth/login', {
        body: { email: victim.email, password: 'not-the-password-at-all' },
      }),
    );
    expect(responses.every((response) => response.status === 401)).toBe(true);

    expect(await accountState(victim.id)).toEqual({
      attempts: MAX_FAILED_ATTEMPTS - 1,
      locked: false,
    });
  });

  it('locks the account, once, when the burst reaches the cap', async () => {
    await harness.clearLoginRateLimit();
    const victim = await harness.createUser({ email: scopedEmail('atomic-lock-burst') });

    await burst(MAX_FAILED_ATTEMPTS, () =>
      harness.post('/auth/login', {
        body: { email: victim.email, password: 'still-not-the-password' },
      }),
    );

    const state = await accountState(victim.id);
    expect(state.attempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(state.locked).toBe(true);

    // ...and the correct password is refused now, which is what the lock is for.
    const afterwards = await harness.post<ErrorBody>('/auth/login', {
      body: { email: victim.email, password: victim.password },
    });
    expect(afterwards.status).toBe(423);
    expect(afterwards.body.error.code).toBe('ACCOUNT_LOCKED');

    // Exactly one notice and one trail entry. Locking on `>=` rather than on
    // the crossing would send the owner of the address one email per guess.
    expect(await harness.waitForAuditAction('auth.account_locked')).toBe(true);
    const audits = await harness.db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM audit_logs
          WHERE org_id = ${ORG_ID} AND action = 'auth.account_locked' AND entity_id = ${victim.id}`,
    );
    expect(Number(audits.rows[0]?.count ?? -1)).toBe(1);

    const notices = harness.mail.sent.filter(
      (mail) => mail.to.toLowerCase() === victim.email.toLowerCase(),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.subject).toContain('locked');
  });
});

describe('per-IP login budget under a concurrent burst (REQ-B-10)', () => {
  it('refuses everything past the budget instead of letting the burst through', async () => {
    await harness.clearLoginRateLimit();
    const victim = await harness.createUser({ email: scopedEmail('atomic-ip-burst') });

    const attempts = 60;
    const responses = await burst(attempts, () =>
      harness.post<ErrorBody>('/auth/login', {
        body: { email: victim.email, password: 'wrong-from-one-address' },
      }),
    );

    const rateLimited = responses.filter((response) => response.status === 429);
    const reachedTheAccount = responses.filter((response) => response.status !== 429);

    expect(reachedTheAccount).toHaveLength(MAX_FAILURES_PER_IP);
    expect(rateLimited).toHaveLength(attempts - MAX_FAILURES_PER_IP);
    expect(rateLimited[0]?.body.error.code).toBe('RATE_LIMITED');

    // Left over budget, so a follow-up from the same address is refused too.
    const next = await harness.post<ErrorBody>('/auth/login', {
      body: { email: victim.email, password: victim.password },
    });
    expect(next.status).toBe(429);
  });

  it('lets a whole office in at once, because a success costs nothing at rest', async () => {
    // The other half of the trade. The slot is claimed before the password is
    // checked, so a *successful* sign-in holds one for the length of the
    // request -- and everyone in this product shares one office NAT and
    // arrives within the same few minutes (ADR 0002). A cap that refused them
    // would be a denial of service the product inflicts on itself, which is
    // the reason the window counts only failures at rest.
    await harness.clearLoginRateLimit();
    const staff = await Promise.all(
      Array.from({ length: MAX_FAILURES_PER_IP }, (_unused, i) =>
        harness.createUser({ email: scopedEmail(`atomic-office-${String(i)}`) }),
      ),
    );

    const responses = await Promise.all(
      staff.map((person) =>
        harness.post('/auth/login', { body: { email: person.email, password: person.password } }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      MAX_FAILURES_PER_IP,
    );
  });
});
