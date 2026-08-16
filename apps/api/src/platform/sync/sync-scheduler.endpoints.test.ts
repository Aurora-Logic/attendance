import { SYSTEM_ROLES } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import { SyncSchedulerService } from './sync-scheduler.service.js';

/**
 * REQ-R-07: pull work exists on a schedule and on demand — and never piles
 * up. The property under test is the one-open-job invariant: however many
 * sweeps run and however many times the button is pressed, a connection
 * holds at most one open pull job per entity type, because the schema says
 * so and the enqueue only ever tries.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000be';

let harness: ApiHarness;
let scheduler: SyncSchedulerService;
let adminToken: string;
let employeeToken: string;

/** Bound + token issued: the sweep should enqueue for this one. */
let eligibleId = '';
/** No company GUID: enqueuing would create work whose refusal is known. */
let unboundId = '';

async function openJobCount(connectionId: string): Promise<number> {
  const rows = await harness.db.execute<{ count: string }>(sql`
    SELECT count(*) AS count FROM sync_jobs
     WHERE connection_id = ${connectionId} AND state IN ('QUEUED', 'CLAIMED')
  `);
  return Number(rows.rows[0]?.count ?? 0);
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Sync Scheduler Fixture Org');
  scheduler = harness.resolve(SyncSchedulerService);

  // Same reasoning as the agent suite: jobs and cursors are this file's own
  // to delete; connections soft-delete so a future journal row cannot wedge
  // the cleanup.
  await harness.db.execute(sql`DELETE FROM sync_jobs WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM sync_cursors WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(
    sql`UPDATE integration_connections SET deleted_at = now() WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`,
  );

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE, { isSystem: true });
  const admin = await harness.createUser({ email: scopedEmail('sched-admin'), roleIds: [adminRoleId] });
  const employee = await harness.createUser({
    email: scopedEmail('sched-employee'),
    roleIds: [employeeRoleId],
  });
  adminToken = (await harness.login(admin.email, admin.password)).token;
  employeeToken = (await harness.login(employee.email, employee.password)).token;

  const inserted = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO integration_connections (org_id, system, name, company_guid, agent_token_hash)
    VALUES (${ORG_ID}, 'TALLY', 'Eligible Co', 'guid-eligible', 'hash-of-a-token')
    RETURNING id
  `);
  eligibleId = inserted.rows[0]?.id ?? '';

  const unbound = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO integration_connections (org_id, system, name, agent_token_hash)
    VALUES (${ORG_ID}, 'TALLY', 'Unbound Co', 'hash-of-another-token')
    RETURNING id
  `);
  unboundId = unbound.rows[0]?.id ?? '';
});

afterAll(async () => {
  await harness.close();
});

describe('the fifteen-minute sweep (REQ-R-07)', () => {
  it('enqueues one pull per eligible connection and skips the ineligible', async () => {
    await scheduler.enqueueDuePulls();

    expect(await openJobCount(eligibleId)).toBe(1);
    // Unbound: the claim path would refuse this connection's jobs anyway,
    // so the sweep does not create them.
    expect(await openJobCount(unboundId)).toBe(0);
  });

  it('a second sweep adds nothing while the job is open', async () => {
    const outcome = await scheduler.enqueueDuePulls();
    // Other tenants' connections may legitimately be enqueued by this sweep;
    // what must hold is this connection's count, guarded by the schema.
    expect(outcome.enqueued).toBeGreaterThanOrEqual(0);
    expect(await openJobCount(eligibleId)).toBe(1);
  });

  it('requeues a claim whose agent went silent, and fails one past the attempt cap', async () => {
    // A stale claim wedges the queue forever without this: CLAIMED counts as
    // open, so the sweep could never replace it. Older than the takeover
    // threshold means the claiming agent has been silent past the point a
    // rival may seize its lease.
    await harness.db.execute(sql`
      UPDATE sync_jobs SET state = 'CLAIMED', claimed_by = 'dead-instance',
             claimed_at = now() - interval '6 minutes', attempts = 1
       WHERE connection_id = ${eligibleId} AND state = 'QUEUED'
    `);
    const outcome = await scheduler.enqueueDuePulls();
    expect(outcome.requeued).toBeGreaterThanOrEqual(1);
    const requeued = await harness.db.execute<{ state: string; claimed_by: string | null }>(sql`
      SELECT state, claimed_by FROM sync_jobs
       WHERE connection_id = ${eligibleId} AND state IN ('QUEUED', 'CLAIMED')
    `);
    expect(requeued.rows[0]?.state).toBe('QUEUED');
    expect(requeued.rows[0]?.claimed_by).toBeNull();

    // Five failed claims is a diagnosis, not bad luck: the job fails
    // visibly instead of cycling.
    await harness.db.execute(sql`
      UPDATE sync_jobs SET state = 'CLAIMED', claimed_by = 'dead-instance',
             claimed_at = now() - interval '6 minutes', attempts = 5
       WHERE connection_id = ${eligibleId} AND state = 'QUEUED'
    `);
    const second = await scheduler.enqueueDuePulls();
    expect(second.failed).toBeGreaterThanOrEqual(1);
    // And the freed slot is refilled in the same sweep.
    expect(await openJobCount(eligibleId)).toBe(1);
  });

  it('a completed job makes room for the next sweep', async () => {
    await harness.db.execute(sql`
      UPDATE sync_jobs SET state = 'DONE', updated_at = now()
       WHERE connection_id = ${eligibleId} AND state = 'QUEUED'
    `);
    await scheduler.enqueueDuePulls();
    expect(await openJobCount(eligibleId)).toBe(1);
  });
});

describe('the manual pull (POST /integrations/:id/pull)', () => {
  it('is admin-only', async () => {
    const refused = await harness.post(`/integrations/${eligibleId}/pull`, {
      token: employeeToken,
      body: { entityType: 'party' },
    });
    expect(refused.status).toBe(403);
  });

  it('answers the open job rather than erroring on a second press', async () => {
    const first = await harness.post<{ jobId: string; alreadyQueued: boolean }>(
      `/integrations/${eligibleId}/pull`,
      { token: adminToken, body: { entityType: 'party' } },
    );
    expect(first.status).toBe(202);
    // The sweep above already has one open; the press finds it.
    expect(first.body.alreadyQueued).toBe(true);

    const second = await harness.post<{ jobId: string; alreadyQueued: boolean }>(
      `/integrations/${eligibleId}/pull`,
      { token: adminToken, body: { entityType: 'party' } },
    );
    expect(second.body.jobId).toBe(first.body.jobId);
    expect(await openJobCount(eligibleId)).toBe(1);
  });

  it('refuses an entity type that has no writer yet, naming the reason', async () => {
    const response = await harness.post<{ error: { message: string } }>(
      `/integrations/${eligibleId}/pull`,
      { token: adminToken, body: { entityType: 'stock_item' } },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('cannot pull');
  });

  it('refuses a connection that could never be claimed', async () => {
    const response = await harness.post<{ error: { message: string } }>(
      `/integrations/${unboundId}/pull`,
      { token: adminToken, body: { entityType: 'party' } },
    );
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('bound to a Tally company');
  });
});
