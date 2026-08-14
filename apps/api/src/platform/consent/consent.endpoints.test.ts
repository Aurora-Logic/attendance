import { SYSTEM_ROLES, type ConsentAcceptance, type PunchContext } from '@vyuha/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consentAcceptances } from '../db/schema/index.js';
import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * `POST /me/consent` (REQ-M-03) over real HTTP against the real application:
 * guard, Zod pipe, the partial unique index and the audit interceptor all in
 * the loop -- plus the half of the requirement that lives on `GET /me/today`,
 * which is where the recorded acceptance stops the notice reappearing.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000f1';
const PUNCH_CONSENT_KEY = 'attendance.punch_capture';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let harness: ApiHarness;
let employeeToken: string;
let employeeUserId: string;
let roleLessToken: string;
let roleLessUserId: string;

async function countAcceptances(userId: string): Promise<number> {
  const rows = await harness.db
    .select({ id: consentAcceptances.id })
    .from(consentAcceptances)
    .where(and(eq(consentAcceptances.orgId, ORG_ID), eq(consentAcceptances.userId, userId)));
  return rows.length;
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Consent Endpoints Fixture Org');

  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);
  const employeeId = await harness.createEmployee({ code: 'CN-A', firstName: 'Chitra' });

  const employeeUser = await harness.createUser({
    email: scopedEmail('consent-emp'),
    roleIds: [employeeRoleId],
    employeeId,
  });
  employeeUserId = employeeUser.id;
  // No roles at all: consent is an act of the account on itself, so holding
  // no permission key must not block it.
  const roleLess = await harness.createUser({ email: scopedEmail('consent-none') });
  roleLessUserId = roleLess.id;

  employeeToken = (await harness.login(employeeUser.email, employeeUser.password)).token;
  roleLessToken = (await harness.login(roleLess.email, roleLess.password)).token;
  expect([employeeToken, roleLessToken].every((token) => token !== '')).toBe(true);
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('POST /me/consent (REQ-M-03)', () => {
  it('refuses an unauthenticated request', async () => {
    const result = await harness.post('/me/consent', {
      body: { consentKey: PUNCH_CONSENT_KEY },
    });
    expect(result.status).toBe(401);
  });

  it('refuses a notice that is not in the catalogue', async () => {
    const result = await harness.post<ErrorBody>('/me/consent', {
      token: employeeToken,
      body: { consentKey: 'attendance.nonexistent_notice' },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('gates the punch screen until accepted, then stops (REQ-M-03)', async () => {
    const before = await harness.get<PunchContext>('/me/today', { token: employeeToken });
    expect(before.status, before.text).toBe(200);
    expect(before.body.consentAccepted).toBe(false);
    // REQ-M-03 wants the notice to state the retention period, so the context
    // carries the number the pipeline actually enforces (default 12 months).
    expect(before.body.photoRetentionMonths).toBe(12);

    const accepted = await harness.post<ConsentAcceptance>('/me/consent', {
      token: employeeToken,
      body: { consentKey: PUNCH_CONSENT_KEY },
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.replayed).toBe(false);
    expect(new Date(accepted.body.acceptedAt).getTime()).not.toBeNaN();

    // Migration 0013: the row records what was promised, not just that
    // something was -- the wording revision and the retention period the
    // notice quoted (the default 12, since no org setting is installed).
    const stamped = await harness.db
      .select({
        noticeVersion: consentAcceptances.noticeVersion,
        retentionMonthsQuoted: consentAcceptances.retentionMonthsQuoted,
      })
      .from(consentAcceptances)
      .where(
        and(eq(consentAcceptances.orgId, ORG_ID), eq(consentAcceptances.userId, employeeUserId)),
      );
    expect(stamped[0]?.noticeVersion).toBe(1);
    expect(stamped[0]?.retentionMonthsQuoted).toBe(12);

    // The context is what the screen reads on its next visit, so this is the
    // notice actually stopping, not a claim that it would.
    const after = await harness.get<PunchContext>('/me/today', { token: employeeToken });
    expect(after.status).toBe(200);
    expect(after.body.consentAccepted).toBe(true);
  });

  it('replays a second acceptance instead of recording twice', async () => {
    const replay = await harness.post<ConsentAcceptance>('/me/consent', {
      token: employeeToken,
      body: { consentKey: PUNCH_CONSENT_KEY },
    });

    // 200, not 201: nothing was created the second time, and the instant
    // answered is the original acceptance, not this call.
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
  });

  it('accepts for an account holding no permission key at all', async () => {
    const result = await harness.post<ConsentAcceptance>('/me/consent', {
      token: roleLessToken,
      body: { consentKey: PUNCH_CONSENT_KEY },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(await countAcceptances(roleLessUserId)).toBe(1);
  });

  it('rejects an unknown extra field rather than silently discarding it', async () => {
    const result = await harness.post<ErrorBody>('/me/consent', {
      token: employeeToken,
      body: { consentKey: PUNCH_CONSENT_KEY, userId: roleLessUserId },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('audited the first acceptance and only the first (REQ-M-01)', async () => {
    // The audit write is deliberately async, so both rows are awaited rather
    // than queried the instant the responses returned -- see the note on
    // `waitForAuditAction`. Scoped to this run's two actors: `audit_logs` is
    // append-only, so an org-wide count would grow by two on every run.
    const count = async (): Promise<number> => {
      const rows = await harness.db.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM audit_logs
             WHERE org_id = ${ORG_ID} AND action = 'consent.accepted'
               AND actor_user_id IN (${employeeUserId}::uuid, ${roleLessUserId}::uuid)`,
      );
      return rows.rows[0]?.count ?? 0;
    };

    const deadline = Date.now() + 3_000;
    while ((await count()) < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    // Two users accepted once each; the replay must not have added a third.
    expect(await count()).toBe(2);
  });
});
