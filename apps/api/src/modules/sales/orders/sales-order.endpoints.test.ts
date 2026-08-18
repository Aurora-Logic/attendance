import {
  SYSTEM_ROLES,
  type AgentClaimResponse,
  type AwaitingInvoiceEntry,
  type EstimateView,
  type PackRecordView,
  type PickQueueEntry,
  type UnlinkedInvoice,
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


describe('pick, pack, and the billing handshake (12 §3.2, §3.3; 13 REQ-X-08)', () => {
  let bigId = '';
  let lineId = '';

  it('a confirmed order joins the pick queue; a short pack raises a requirement for the balance and the word reads picking', async () => {
    const created = await harness.post<SalesDocumentView>('/sales/orders', {
      token: salesToken,
      body: { partyId, lines: [{ stockItemId: cableId, quantity: '100', rate: '4000' }] },
    });
    bigId = created.body.id;
    lineId = created.body.lines[0]?.id ?? '';
    expect(created.body.fulfilment).toBe('open');
    await harness.post(`/sales/orders/${bigId}/confirm`, { token: salesToken });

    const queue = await harness.get<PickQueueEntry[]>('/sales/pick-queue', { token: salesToken });
    const entry = queue.body.find((e) => e.documentId === bigId);
    expect(entry).toMatchObject({ balanceQty: '100.000', balanceLines: 1, waitingOnRequirements: 0, fulfilment: 'open' });

    const tooMany = await harness.post<ErrorBody>(`/sales/orders/${bigId}/packs`, {
      token: salesToken,
      body: { boxCount: 3, lines: [{ lineId, quantity: '120' }] },
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.message).toContain('100.000 left to pack');

    const packed = await harness.post<PackRecordView>(`/sales/orders/${bigId}/packs`, {
      token: salesToken,
      body: { boxCount: 3, comment: 'Only 60 on the shelf', lines: [{ lineId, quantity: '60', comment: 'short supply' }] },
    });
    expect(packed.status).toBe(201);
    expect(packed.body.lines).toEqual([{ lineId, description: 'Cat6 cable 305m', quantity: '60.000', comment: 'short supply' }]);

    const order = await harness.get<SalesDocumentView>(`/sales/orders/${bigId}`, { token: salesToken });
    expect(order.body.lines[0]?.packedQty).toBe('60.000');
    expect(order.body.fulfilment).toBe('awaiting_invoice');

    // D-31: the 40 became a requirement carrying the order.
    const requirement = await harness.db.execute<{ quantity: string; source: string; state: string }>(sql`
      SELECT quantity::text, source, state FROM procurement_requirements WHERE org_id = ${ORG_ID} AND sales_order_line_id = ${lineId} AND deleted_at IS NULL
    `);
    expect(requirement.rows).toEqual([{ quantity: '40.000', source: 'shortage', state: 'open' }]);
    const again = await harness.get<PickQueueEntry[]>('/sales/pick-queue', { token: salesToken });
    expect(again.body.find((e) => e.documentId === bigId)).toMatchObject({ balanceQty: '40.000', waitingOnRequirements: 1, fulfilment: 'picking' });
  });

  it('the packed 60 sit on the awaiting-invoice queue; the accountant’s Sales voucher naming the order links itself and advances invoiced_qty', async () => {
    const waiting = await harness.get<AwaitingInvoiceEntry[]>('/sales/awaiting-invoice', { token: salesToken });
    const entry = waiting.body.find((e) => e.documentId === bigId);
    expect(entry?.packedUninvoicedQty).toBe('60.000');
    expect(entry?.waitingHours).toBe(0);

    const order = await harness.get<SalesDocumentView>(`/sales/orders/${bigId}`, { token: salesToken });
    // The pull brings a Sales voucher whose narration names the order (D-21).
    const voucher = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO vouchers (org_id, connection_id, master_id, alter_id, voucher_date, voucher_type, voucher_number, party_name, party_id, narration, amount)
      VALUES (${ORG_ID}, ${connectionId}, 'inv-1', 5, '2026-08-19', 'Sales', 'INV-0101', 'Asha Traders', ${partyId}, ${`Against ${order.body.number}`}, '240000.00') RETURNING id
    `);
    await harness.db.execute(sql`
      INSERT INTO voucher_lines (org_id, voucher_id, line_no, kind, stock_item_name, stock_item_id, actual_qty, billed_qty, rate, amount)
      VALUES (${ORG_ID}, ${voucher.rows[0]?.id ?? ''}, 1, 'inventory', 'Cat6 cable 305m', ${cableId}, '60 BOX', '60 BOX', '4000.00', '240000.00')
    `);

    const after = await harness.get<AwaitingInvoiceEntry[]>('/sales/awaiting-invoice', { token: salesToken });
    expect(after.body.find((e) => e.documentId === bigId)).toBeUndefined();
    const linked = await harness.get<SalesDocumentView>(`/sales/orders/${bigId}`, { token: salesToken });
    expect(linked.body.lines[0]?.invoicedQty).toBe('60.000');
    expect(linked.body.invoices.map((i) => [i.voucherNumber, i.method])).toEqual([['INV-0101', 'narration']]);
    expect(linked.body.fulfilment).toBe('ready_to_dispatch');
  });

  it('an invoice naming nobody waits on the unlinked screen with the party’s open orders beside it, and links by hand', async () => {
    const stray = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO vouchers (org_id, connection_id, master_id, alter_id, voucher_date, voucher_type, voucher_number, party_name, party_id, narration, amount)
      VALUES (${ORG_ID}, ${connectionId}, 'inv-2', 6, '2026-08-19', 'Sales', 'INV-0102', 'Asha Traders', ${partyId}, 'no reference', '10.00') RETURNING id
    `);
    const unlinked = await harness.get<UnlinkedInvoice[]>('/sales/invoices/unlinked', { token: salesToken });
    const entry = unlinked.body.find((u) => u.voucherNumber === 'INV-0102');
    expect(entry).toBeDefined();
    // Nothing packed-and-uninvoiced remains on the big order, so it is not offered as a candidate.
    expect(entry?.candidateOrders.some((c) => c.documentId === bigId)).toBe(false);

    // Pack the remaining 40 by hand (stock "arrived"), then link the stray invoice to cover it.
    await harness.post(`/sales/orders/${bigId}/packs`, { token: salesToken, body: { lines: [{ lineId, quantity: '40' }] } });
    const requirement = await harness.db.execute<{ state: string }>(sql`SELECT state FROM procurement_requirements WHERE sales_order_line_id = ${lineId}`);
    expect(requirement.rows[0]?.state).toBe('closed');
    const linked = await harness.post<SalesDocumentView>(`/sales/orders/${bigId}/link-invoice`, { token: salesToken, body: { voucherId: stray.rows[0]?.id } });
    expect(linked.status).toBe(200);
    // A voucher with no item lines covers everything packed and uninvoiced.
    expect(linked.body.lines[0]?.invoicedQty).toBe('100.000');
    expect(linked.body.invoices).toHaveLength(2);
    expect(await harness.waitForAuditAction('sales.order.invoice_linked')).toBe(true);
  });

  it('short-close needs the alter key, records the reason, and closes the order’s open requirements', async () => {
    const created = await harness.post<SalesDocumentView>('/sales/orders', { token: salesToken, body: { partyId, lines: [{ stockItemId: cableId, quantity: '10', rate: '1' }] } });
    await harness.post(`/sales/orders/${created.body.id}/confirm`, { token: salesToken });
    const line = created.body.lines[0]?.id ?? '';
    await harness.post(`/sales/orders/${created.body.id}/packs`, { token: salesToken, body: { lines: [{ lineId: line, quantity: '4' }] } });

    const refused = await harness.post<ErrorBody>(`/sales/orders/${created.body.id}/short-close`, { token: salesToken, body: { reason: 'Customer cancelled the rest' } });
    expect(refused.status).toBe(403);
    const closed = await harness.post<SalesDocumentView>(`/sales/orders/${created.body.id}/short-close`, { token: managerToken, body: { reason: 'Customer cancelled the rest' } });
    expect(closed.status).toBe(200);
    expect(closed.body.fulfilment).toBe('short_closed');
    expect(closed.body.shortCloseReason).toBe('Customer cancelled the rest');
    const requirement = await harness.db.execute<{ state: string; closed_reason: string }>(sql`SELECT state, closed_reason FROM procurement_requirements WHERE sales_order_line_id = ${line}`);
    expect(requirement.rows[0]?.state).toBe('closed');
    const queue = await harness.get<PickQueueEntry[]>('/sales/pick-queue', { token: salesToken });
    expect(queue.body.some((e) => e.documentId === created.body.id)).toBe(false);
  });
});
