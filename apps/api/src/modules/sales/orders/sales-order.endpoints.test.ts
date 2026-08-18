import {
  SYSTEM_ROLES,
  type AgentClaimResponse,
  type EstimateView,
  type IssuedAgentToken,
  type Paginated,
  type SalesDocumentSummary,
  type SalesDocumentView,
  type VoucherPushPayload,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';

/**
 * Sales orders and the push path (REQ-W-03, W-06, W-07; 09 §3.3). The agent
 * is played by this file: it claims the job the confirm queued, and posts
 * the outcome. What is pinned: one voucher per job, the state is the
 * agent's word and nothing else, an alter re-pushes against the GUID, and
 * a rejection lands as an exception with Tally's verbatim text.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e9';
const COMPANY_GUID = 'guid-orders-co';
const AGENT = 'agent-orders-1';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let harness: ApiHarness;
let adminToken: string;
let salesToken: string;
let managerToken: string;
let agentToken = '';
let connectionId = '';
let partyId = '';
let cableId = '';

async function claim(): Promise<AgentClaimResponse['job']> {
  const response = await harness.post<AgentClaimResponse>('/sync/agent/jobs/claim', {
    token: agentToken,
    body: { agentInstanceId: AGENT, openCompanyGuid: COMPANY_GUID },
  });
  expect(response.status).toBe(200);
  return response.body.job;
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Orders Fixture Org');
  await harness.db.execute(sql`DELETE FROM sync_exceptions WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM sync_jobs WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM external_refs WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM stock_items WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM parties WHERE org_id = ${ORG_ID}`);
  // The journal is append-only and points at connections, so a past run's
  // connection is retired rather than deleted; the push picks the live one.
  await harness.db.execute(sql`UPDATE integration_connections SET deleted_at = now(), lease_holder = NULL WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`);

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const salesRoleId = await harness.createSystemRole(SYSTEM_ROLES.SALES, { isSystem: true });
  const managerRoleId = await harness.createSystemRole(SYSTEM_ROLES.SALES_MANAGER, { isSystem: true });
  const ravi = await harness.createEmployee({ code: 'SO-001', firstName: 'Ravi', lastName: 'Kumar' });
  const admin = await harness.createUser({ email: scopedEmail('so-admin'), roleIds: [adminRoleId] });
  const sales = await harness.createUser({ email: scopedEmail('so-sales'), roleIds: [salesRoleId], employeeId: ravi });
  const manager = await harness.createUser({ email: scopedEmail('so-manager'), roleIds: [managerRoleId] });
  adminToken = (await harness.login(admin.email, admin.password)).token;
  salesToken = (await harness.login(sales.email, sales.password)).token;
  managerToken = (await harness.login(manager.email, manager.password)).token;

  const created = await harness.post<{ id: string }>('/integrations', { token: adminToken, body: { name: 'Orders Co', companyName: 'Orders Co' } });
  connectionId = created.body.id;
  const issued = await harness.post<IssuedAgentToken>(`/integrations/${connectionId}/token`, { token: adminToken, body: {} });
  agentToken = issued.body.token;
  await harness.db.execute(sql`UPDATE integration_connections SET company_guid = ${COMPANY_GUID} WHERE id = ${connectionId}`);
  // Take the lease and be heard.
  const beat = await harness.post('/sync/agent/heartbeat', { token: agentToken, body: { agentInstanceId: AGENT, agentVersion: '0.1.0', openCompanyGuid: COMPANY_GUID } });
  expect(beat.status).toBe(200);

  const party = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO parties (org_id, connection_id, name, parent_group) VALUES (${ORG_ID}, ${connectionId}, 'Asha Traders', 'Sundry Debtors') RETURNING id
  `);
  partyId = party.rows[0]?.id ?? '';
  const cable = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO stock_items (org_id, connection_id, name, unit, parent_group, gst_rate) VALUES (${ORG_ID}, ${connectionId}, 'Cat6 cable 305m', 'BOX', 'Cables', '18.00') RETURNING id
  `);
  cableId = cable.rows[0]?.id ?? '';
});

afterAll(async () => {
  await harness.close();
});

let orderId = '';
let jobId = '';

describe('raising and confirming (REQ-W-03)', () => {
  it('needs a Tally party, numbers SO-0001, and starts NOT_PUSHED', async () => {
    const prospect = await harness.post<ErrorBody>('/sales/orders', { token: salesToken, body: { lines: [{ description: 'x', quantity: '1', rate: '1' }] } });
    expect(prospect.status).toBe(400);

    const created = await harness.post<SalesDocumentView>('/sales/orders', {
      token: salesToken,
      body: { partyId, lines: [{ stockItemId: cableId, quantity: '2', rate: '4000' }] },
    });
    expect(created.status).toBe(201);
    expect(created.body.number).toBe('SO-0001');
    expect(created.body.docType).toBe('SALES_ORDER');
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.syncState).toBe('NOT_PUSHED');
    expect(created.body.grandTotal).toBe('9440.00');
    orderId = created.body.id;
  });

  it('converts an accepted estimate, carrying its lines and pointing back at it', async () => {
    const estimate = await harness.post<EstimateView>('/sales/estimates', {
      token: salesToken,
      body: { partyId, lines: [{ stockItemId: cableId, quantity: '5', rate: '3900', discountPct: '2' }] },
    });
    const early = await harness.post<ErrorBody>(`/sales/estimates/${estimate.body.id}/convert`, { token: salesToken, body: {} });
    expect(early.status).toBe(409);
    await harness.post(`/sales/estimates/${estimate.body.id}/status`, { token: salesToken, body: { status: 'ACCEPTED' } });

    const converted = await harness.post<SalesDocumentView>(`/sales/estimates/${estimate.body.id}/convert`, { token: salesToken, body: {} });
    expect(converted.status).toBe(201);
    expect(converted.body.number).toBe('SO-0002');
    expect(converted.body.sourceDocumentId).toBe(estimate.body.id);
    expect(converted.body.lines.map((l) => [l.quantity, l.rate, l.discountPct, l.amount])).toEqual([['5.000', '3900.00', '2.00', '19110.00']]);
    expect(await harness.waitForAuditAction('sales.order.converted')).toBe(true);
  });

  it('confirming queues exactly one push job for the agent, and the state says QUEUED', async () => {
    const confirmed = await harness.post<SalesDocumentView>(`/sales/orders/${orderId}/confirm`, { token: salesToken });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.syncState).toBe('QUEUED');

    const again = await harness.post<ErrorBody>(`/sales/orders/${orderId}/push`, { token: salesToken });
    expect(again.status).toBe(409);

    const edit = await harness.patch<ErrorBody>(`/sales/orders/${orderId}`, { token: salesToken, body: { notes: 'late' } });
    expect(edit.status).toBe(409);

    const jobs = await harness.db.execute<{ id: string; entity_type: string; direction: string; payload: VoucherPushPayload }>(sql`
      SELECT id, entity_type, direction, payload FROM sync_jobs WHERE org_id = ${ORG_ID} AND direction = 'PUSH'
    `);
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]?.entity_type).toBe(`voucher_push:${orderId}`);
    expect(jobs.rows[0]?.payload.voucherType).toBe('Sales Order');
    expect(jobs.rows[0]?.payload.idempotencyKey).toBe(`vyuha:${orderId}`);
    expect(jobs.rows[0]?.payload.remoteGuid).toBeNull();
    expect(jobs.rows[0]?.payload.lines[0]?.stockItemName).toBe('Cat6 cable 305m');
  });
});

describe('the push, as the agent reports it (REQ-W-06, 09 §3.3)', () => {
  it('the agent claims the job and posts an acceptance; the document reads PUSHED with the GUID', async () => {
    const job = await claim();
    expect(job?.direction).toBe('PUSH');
    expect(job?.entityType).toBe(`voucher_push:${orderId}`);
    jobId = job?.id ?? '';

    const posted = await harness.post<{ jobState: string }>('/sync/agent/results', {
      token: agentToken,
      body: {
        agentInstanceId: AGENT,
        openCompanyGuid: COMPANY_GUID,
        jobId,
        entityType: 'voucher_push',
        outcome: 'accepted',
        remoteGuid: 'tally-guid-so-1',
        remoteVoucherNumber: '17',
        requestHash: 'sha256:req', responseHash: 'sha256:res',
        final: true,
      },
    });
    expect(posted.status).toBe(200);
    expect(posted.body.jobState).toBe('DONE');

    const order = await harness.get<SalesDocumentView>(`/sales/orders/${orderId}`, { token: salesToken });
    expect(order.body.syncState).toBe('PUSHED');
    expect(order.body.remoteGuid).toBe('tally-guid-so-1');
    expect(order.body.remoteVoucherNumber).toBe('17');
    expect(order.body.lastPushedAt).not.toBeNull();

    const refs = await harness.db.execute<{ external_guid: string; idempotency_key: string; sync_state: string }>(sql`
      SELECT external_guid, idempotency_key, sync_state FROM external_refs WHERE org_id = ${ORG_ID} AND internal_id = ${orderId}
    `);
    expect(refs.rows).toEqual([{ external_guid: 'tally-guid-so-1', idempotency_key: `vyuha:${orderId}`, sync_state: 'pushed' }]);
  });

  it('a pushed order refuses a draft edit; Alter needs the key, re-pushes against the GUID, and never a second voucher', async () => {
    const asSales = await harness.post<ErrorBody>(`/sales/orders/${orderId}/alter`, { token: salesToken, body: { notes: 'more' } });
    expect(asSales.status).toBe(403);

    const altered = await harness.post<SalesDocumentView>(`/sales/orders/${orderId}/alter`, {
      token: managerToken,
      body: { lines: [{ stockItemId: cableId, quantity: '3', rate: '4000' }] },
    });
    expect(altered.status).toBe(200);
    expect(altered.body.syncState).toBe('QUEUED');
    expect(altered.body.grandTotal).toBe('14160.00');
    expect(await harness.waitForAuditAction('sales.order.altered')).toBe(true);

    const job = await claim();
    expect(job?.entityType).toBe(`voucher_push:${orderId}`);
    expect((job?.payload as VoucherPushPayload).remoteGuid).toBe('tally-guid-so-1');

    // Idempotency: the agent found the key already in Tally and altered in place.
    const posted = await harness.post('/sync/agent/results', {
      token: agentToken,
      body: {
        agentInstanceId: AGENT, openCompanyGuid: COMPANY_GUID, jobId: job?.id, entityType: 'voucher_push',
        outcome: 'landed_on_retry', remoteGuid: 'tally-guid-so-1', remoteVoucherNumber: '17',
        requestHash: 'sha256:req2', responseHash: 'sha256:res2', final: true,
      },
    });
    expect(posted.status).toBe(200);
    const order = await harness.get<SalesDocumentView>(`/sales/orders/${orderId}`, { token: salesToken });
    expect(order.body.syncState).toBe('PUSHED');
    expect(order.body.remoteGuid).toBe('tally-guid-so-1');
    const refs = await harness.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM external_refs WHERE org_id = ${ORG_ID} AND internal_id = ${orderId}`);
    expect(refs.rows[0]?.n).toBe(1);
  });

  it('a rejection lands as FAILED with Tally’s verbatim words, and an exception a person will see', async () => {
    const orders = await harness.get<Paginated<SalesDocumentSummary>>('/sales/orders?q=SO-0002', { token: salesToken });
    const second = orders.body.data[0]?.id ?? '';
    const confirmed = await harness.post<SalesDocumentView>(`/sales/orders/${second}/confirm`, { token: salesToken });
    expect(confirmed.body.syncState).toBe('QUEUED');
    const job = await claim();
    expect(job?.entityType).toBe(`voucher_push:${second}`);

    const missingText = await harness.post<ErrorBody>('/sync/agent/results', {
      token: agentToken,
      body: { agentInstanceId: AGENT, openCompanyGuid: COMPANY_GUID, jobId: job?.id, entityType: 'voucher_push', outcome: 'rejected', requestHash: 'h', responseHash: 'h', final: true },
    });
    expect(missingText.status).toBe(400);

    const rejected = await harness.post('/sync/agent/results', {
      token: agentToken,
      body: {
        agentInstanceId: AGENT, openCompanyGuid: COMPANY_GUID, jobId: job?.id, entityType: 'voucher_push', outcome: 'rejected',
        errorText: "Ledger 'Asha Traders' does not exist!", requestHash: 'h', responseHash: 'h', final: true,
      },
    });
    expect(rejected.status).toBe(200);

    const order = await harness.get<SalesDocumentView>(`/sales/orders/${second}`, { token: salesToken });
    expect(order.body.syncState).toBe('FAILED');
    expect(order.body.lastError).toBe("Ledger 'Asha Traders' does not exist!");
    const exceptions = await harness.get<{ data: { kind: string; tallyError: string; entityId: string | null }[] }>('/integrations/exceptions', { token: adminToken });
    expect(exceptions.body.data.some((e) => e.kind === 'REJECTION' && e.tallyError.includes("Ledger 'Asha Traders' does not exist!"))).toBe(true);

    // Push again re-queues a fresh job; nothing about the failure is inferred away.
    const again = await harness.post<SalesDocumentView>(`/sales/orders/${second}/push`, { token: salesToken });
    expect(again.body.syncState).toBe('QUEUED');
    expect(again.body.lastError).toBeNull();
    const list = await harness.get<Paginated<SalesDocumentSummary>>('/sales/orders?syncState=QUEUED', { token: salesToken });
    expect(list.body.data.map((o) => o.number)).toEqual(['SO-0002']);
  });

  it('a draft cancels; a confirmed order does not, and says why', async () => {
    const draft = await harness.post<SalesDocumentView>('/sales/orders', { token: salesToken, body: { partyId, lines: [{ description: 'Freight', quantity: '1', rate: '500' }] } });
    const cancelled = await harness.post<SalesDocumentView>(`/sales/orders/${draft.body.id}/cancel`, { token: salesToken });
    expect(cancelled.body.status).toBe('CANCELLED');
    const refused = await harness.post<ErrorBody>(`/sales/orders/${orderId}/cancel`, { token: salesToken });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain('cancelled in Tally');
  });
});
