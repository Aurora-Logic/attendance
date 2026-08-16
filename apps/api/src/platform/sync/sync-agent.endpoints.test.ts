import { randomUUID } from 'node:crypto';

import {
  SYSTEM_ROLES,
  type AgentClaimResponse,
  type AgentHeartbeatAck,
  type AgentResultsAck,
  type IntegrationListResponse,
  type IssuedAgentToken,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * The agent surface, over real HTTP (REQ-Q-02 … Q-05, 09 §3.4 and §5).
 *
 * The assertions that matter most are the crossings that must fail: a user
 * JWT on an agent route, an agent token on a user route, a second agent on a
 * held lease, a claim for a company Tally does not have open, and one
 * connection's credential reaching another connection's queue. The 6b exit
 * gate says an agent credential must not read anything beyond its own
 * connection; this file is where that is exercised from the refusing side.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000bd';

let harness: ApiHarness;
let adminToken: string;
let employeeToken: string;

let connectionId = '';
let agentToken = '';

const AGENT_A = 'agent-instance-aaaa';
const AGENT_B = 'agent-instance-bbbb';
const COMPANY_GUID = 'guid-gcc-2026-27';

function agentPost<T>(path: string, token: string, body: Record<string, unknown>) {
  // The harness's own token option, so agent requests wear credentials the
  // same way every other suite's do.
  return harness.post<T>(path, { token, body });
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Sync Agent Fixture Org');

  // The harness resets people and roles; the sync fixtures are this file's
  // own to reset, or the unique connection name refuses on every run after
  // the first and everything downstream cascades. Jobs and cursors are
  // deletable; connections are soft-deleted, not removed -- the journal is
  // append-only and references them RESTRICT, so the first journal row this
  // org ever gains would make a hard DELETE here fail forever. The partial
  // unique indexes only bind living rows, so soft-deleting frees the names
  // and company GUIDs for the next run.
  await harness.db.execute(sql`DELETE FROM sync_jobs WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM sync_cursors WHERE org_id = ${ORG_ID}`);
  // The projection and its mappings must go too, and hard: a previous run's
  // parties would satisfy this run's list assertions with the wrong rows, and
  // its orphaned external_refs (owned by connections the line below buried)
  // would be adopted by this run's writer -- correctly, that is the writer's
  // replaced-connection rule -- carrying stale names into the count.
  await harness.db.execute(sql`DELETE FROM external_refs WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM parties WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(
    sql`UPDATE integration_connections SET deleted_at = now() WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`,
  );

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE, { isSystem: true });

  const admin = await harness.createUser({
    email: scopedEmail('sync-admin'),
    roleIds: [adminRoleId],
  });
  const employee = await harness.createUser({
    email: scopedEmail('sync-employee'),
    roleIds: [employeeRoleId],
  });

  adminToken = (await harness.login(admin.email, admin.password)).token;
  employeeToken = (await harness.login(employee.email, employee.password)).token;
});

afterAll(async () => {
  await harness.close();
});

describe('connection creation and token issuance', () => {
  it('creates a connection, admin-only', async () => {
    const refused = await harness.post('/integrations', {
      token: employeeToken,
      body: { name: 'GCC 2026-27' },
    });
    expect(refused.status).toBe(403);

    const created = await harness.post<{ id: string; tokenIssued: boolean }>('/integrations', {
      token: adminToken,
      body: { name: 'GCC 2026-27', companyName: 'G C Communication 2026-27' },
    });
    expect(created.status).toBe(201);
    expect(created.body.tokenIssued).toBe(false);
    connectionId = created.body.id;
  });

  it('issues the token once, in the response and nowhere else', async () => {
    const issued = await harness.post<IssuedAgentToken>(`/integrations/${connectionId}/token`, {
      token: adminToken,
    });
    expect(issued.status).toBe(200);
    expect(issued.body.token.startsWith('vyagt_')).toBe(true);
    agentToken = issued.body.token;

    const list = await harness.get<IntegrationListResponse>('/integrations', {
      token: adminToken,
    });
    const row = list.body.data.find((c) => c.id === connectionId);
    expect(row?.tokenIssued).toBe(true);
    // The credential must not appear anywhere in any user-facing payload.
    expect(JSON.stringify(list.body)).not.toContain(agentToken.slice(6));
  });
});

describe('the two credential worlds never meet', () => {
  it('refuses a user JWT on an agent route', async () => {
    const response = await agentPost('/sync/agent/heartbeat', adminToken, {
      agentInstanceId: AGENT_A,
      agentVersion: '0.1.0',
    });
    expect(response.status).toBe(401);
  });

  it('refuses an agent token on a user route', async () => {
    const response = await harness.get('/integrations', { token: agentToken });
    expect(response.status).toBe(401);
  });

  it('refuses a token nobody issued', async () => {
    const response = await agentPost('/sync/agent/heartbeat', `vyagt_${'0'.repeat(48)}`, {
      agentInstanceId: AGENT_A,
      agentVersion: '0.1.0',
    });
    expect(response.status).toBe(401);
  });
});

describe('heartbeat and the lease (REQ-Q-04, 09 §3.4)', () => {
  it('first heartbeat takes the lease and the connection reports CONNECTED', async () => {
    const response = await agentPost<AgentHeartbeatAck>('/sync/agent/heartbeat', agentToken, {
      agentInstanceId: AGENT_A,
      agentVersion: '0.1.0',
      tallyVersion: 'TallyPrime 5.0',
    });
    expect(response.status).toBe(200);
    expect(response.body.condition).toBe('OK');

    const list = await harness.get<IntegrationListResponse>('/integrations', {
      token: adminToken,
    });
    expect(list.body.data.find((c) => c.id === connectionId)?.status).toBe('CONNECTED');
  });

  it('refuses a second instance while the lease is warm', async () => {
    const response = await agentPost('/sync/agent/heartbeat', agentToken, {
      agentInstanceId: AGENT_B,
      agentVersion: '0.1.0',
    });
    expect(response.status).toBe(409);
  });

  it('lets a rival take over once the holder has been silent past the threshold', async () => {
    await harness.db.execute(sql`
      UPDATE integration_connections
         SET last_heartbeat_at = now() - interval '6 minutes'
       WHERE id = ${connectionId}
    `);

    const takeover = await agentPost<AgentHeartbeatAck>('/sync/agent/heartbeat', agentToken, {
      agentInstanceId: AGENT_B,
      agentVersion: '0.1.0',
    });
    expect(takeover.status).toBe(200);
    expect(takeover.body.condition).toBe('OK');

    // A takes it back the same way for the claim tests below.
    await harness.db.execute(sql`
      UPDATE integration_connections
         SET last_heartbeat_at = now() - interval '6 minutes'
       WHERE id = ${connectionId}
    `);
    const back = await agentPost<AgentHeartbeatAck>('/sync/agent/heartbeat', agentToken, {
      agentInstanceId: AGENT_A,
      agentVersion: '0.1.0',
    });
    expect(back.status).toBe(200);
  });
});

describe('claiming work (REQ-Q-02, 09 §7)', () => {
  it('refuses a claim from an instance that does not hold the lease', async () => {
    const response = await agentPost('/sync/agent/jobs/claim', agentToken, {
      agentInstanceId: AGENT_B,
      openCompanyGuid: COMPANY_GUID,
    });
    expect(response.status).toBe(409);
  });

  it('refuses every claim until the connection is bound to a company', async () => {
    const response = await agentPost<{ error: { message: string } }>(
      '/sync/agent/jobs/claim',
      agentToken,
      { agentInstanceId: AGENT_A, openCompanyGuid: COMPANY_GUID },
    );
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('not yet bound');
  });

  it('refuses a claim when Tally has the wrong company open, naming the rule', async () => {
    await harness.db.execute(sql`
      UPDATE integration_connections SET company_guid = ${COMPANY_GUID} WHERE id = ${connectionId}
    `);

    const response = await agentPost<{ error: { message: string } }>(
      '/sync/agent/jobs/claim',
      agentToken,
      { agentInstanceId: AGENT_A, openCompanyGuid: 'guid-some-other-company' },
    );
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('wrong books');
  });

  it('answers an empty queue with null, not an error', async () => {
    const response = await agentPost<AgentClaimResponse>('/sync/agent/jobs/claim', agentToken, {
      agentInstanceId: AGENT_A,
      openCompanyGuid: COMPANY_GUID,
    });
    expect(response.status).toBe(200);
    expect(response.body.job).toBeNull();
  });

  it('claims the oldest queued job exactly once', async () => {
    // Close whatever is open first: the one-open-job index (0022) refuses a
    // second open pull per entity type, and the sweep may legitimately have
    // enqueued one for this connection already.
    await harness.db.execute(sql`
      UPDATE sync_jobs SET state = 'DONE', updated_at = now()
       WHERE connection_id = ${connectionId} AND state IN ('QUEUED', 'CLAIMED')
    `);
    await harness.db.execute(sql`
      INSERT INTO sync_jobs (org_id, connection_id, direction, entity_type, payload)
      VALUES (${ORG_ID}, ${connectionId}, 'PULL', 'party', '{"sinceAlterId": 0}'::jsonb)
    `);

    const first = await agentPost<AgentClaimResponse>('/sync/agent/jobs/claim', agentToken, {
      agentInstanceId: AGENT_A,
      openCompanyGuid: COMPANY_GUID,
    });
    expect(first.body.job?.entityType).toBe('party');
    expect(first.body.job?.attempts).toBe(1);

    const second = await agentPost<AgentClaimResponse>('/sync/agent/jobs/claim', agentToken, {
      agentInstanceId: AGENT_A,
      openCompanyGuid: COMPANY_GUID,
    });
    expect(second.body.job).toBeNull();
  });

  it("cannot reach another connection's queue with this connection's credential", async () => {
    // A second connection with its own queued job. The credential resolves to
    // connection A, so B's job must be invisible however the request is
    // shaped -- the connection id never travels in the body at all.
    const otherId = randomUUID();
    // Its own company GUID: REQ-Q-03 is now held by a unique index, so two
    // live connections cannot share one company at all.
    await harness.db.execute(sql`
      INSERT INTO integration_connections (id, org_id, system, name, company_guid)
      VALUES (${otherId}, ${ORG_ID}, 'TALLY', 'Other Company', 'guid-other-company')
    `);
    await harness.db.execute(sql`
      INSERT INTO sync_jobs (org_id, connection_id, direction, entity_type)
      VALUES (${ORG_ID}, ${otherId}, 'PULL', 'stock_item')
    `);

    const response = await agentPost<AgentClaimResponse>('/sync/agent/jobs/claim', agentToken, {
      agentInstanceId: AGENT_A,
      openCompanyGuid: COMPANY_GUID,
    });
    expect(response.body.job).toBeNull();
  });
});

describe('the server derives the wrong-company condition (REQ-Q-05)', () => {
  it('a confused agent reporting OK with the wrong books open is recorded as WRONG_COMPANY_OPEN', async () => {
    const response = await agentPost<AgentHeartbeatAck>('/sync/agent/heartbeat', agentToken, {
      agentInstanceId: AGENT_A,
      agentVersion: '0.1.0',
      condition: 'OK',
      openCompanyGuid: 'guid-not-the-bound-one',
    });
    expect(response.status).toBe(200);
    expect(response.body.condition).toBe('WRONG_COMPANY_OPEN');

    const list = await harness.get<IntegrationListResponse>('/integrations', {
      token: adminToken,
    });
    const row = list.body.data.find((c) => c.id === connectionId);
    expect(row?.status).toBe('ERROR');
    expect(row?.lastCondition).toBe('WRONG_COMPANY_OPEN');

    // A correct heartbeat clears it, so the screen tracks the live truth.
    const recovered = await agentPost<AgentHeartbeatAck>('/sync/agent/heartbeat', agentToken, {
      agentInstanceId: AGENT_A,
      agentVersion: '0.1.0',
      openCompanyGuid: COMPANY_GUID,
    });
    expect(recovered.body.condition).toBe('OK');
  });
});

describe('rotation revokes', () => {
  it('the old token dies, and the lease dies with it', async () => {
    const reissued = await harness.post<IssuedAgentToken>(
      `/integrations/${connectionId}/token`,
      { token: adminToken },
    );
    expect(reissued.status).toBe(200);
    expect(reissued.body.token).not.toBe(agentToken);

    const stale = await agentPost('/sync/agent/heartbeat', agentToken, {
      agentInstanceId: AGENT_A,
      agentVersion: '0.1.0',
    });
    expect(stale.status).toBe(401);

    // A brand-new instance with the new credential connects immediately: the
    // deposed holder's lease must not block its replacement for the takeover
    // window, because rotation exists precisely to move the agent.
    const fresh = await agentPost<AgentHeartbeatAck>('/sync/agent/heartbeat', reissued.body.token, {
      agentInstanceId: 'agent-instance-cccc',
      agentVersion: '0.2.0',
    });
    expect(fresh.status).toBe(200);
  });
});

describe('pull results become the projection (09 §3.2, REQ-R-01, REQ-T-03)', () => {
  // The rotation test above retired the old credential and freed the lease,
  // so this block starts its own epoch: fresh token, fresh instance, fresh
  // queued job. That independence is deliberate — these tests must not
  // depend on which instance happened to win earlier scuffles.
  const AGENT_D = 'agent-instance-dddd';
  let epochToken = '';
  let resultsJobId = '';

  const chunk = (final: boolean, rows: unknown[], hashes = 'sha256:req1|sha256:res1') => ({
    agentInstanceId: AGENT_D,
    openCompanyGuid: COMPANY_GUID,
    jobId: resultsJobId,
    entityType: 'party',
    rows,
    requestHash: hashes.split('|')[0],
    responseHash: hashes.split('|')[1],
    final,
  });

  const ashaRow = {
    guid: 'party-guid-asha',
    alterId: 101,
    name: 'Asha Traders',
    parentGroup: 'Sundry Debtors',
    gstin: '27AAAPL1234C1ZV',
    creditLimit: '250000.00',
    creditDays: 30,
    openingBalance: '-12345.67',
  };
  const beharRow = {
    guid: 'party-guid-behar',
    alterId: 99,
    name: 'Behar Supply Co',
    parentGroup: 'Sundry Creditors',
  };

  it('sets up its epoch: rotated token, fresh lease, one queued job', async () => {
    const reissued = await harness.post<IssuedAgentToken>(
      `/integrations/${connectionId}/token`,
      { token: adminToken },
    );
    epochToken = reissued.body.token;

    const hb = await agentPost<AgentHeartbeatAck>('/sync/agent/heartbeat', epochToken, {
      agentInstanceId: AGENT_D,
      agentVersion: '0.1.0',
      openCompanyGuid: COMPANY_GUID,
    });
    expect(hb.status).toBe(200);

    // Same closing move as the claim tests: the epoch owns its queue.
    await harness.db.execute(sql`
      UPDATE sync_jobs SET state = 'DONE', updated_at = now()
       WHERE connection_id = ${connectionId} AND state IN ('QUEUED', 'CLAIMED')
    `);
    await harness.db.execute(sql`
      INSERT INTO sync_jobs (org_id, connection_id, direction, entity_type)
      VALUES (${ORG_ID}, ${connectionId}, 'PULL', 'party')
    `);
    const claim = await agentPost<AgentClaimResponse>('/sync/agent/jobs/claim', epochToken, {
      agentInstanceId: AGENT_D,
      openCompanyGuid: COMPANY_GUID,
    });
    expect(claim.body.job?.entityType).toBe('party');
    resultsJobId = claim.body.job?.id ?? '';
    expect(resultsJobId).not.toBe('');
  });

  it('ingests a chunk: rows land to the paisa, cursor advances, job stays claimed', async () => {
    const response = await agentPost<AgentResultsAck>('/sync/agent/results', epochToken, chunk(false, [ashaRow, beharRow]));
    expect(response.status).toBe(200);
    expect(response.body.written).toBe(2);
    expect(response.body.lastAlterId).toBe(101);
    expect(response.body.jobState).toBe('CLAIMED');

    const stored = await harness.db.execute<{ name: string; credit_limit: string | null; opening_balance: string | null }>(sql`
      SELECT name, credit_limit, opening_balance FROM parties
       WHERE org_id = ${ORG_ID} ORDER BY name
    `);
    expect(stored.rows.map((r) => r.name)).toEqual(['Asha Traders', 'Behar Supply Co']);
    // numeric, not float: the projection holds Tally's figure exactly (D-01).
    expect(stored.rows[0]?.credit_limit).toBe('250000.00');
    expect(stored.rows[0]?.opening_balance).toBe('-12345.67');
  });

  it('a re-posted chunk upserts the same GUIDs — the retry is safe by construction', async () => {
    const response = await agentPost<AgentResultsAck>('/sync/agent/results', epochToken, chunk(false, [ashaRow, beharRow]));
    expect(response.status).toBe(200);

    const count = await harness.db.execute<{ count: string }>(sql`
      SELECT count(*) AS count FROM parties WHERE org_id = ${ORG_ID}
    `);
    expect(Number(count.rows[0]?.count)).toBe(2);
  });

  it('Tally wins on the final chunk: rename lands, cursor is the new max, job completes', async () => {
    const renamed = { ...ashaRow, alterId: 150, name: 'Asha Trading Company' };
    const response = await agentPost<AgentResultsAck>('/sync/agent/results', epochToken, chunk(true, [renamed], 'sha256:req2|sha256:res2'));
    expect(response.status).toBe(200);
    expect(response.body.lastAlterId).toBe(150);
    expect(response.body.jobState).toBe('DONE');

    const stored = await harness.db.execute<{ name: string }>(sql`
      SELECT p.name FROM parties p
       JOIN external_refs x ON x.internal_id = p.id AND x.entity_type = 'party'
       WHERE x.external_guid = 'party-guid-asha'
    `);
    expect(stored.rows[0]?.name).toBe('Asha Trading Company');
  });

  it('refuses results for a job that is already done', async () => {
    const response = await agentPost('/sync/agent/results', epochToken, chunk(false, [beharRow]));
    expect(response.status).toBe(409);
  });

  it('refuses results claiming to come from the wrong books', async () => {
    const response = await agentPost('/sync/agent/results', epochToken, {
      ...chunk(false, [beharRow]),
      openCompanyGuid: 'guid-not-ours',
    });
    expect(response.status).toBe(409);
  });

  it("cannot absorb another connection's GUID mapping (6b exit gate)", async () => {
    const other = await harness.db.execute<{ id: string }>(sql`
      SELECT id FROM integration_connections
       WHERE org_id = ${ORG_ID} AND name = 'Other Company' AND deleted_at IS NULL LIMIT 1
    `);
    const otherId = other.rows[0]?.id ?? '';
    const party = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO parties (org_id, connection_id, name, parent_group)
      VALUES (${ORG_ID}, ${otherId}, 'Their Party', 'Sundry Debtors') RETURNING id
    `);
    const theirPartyId = party.rows[0]?.id ?? '';
    await harness.db.execute(sql`
      INSERT INTO external_refs (org_id, system, entity_type, external_guid, internal_type, internal_id, connection_id)
      VALUES (${ORG_ID}, 'TALLY', 'party', 'guid-owned-elsewhere', 'party', ${theirPartyId}, ${otherId})
      ON CONFLICT DO NOTHING
    `);

    // A fresh claimed job for OUR connection posting THEIR GUID: the
    // connection-scoped lookup finds nothing, the insert hits the org-wide
    // unique mapping, and the refusal names the rule instead of absorbing
    // the row.
    await harness.db.execute(sql`
      UPDATE sync_jobs SET state = 'DONE', updated_at = now()
       WHERE connection_id = ${connectionId} AND state IN ('QUEUED', 'CLAIMED')
    `);
    await harness.db.execute(sql`
      INSERT INTO sync_jobs (org_id, connection_id, direction, entity_type)
      VALUES (${ORG_ID}, ${connectionId}, 'PULL', 'party')
    `);
    const reclaim = await agentPost<AgentClaimResponse>('/sync/agent/jobs/claim', epochToken, {
      agentInstanceId: AGENT_D,
      openCompanyGuid: COMPANY_GUID,
    });
    const forged = await agentPost<{ error: { message: string } }>('/sync/agent/results', epochToken, {
      agentInstanceId: AGENT_D,
      openCompanyGuid: COMPANY_GUID,
      jobId: reclaim.body.job?.id ?? '',
      entityType: 'party',
      rows: [{ guid: 'guid-owned-elsewhere', alterId: 999, name: 'Hijacked Name', parentGroup: 'Sundry Debtors' }],
      requestHash: 'sha256:forge',
      responseHash: 'sha256:forge',
      final: true,
    });
    expect(forged.status).toBe(409);
    expect(forged.body.error.message).toContain('different connection');

    const victim = await harness.db.execute<{ name: string }>(sql`
      SELECT name FROM parties WHERE id = ${theirPartyId}
    `);
    expect(victim.rows[0]?.name).toBe('Their Party');
  });

  it('journalled every exchange with its hashes', async () => {
    const rows = await harness.db.execute<{ request_hash: string; result: string }>(sql`
      SELECT request_hash, result FROM sync_journal
       WHERE connection_id = ${connectionId} ORDER BY created_at
    `);
    expect(rows.rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.rows.map((r) => r.request_hash)).toContain('sha256:req2');
    expect(rows.rows.every((r) => r.result.startsWith('ok:'))).toBe(true);
  });
});
