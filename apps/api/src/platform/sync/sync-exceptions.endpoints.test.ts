import {
  SYSTEM_ROLES,
  type AgentClaimResponse,
  type AgentErrorAck,
  type AgentHeartbeatAck,
  type IssuedAgentToken,
  type SyncExceptionView,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * REQ-T-01 over real HTTP: the agent's failure report becomes the row a
 * person must look at, and resolving it requires saying what was done.
 *
 * The property under test is conservation: an error that arrives is never
 * lost — journalled with Tally's verbatim words, the job failed if this
 * instance held one, the exception raised — and never over-applied — a
 * deposed instance's report cannot fail its successor's job, and two people
 * resolving one exception cannot both win.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000c0';

let harness: ApiHarness;
let adminToken: string;
let employeeToken: string;

let connectionId = '';
let agentToken = '';
let claimedJobId = '';
let exceptionId = '';

const AGENT_A = 'exc-agent-instance-a';
const COMPANY_GUID = 'guid-exc-2026-27';
const TALLY_ERROR = 'LINEERROR: Voucher totals do not balance (Tally said so, verbatim)';

function agentPost<T>(path: string, token: string, body: Record<string, unknown>) {
  return harness.post<T>(path, { token, body });
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Sync Exceptions Fixture Org');

  // Same self-cleaning contract as the agent suite: jobs, cursors and
  // exceptions are this file's own to hard-delete; connections soft-delete
  // because the journal references them RESTRICT and is append-only.
  await harness.db.execute(sql`DELETE FROM sync_exceptions WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM sync_jobs WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM sync_cursors WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(
    sql`UPDATE integration_connections SET deleted_at = now() WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`,
  );

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE, { isSystem: true });
  const admin = await harness.createUser({ email: scopedEmail('exc-admin'), roleIds: [adminRoleId] });
  const employee = await harness.createUser({
    email: scopedEmail('exc-employee'),
    roleIds: [employeeRoleId],
  });
  adminToken = (await harness.login(admin.email, admin.password)).token;
  employeeToken = (await harness.login(employee.email, employee.password)).token;

  // The real credential path end to end, not fixture rows: create, issue,
  // heartbeat (wins the lease), enqueue, claim. The error report then lands
  // on a job the server itself handed out.
  const created = await harness.post<{ id: string }>('/integrations', {
    token: adminToken,
    body: { name: 'Exc Co 2026-27', companyGuid: COMPANY_GUID },
  });
  connectionId = created.body.id;
  const issued = await harness.post<IssuedAgentToken>(`/integrations/${connectionId}/token`, {
    token: adminToken,
  });
  agentToken = issued.body.token;

  const beat = await agentPost<AgentHeartbeatAck>('/sync/agent/heartbeat', agentToken, {
    agentInstanceId: AGENT_A,
    agentVersion: '0.1.0',
    condition: 'OK',
    openCompanyGuid: COMPANY_GUID,
  });
  if (beat.status !== 200) throw new Error(`Fixture heartbeat refused: ${beat.status}`);

  await harness.db.execute(sql`
    INSERT INTO sync_jobs (org_id, connection_id, direction, entity_type)
    VALUES (${ORG_ID}, ${connectionId}, 'PULL', 'party')
  `);
  const claim = await agentPost<AgentClaimResponse>('/sync/agent/jobs/claim', agentToken, {
    agentInstanceId: AGENT_A,
    openCompanyGuid: COMPANY_GUID,
  });
  claimedJobId = claim.body.job?.id ?? '';
  if (claimedJobId === '') throw new Error('Fixture claim handed out no job.');
});

afterAll(async () => {
  await harness.close();
});

describe('POST /sync/agent/errors (09 §5)', () => {
  it('rejects an unauthenticated report', async () => {
    const response = await agentPost('/sync/agent/errors', `vyagt_${'0'.repeat(48)}`, {
      agentInstanceId: AGENT_A,
      errorText: TALLY_ERROR,
    });
    expect(response.status).toBe(401);
  });

  it('journals the exchange, fails the held job, raises the exception', async () => {
    const response = await agentPost<AgentErrorAck>('/sync/agent/errors', agentToken, {
      agentInstanceId: AGENT_A,
      jobId: claimedJobId,
      entityType: 'party',
      errorCode: 'LINEERROR',
      errorText: TALLY_ERROR,
      requestHash: 'sha256:req-exc-1',
      responseHash: 'sha256:res-exc-1',
      durationMs: 730,
    });
    expect(response.status).toBe(200);
    expect(response.body.jobFailed).toBe(true);
    exceptionId = response.body.exceptionId;

    const job = await harness.db.execute<{ state: string }>(sql`
      SELECT state FROM sync_jobs WHERE id = ${claimedJobId}
    `);
    expect(job.rows[0]?.state).toBe('FAILED');

    const journal = await harness.db.execute<{ error_text: string; error_code: string }>(sql`
      SELECT error_text, error_code FROM sync_journal
       WHERE org_id = ${ORG_ID} AND result = 'error'
       ORDER BY created_at DESC LIMIT 1
    `);
    // Verbatim: a paraphrase cannot be acted on (REQ-T-01).
    expect(journal.rows[0]?.error_text).toBe(TALLY_ERROR);
    expect(journal.rows[0]?.error_code).toBe('LINEERROR');
  });

  it('a report with no job still raises an exception — the error happened', async () => {
    const response = await agentPost<AgentErrorAck>('/sync/agent/errors', agentToken, {
      agentInstanceId: AGENT_A,
      errorText: 'Tally is not responding on port 9000',
      errorCode: 'ECONNREFUSED',
    });
    expect(response.status).toBe(200);
    expect(response.body.jobFailed).toBe(false);
    expect(response.body.exceptionId).not.toBe('');
  });

  it("cannot fail a job another instance holds — the exception is still raised", async () => {
    await harness.db.execute(sql`
      UPDATE sync_jobs SET state = 'CLAIMED', claimed_by = 'exc-agent-rival', claimed_at = now()
       WHERE id = ${claimedJobId}
    `);
    const response = await agentPost<AgentErrorAck>('/sync/agent/errors', agentToken, {
      agentInstanceId: AGENT_A,
      jobId: claimedJobId,
      errorText: 'A zombie reporting on work it no longer holds',
    });
    expect(response.status).toBe(200);
    expect(response.body.jobFailed).toBe(false);

    const job = await harness.db.execute<{ state: string; claimed_by: string }>(sql`
      SELECT state, claimed_by FROM sync_jobs WHERE id = ${claimedJobId}
    `);
    expect(job.rows[0]?.state).toBe('CLAIMED');
    expect(job.rows[0]?.claimed_by).toBe('exc-agent-rival');
  });
});

describe('GET /integrations/exceptions (REQ-T-01)', () => {
  it('is integration.manage only', async () => {
    const refused = await harness.get('/integrations/exceptions', { token: employeeToken });
    expect(refused.status).toBe(403);
  });

  it('lists what is open, newest first, with the connection named', async () => {
    const response = await harness.get<{ data: SyncExceptionView[] }>('/integrations/exceptions', {
      token: adminToken,
    });
    expect(response.status).toBe(200);
    const ours = response.body.data.filter((row) => row.connectionId === connectionId);
    expect(ours.length).toBe(3);
    expect(ours.every((row) => row.state === 'OPEN')).toBe(true);
    expect(ours[0]?.connectionName).toBe('Exc Co 2026-27');
    // Newest first: the zombie report was the last one posted.
    expect(ours[0]?.tallyError).toContain('zombie');
    expect(ours.at(-1)?.tallyError).toBe(TALLY_ERROR);
  });
});

describe('POST /integrations/exceptions/:id/resolve', () => {
  it('requires a note that says what was done', async () => {
    const response = await harness.post(`/integrations/exceptions/${exceptionId}/resolve`, {
      token: adminToken,
      body: { note: '' },
    });
    expect(response.status).toBe(400);
  });

  it('resolves once, with the note and the resolver recorded', async () => {
    const response = await harness.post<SyncExceptionView>(
      `/integrations/exceptions/${exceptionId}/resolve`,
      { token: adminToken, body: { note: 'Voucher corrected in Tally; re-pull queued.' } },
    );
    expect(response.status).toBe(200);
    expect(response.body.state).toBe('RESOLVED');
    expect(response.body.resolutionNote).toBe('Voucher corrected in Tally; re-pull queued.');
    expect(response.body.resolvedAt).not.toBeNull();

    // Resolved rows leave the open list and appear under their own state.
    const open = await harness.get<{ data: SyncExceptionView[] }>('/integrations/exceptions', {
      token: adminToken,
    });
    expect(open.body.data.some((row) => row.id === exceptionId)).toBe(false);
    const resolved = await harness.get<{ data: SyncExceptionView[] }>(
      '/integrations/exceptions?state=RESOLVED',
      { token: adminToken },
    );
    expect(resolved.body.data.some((row) => row.id === exceptionId)).toBe(true);
  });

  it('tells the second resolver it was already done', async () => {
    const response = await harness.post(`/integrations/exceptions/${exceptionId}/resolve`, {
      token: adminToken,
      body: { note: 'Racing resolution' },
    });
    expect(response.status).toBe(409);
  });

  it('404s an exception that does not exist', async () => {
    const response = await harness.post(
      '/integrations/exceptions/00000000-0000-7000-8000-000000000000/resolve',
      { token: adminToken, body: { note: 'Nothing here' } },
    );
    expect(response.status).toBe(404);
  });

  it('is refused without integration.manage', async () => {
    const response = await harness.post(`/integrations/exceptions/${exceptionId}/resolve`, {
      token: employeeToken,
      body: { note: 'Should never land' },
    });
    expect(response.status).toBe(403);
  });
});
