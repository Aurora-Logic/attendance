import { PERMISSIONS, SYSTEM_ROLES } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import {
  NotificationDispatcher,
  type NotificationEvent,
} from '../notifications/notification.dispatcher.js';
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

describe('the heartbeat staleness alert (REQ-Q-04)', () => {
  let staleId = '';
  const emitted: NotificationEvent[] = [];

  const staleEmits = () =>
    emitted.filter(
      (e) => e.type === 'sync.agent_stale' && e.payload?.connectionName === 'Stale Co',
    );

  beforeAll(async () => {
    // The spy replaces the BullMQ enqueue: what this suite owns is the edge
    // detection and who is addressed, not delivery — `notifications.test.ts`
    // owns that. Workers are disabled under vitest, so nothing else consumes
    // the transitions this fixture creates.
    const dispatcher = harness.resolve(NotificationDispatcher);
    vi.spyOn(dispatcher, 'emit').mockImplementation((event) => {
      emitted.push(event);
      return Promise.resolve('spied');
    });

    const inserted = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO integration_connections
        (org_id, system, name, company_guid, agent_token_hash, last_heartbeat_at)
      VALUES (${ORG_ID}, 'TALLY', 'Stale Co', 'guid-stale', 'hash-of-stale-token',
              now() - interval '10 minutes')
      RETURNING id
    `);
    staleId = inserted.rows[0]?.id ?? '';
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('alerts on the transition to stale — once, however often the sweep runs', async () => {
    const first = await scheduler.checkHeartbeatStaleness();
    expect(first.wentStale).toBeGreaterThanOrEqual(1);
    expect(staleEmits().length).toBe(1);
    // The audience is the permission that guards the screen the alert opens.
    expect(staleEmits()[0]?.audience).toEqual({
      kind: 'permission',
      key: PERMISSIONS.INTEGRATION_MANAGE,
    });

    await scheduler.checkHeartbeatStaleness();
    expect(staleEmits().length).toBe(1);

    const row = await harness.db.execute<{ stale_notified_at: Date | null }>(sql`
      SELECT stale_notified_at FROM integration_connections WHERE id = ${staleId}
    `);
    expect(row.rows[0]?.stale_notified_at).not.toBeNull();
  });

  it('announces recovery, re-arms, and treats the next silence as a new fact', async () => {
    await harness.db.execute(sql`
      UPDATE integration_connections SET last_heartbeat_at = now() WHERE id = ${staleId}
    `);
    const outcome = await scheduler.checkHeartbeatStaleness();
    expect(outcome.recovered).toBeGreaterThanOrEqual(1);
    const recoveries = emitted.filter(
      (e) => e.type === 'sync.agent_recovered' && e.payload?.connectionName === 'Stale Co',
    );
    expect(recoveries.length).toBe(1);

    await harness.db.execute(sql`
      UPDATE integration_connections SET last_heartbeat_at = now() - interval '10 minutes'
       WHERE id = ${staleId}
    `);
    await scheduler.checkHeartbeatStaleness();
    expect(staleEmits().length).toBe(2);
  });

  it('says nothing about a connection that never heartbeated', () => {
    // DISCONNECTED-from-birth is the Integrations screen's business; the
    // sweep is about an agent that was alive and stopped. The eligible and
    // unbound fixtures above have never beaten and must never be named.
    expect(
      emitted.some(
        (e) => e.payload?.connectionName === 'Eligible Co' || e.payload?.connectionName === 'Unbound Co',
      ),
    ).toBe(false);
  });
});
