import { randomUUID } from 'node:crypto';

import { SYSTEM_ROLES, type AgentClaimResponse, type AgentHeartbeatAck, type IntegrationListResponse, type IssuedAgentToken } from '@vyuha/shared';
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
  return harness.post<T>(path, { headers: { authorization: `Bearer ${token}` }, body });
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
    const response = await harness.get('/integrations', {
      headers: { authorization: `Bearer ${agentToken}` },
    });
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
