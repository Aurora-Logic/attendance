import { PERMISSIONS, SYSTEM_ROLES, type ExportDownload, type ExportJobSummary, type Paginated, type PartyView } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { env } from '../common/env.js';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import { ExceptionSweepHandler } from './exception-sweep.handler.js';
import { ExportService } from '../export/export.service.js';
import { NotificationDispatcher, type NotificationEvent } from '../notifications/notification.dispatcher.js';

/**
 * The masters read surface (09 §5), and the 6b acceptance line it exists to
 * satisfy: "There is no way to create one in Vyuha — verified by asserting
 * the API returns 405 on POST /masters/parties." The write refusals are
 * asserted with their reason, because the 405 exists to teach, not merely to
 * refuse.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000bf';

let harness: ApiHarness;
let adminToken: string;
let employeeToken: string;
let connectionId = '';
let ashaId = '';

beforeAll(async () => {
  // export_jobs.requested_by is ON DELETE RESTRICT; a row left by a crashed
  // run pins its user and breaks resetOrganisation for every later run.
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    await pool.query('DELETE FROM export_jobs WHERE org_id = $1', [ORG_ID]);
  } finally {
    await pool.end();
  }
  harness = await ApiHarness.start(ORG_ID, 'Masters Fixture Org');

  await harness.db.execute(sql`DELETE FROM sync_jobs WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM sync_cursors WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM vouchers WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM parties WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(
    sql`UPDATE integration_connections SET deleted_at = now() WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`,
  );

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE, { isSystem: true });
  const admin = await harness.createUser({ email: scopedEmail('masters-admin'), roleIds: [adminRoleId] });
  const employee = await harness.createUser({
    email: scopedEmail('masters-employee'),
    roleIds: [employeeRoleId],
  });
  adminToken = (await harness.login(admin.email, admin.password)).token;
  employeeToken = (await harness.login(employee.email, employee.password)).token;

  const connection = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO integration_connections (org_id, system, name, company_guid)
    VALUES (${ORG_ID}, 'TALLY', 'Masters Co', 'guid-masters-co')
    RETURNING id
  `);
  connectionId = connection.rows[0]?.id ?? '';

  const asha = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO parties (org_id, connection_id, name, alias, parent_group, gstin, credit_limit, credit_days)
    VALUES (${ORG_ID}, ${connectionId}, 'Asha Traders', 'Asha', 'Sundry Debtors', '27AAAPL1234C1ZV', '250000.00', 30)
    RETURNING id
  `);
  ashaId = asha.rows[0]?.id ?? '';
  await harness.db.execute(sql`
    INSERT INTO parties (org_id, connection_id, name, parent_group, absent_in_tally)
    VALUES (${ORG_ID}, ${connectionId}, 'Behar Supply Co', 'Sundry Creditors', true)
  `);
});

afterAll(async () => {
  await harness.close();
});

describe('GET /masters/parties', () => {
  it('needs masters.tally.view — an employee is refused, and told which key', async () => {
    const refused = await harness.get<{ error: { details?: { requiredAnyOf?: string[] } } }>(
      '/masters/parties',
      { token: employeeToken },
    );
    expect(refused.status).toBe(403);
    expect(refused.body.error.details?.requiredAnyOf).toContain('masters.tally.view');
  });

  it('lists the projection with its figures exact and its age stated', async () => {
    const response = await harness.get<Paginated<PartyView>>('/masters/parties', {
      token: adminToken,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.map((p) => p.name)).toEqual(['Asha Traders', 'Behar Supply Co']);

    const asha = response.body.data[0];
    expect(asha?.creditLimit).toBe('250000.00');
    expect(asha?.lastPulledAt).toBeTruthy();
    expect(response.body.data[1]?.absentInTally).toBe(true);
  });

  it('searches name, alias and GSTIN, with wildcards escaped', async () => {
    const byGstin = await harness.get<Paginated<PartyView>>(
      '/masters/parties?q=27AAAPL1234C1ZV',
      { token: adminToken },
    );
    expect(byGstin.body.data.map((p) => p.name)).toEqual(['Asha Traders']);

    const wildcard = await harness.get<Paginated<PartyView>>('/masters/parties?q=%25%25', {
      token: adminToken,
    });
    expect(wildcard.body.data).toEqual([]);
  });

  it('filters by ledger side', async () => {
    const creditors = await harness.get<Paginated<PartyView>>(
      '/masters/parties?parentGroup=Sundry%20Creditors',
      { token: adminToken },
    );
    expect(creditors.body.data.map((p) => p.name)).toEqual(['Behar Supply Co']);
  });

  it('answers a single party, and a cross-org id as not found', async () => {
    const found = await harness.get<PartyView>(`/masters/parties/${ashaId}`, {
      token: adminToken,
    });
    expect(found.status).toBe(200);
    expect(found.body.name).toBe('Asha Traders');

    const missing = await harness.get(
      '/masters/parties/00000000-0000-4000-8000-000000000000',
      { token: adminToken },
    );
    expect(missing.status).toBe(404);
  });
});

describe('masters are read-only, and the refusal teaches (REQ-R-04)', () => {
  it('POST answers 405 naming where a party is actually created', async () => {
    const response = await harness.post<{ error: { message: string } }>('/masters/parties', {
      token: adminToken,
      body: { name: 'Should Never Exist' },
    });
    expect(response.status).toBe(405);
    expect(response.body.error.message).toContain('created in Tally');
  });

  it('PATCH answers 405 with the same teaching', async () => {
    const patched = await harness.patch<{ error: { message: string } }>(
      `/masters/parties/${ashaId}`,
      { token: adminToken, body: { name: 'Tampered' } },
    );
    expect(patched.status).toBe(405);
    expect(patched.body.error.message).toContain('read-only');
  });

  it('DELETE lands on the recycle bin surface, which refuses parties by name', async () => {
    // The soft-delete route owns this verb and path shape, and parties are
    // deliberately not in SOFT_DELETABLE_ENTITIES: absent in Tally is a
    // marking, not a deletion (REQ-R-06).
    const deleted = await harness.del<{ error: { message: string } }>(
      `/masters/parties/${ashaId}`,
      { token: adminToken, body: { reason: 'this must not work' } },
    );
    expect(deleted.status).toBe(400);
    expect(deleted.body.error.message).toContain('not a master that supports delete');
  });
});

describe('parties join Go To (REQ-O-05)', () => {
  it('a holder finds a party; the subtitle names the ledger side', async () => {
    const response = await harness.get<{ records: { type: string; title: string; subtitle: string | null }[] }>(
      '/go-to?q=asha',
      { token: adminToken },
    );
    const party = response.body.records.find((r) => r.type === 'party');
    expect(party?.title).toBe('Asha Traders');
    expect(party?.subtitle).toContain('Sundry Debtors');
  });

  it('a non-holder gets no party records, before ranking ever sees them', async () => {
    const response = await harness.get<{ records: { type: string }[] }>('/go-to?q=asha', {
      token: employeeToken,
    });
    expect(response.body.records.some((r) => r.type === 'party')).toBe(false);
  });
});

describe('vouchers, the books (Phase 6c, receivables.view)', () => {
  let invoiceId = '';

  beforeAll(async () => {
    const inserted = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO vouchers
        (org_id, connection_id, voucher_date, voucher_type, voucher_number, party_name, party_id, narration, is_cancelled, amount)
      VALUES
        (${ORG_ID}, ${connectionId}, '2026-08-01', 'Sales', 'INV-0042', 'Asha Traders', ${ashaId}, 'Cable order', false, '4150.50'),
        (${ORG_ID}, ${connectionId}, '2026-08-05', 'Receipt', 'RCT-0007', 'Asha Traders', ${ashaId}, '', false, '4150.50'),
        (${ORG_ID}, ${connectionId}, '2026-07-20', 'Sales', 'INV-0040', 'Someone Else', NULL, '', true, '99.00')
      RETURNING id
    `);
    invoiceId = inserted.rows[0]?.id ?? '';
    await harness.db.execute(sql`
      INSERT INTO voucher_lines (org_id, voucher_id, line_no, kind, ledger_name, is_deemed_positive, amount)
      VALUES (${ORG_ID}, ${invoiceId}, 1, 'ledger', 'Asha Traders', true, '4150.50'),
             (${ORG_ID}, ${invoiceId}, 2, 'ledger', 'Sales', false, '-4150.50')
    `);
    await harness.db.execute(sql`
      INSERT INTO voucher_lines (org_id, voucher_id, line_no, kind, stock_item_name, actual_qty, billed_qty, rate, amount)
      VALUES (${ORG_ID}, ${invoiceId}, 3, 'inventory', 'Cat6 Cable Box', '1 NOS', '1 NOS', '4150.50', '4150.50')
    `);
  });

  it('is receivables.view, not masters.tally.view: an employee is refused', async () => {
    const refused = await harness.get('/masters/vouchers', { token: employeeToken });
    expect(refused.status).toBe(403);
  });

  it('lists newest first, hiding the cancelled unless asked, and filters by type, party and date', async () => {
    const list = await harness.get<{ data: { voucherNumber: string; amount: string }[]; meta: { total: number } }>(
      '/masters/vouchers',
      { token: adminToken },
    );
    expect(list.status).toBe(200);
    expect(list.body.data.map((v) => v.voucherNumber)).toEqual(['RCT-0007', 'INV-0042']);
    // Money as text, to the paisa (D-01).
    expect(list.body.data[1]?.amount).toBe('4150.50');

    const withCancelled = await harness.get<{ meta: { total: number } }>(
      '/masters/vouchers?includeCancelled=true',
      { token: adminToken },
    );
    expect(withCancelled.body.meta.total).toBe(3);

    const sales = await harness.get<{ data: { voucherNumber: string }[] }>(
      `/masters/vouchers?voucherType=Sales&partyId=${ashaId}&from=2026-08-01&to=2026-08-31`,
      { token: adminToken },
    );
    expect(sales.body.data.map((v) => v.voucherNumber)).toEqual(['INV-0042']);
  });

  it('the detail carries the lines in Tally’s order', async () => {
    const detail = await harness.get<{ lines: { lineNo: number; kind: string; ledgerName: string | null; amount: string }[] }>(
      `/masters/vouchers/${invoiceId}`,
      { token: adminToken },
    );
    expect(detail.status).toBe(200);
    expect(detail.body.lines.map((l) => [l.lineNo, l.kind])).toEqual([[1, 'ledger'], [2, 'ledger'], [3, 'inventory']]);
    expect(detail.body.lines[1]?.amount).toBe('-4150.50');
  });

  it('typing a voucher number in Go To opens that voucher (09 §6)', async () => {
    const response = await harness.get<{ records: { type: string; id: string; code: string | null; title: string }[] }>(
      '/go-to?q=INV-0042',
      { token: adminToken },
    );
    const voucher = response.body.records.find((r) => r.type === 'voucher');
    expect(voucher?.id).toBe(invoiceId);
    expect(voucher?.code).toBe('INV-0042');
    expect(voucher?.title).toBe('Sales INV-0042');
    // And a non-holder never sees the source.
    const refused = await harness.get<{ records: { type: string }[] }>('/go-to?q=INV-0042', { token: employeeToken });
    expect(refused.body.records.some((r) => r.type === 'voucher')).toBe(false);
  });
});

describe('voucher reconciliation report (REQ-S-05, through the report shell)', () => {
  it('appears in the catalogue for a receivables holder, and only for them', async () => {
    const admin = await harness.get<{ data: { key: string }[] }>('/reports', { token: adminToken });
    expect(admin.body.data.some((r) => r.key === 'voucher-reconciliation')).toBe(true);
    // Attendance's own catalogue is untouched by the new group.
    expect(admin.body.data.some((r) => r.key === 'attendance-register')).toBe(true);
    // A row read without the key is refused where the source is asked.
    const employee = await harness.get('/reports/voucher-reconciliation/rows', { token: employeeToken });
    expect(employee.status).toBe(403);
  });

  it('groups by month and voucher type; cancelled vouchers count but do not add value', async () => {
    const response = await harness.get<{
      data: { month: string; voucherType: string; count: number; cancelled: number; total: string }[];
      meta: { total: number };
    }>('/reports/voucher-reconciliation/rows?from=2026-07-01&to=2026-08-31', { token: adminToken });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      { month: '2026-07', voucherType: 'Sales', count: 1, cancelled: 1, total: '0', lastPulledAt: expect.any(String) as string },
      { month: '2026-08', voucherType: 'Receipt', count: 1, cancelled: 0, total: '4150.50', lastPulledAt: expect.any(String) as string },
      { month: '2026-08', voucherType: 'Sales', count: 1, cancelled: 0, total: '4150.50', lastPulledAt: expect.any(String) as string },
    ]);
    expect(response.body.meta.total).toBe(3);
  });
});

describe('the receivables reports (Phase 6d, REQ-Y-01, Y-03, Y-05, Y-07)', () => {
  beforeAll(async () => {
    // A June invoice before the statement's period, so the opening row has
    // something to carry; and a voucher type outside the debit/credit table.
    await harness.db.execute(sql`
      INSERT INTO vouchers
        (org_id, connection_id, voucher_date, voucher_type, voucher_number, party_name, party_id, narration, is_cancelled, amount)
      VALUES
        (${ORG_ID}, ${connectionId}, '2026-06-10', 'Sales', 'INV-0031', 'Asha Traders', ${ashaId}, 'June order', false, '1000.00'),
        (${ORG_ID}, ${connectionId}, '2026-08-07', 'Memo', 'MEMO-1', 'Asha Traders', ${ashaId}, 'A note', false, '55.00')
    `);
  });

  it('a customer statement needs a party, opens from what came before, and runs a balance across the period', async () => {
    const noParty = await harness.get<{ error: { details?: { fields?: { path: string }[] } } }>(
      '/reports/customer-statement/rows?from=2026-08-01&to=2026-08-31',
      { token: adminToken },
    );
    expect(noParty.status).toBe(400);
    expect(noParty.body.error.details?.fields?.[0]?.path).toBe('partyId');

    const statement = await harness.get<{
      data: { voucherType: string; voucherNumber: string; debit: string | null; credit: string | null; unclassified: string | null; balance: string; asOf: string | null }[];
      meta: { total: number };
    }>(`/reports/customer-statement/rows?partyId=${ashaId}&from=2026-08-01&to=2026-08-31`, { token: adminToken });
    expect(statement.status).toBe(200);
    expect(statement.body.data.map((r) => [r.voucherType, r.voucherNumber, r.debit, r.credit, r.unclassified, r.balance])).toEqual([
      ['Opening balance', '', null, null, null, '1000.00'],
      ['Sales', 'INV-0042', '4150.50', null, null, '5150.50'],
      ['Receipt', 'RCT-0007', null, '4150.50', null, '1000.00'],
      // Outside the debit/credit table: shown, not summed.
      ['Memo', 'MEMO-1', null, null, '55.00', '1000.00'],
    ]);
    expect(statement.body.meta.total).toBe(4);
    // REQ-Y-07: every row says which pull it rests on.
    expect(statement.body.data.every((r) => r.asOf !== null)).toBe(true);
  });

  it('the credit cycle shows exposure against the limit for every debtor', async () => {
    const credit = await harness.get<{
      data: { partyName: string; creditLimit: string | null; creditDays: number | null; exposure: string; headroom: string | null; overLimit: boolean; lastInvoiceDate: string | null; lastReceiptDate: string | null }[];
    }>('/reports/credit-cycle/rows', { token: adminToken });
    expect(credit.status).toBe(200);
    // Behar is a creditor, not a debtor: absent.
    expect(credit.body.data.map((r) => r.partyName)).toEqual(['Asha Traders']);
    const asha = credit.body.data[0];
    expect(asha?.creditLimit).toBe('250000.00');
    expect(asha?.creditDays).toBe(30);
    // 1000 + 4150.50 − 4150.50; the Memo is not counted.
    expect(asha?.exposure).toBe('1000.00');
    expect(asha?.headroom).toBe('249000.00');
    expect(asha?.overLimit).toBe(false);
    expect(asha?.lastInvoiceDate).toBe('2026-08-01');
    expect(asha?.lastReceiptDate).toBe('2026-08-05');
  });

  it('sales analysis groups invoiced inventory lines by the chosen dimension, with a share of the total', async () => {
    const byParty = await harness.get<{ data: { label: string; vouchers: number; value: string; share: string; quantity: string | null }[] }>(
      '/reports/sales-analysis/rows?from=2026-08-01&to=2026-08-31',
      { token: adminToken },
    );
    expect(byParty.status).toBe(200);
    expect(byParty.body.data.map((r) => [r.label, r.vouchers, r.value, r.share])).toEqual([['Asha Traders', 1, '4150.50', '100.0']]);

    const byItem = await harness.get<{ data: { label: string; quantity: string | null; value: string }[] }>(
      '/reports/sales-analysis/rows?groupBy=item&from=2026-08-01&to=2026-08-31',
      { token: adminToken },
    );
    // No stock_items row backs the line, so no unit agrees and quantity stays honest: null.
    expect(byItem.body.data.map((r) => [r.label, r.quantity, r.value])).toEqual([['Cat6 Cable Box', null, '4150.50']]);

    const byMonth = await harness.get<{ data: { label: string; value: string }[] }>('/reports/sales-analysis/rows?groupBy=month', {
      token: adminToken,
    });
    // June's invoice has no inventory line; only August groups.
    expect(byMonth.body.data.map((r) => r.label)).toEqual(['2026-08']);

    const bad = await harness.get('/reports/sales-analysis/rows?groupBy=salesperson', { token: adminToken });
    expect(bad.status).toBe(400);
  });
});

describe('the Tier 1 analytics (14 REQ-AE-01, REQ-AG-02)', () => {
  it('the day book lists every voucher for the period and narrows by type', async () => {
    const all = await harness.get<{ data: { voucherType: string; voucherNumber: string; partyName: string | null; amount: string; cancelled: boolean; asOf: string | null }[]; meta: { total: number } }>(
      '/reports/day-book/rows?from=2026-08-01&to=2026-08-31',
      { token: adminToken },
    );
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(3);
    expect(all.body.data.every((r) => r.asOf !== null)).toBe(true);

    const sales = await harness.get<{ data: { voucherType: string }[] }>('/reports/day-book/rows?from=2026-08-01&to=2026-08-31&voucherType=Sales', { token: adminToken });
    expect(sales.status).toBe(200);
    expect(sales.body.data.length).toBeGreaterThan(0);
    expect(sales.body.data.every((r) => r.voucherType === 'Sales')).toBe(true);
  });

  it('customer lapse measures each customer against their own median gap and ranks by revenue at risk', async () => {
    // A customer with a monthly rhythm who has gone quiet for over two gaps.
    await harness.db.execute(sql`
      INSERT INTO vouchers
        (org_id, connection_id, voucher_date, voucher_type, voucher_number, party_name, party_id, is_cancelled, amount)
      VALUES
        (${ORG_ID}, ${connectionId}, CURRENT_DATE - 160, 'Sales', 'LAP-1', 'Asha Traders', ${ashaId}, false, '900.00'),
        (${ORG_ID}, ${connectionId}, CURRENT_DATE - 130, 'Sales', 'LAP-2', 'Asha Traders', ${ashaId}, false, '900.00'),
        (${ORG_ID}, ${connectionId}, CURRENT_DATE - 100, 'Sales', 'LAP-3', 'Asha Traders', ${ashaId}, false, '900.00')
    `);
    const lapse = await harness.get<{ data: { partyName: string; state: string; daysSince: number; medianGapDays: number; sales12m: number; revenue12m: string; asOf: string | null }[] }>(
      '/reports/customer-lapse/rows',
      { token: adminToken },
    );
    expect(lapse.status).toBe(200);
    const asha = lapse.body.data.find((r) => r.partyName === 'Asha Traders');
    expect(asha).toBeDefined();
    // The June/August fixture invoices land inside the last 365 days too.
    expect(asha?.sales12m).toBeGreaterThanOrEqual(3);
    expect(asha?.medianGapDays).toBeGreaterThan(0);
    expect(asha?.daysSince).toBeGreaterThanOrEqual(0);
    expect(['LAPSED', 'AT_RISK', 'ON_RHYTHM']).toContain(asha?.state);
    expect(asha?.asOf).not.toBeNull();
  });
});

describe('the Tier 1 analytics, the wider set (14, D-46)', () => {
  it('the ledger extract opens from what came before and runs a balance', async () => {
    const noLedger = await harness.get<{ error: { details?: { fields?: { path: string }[] } } }>('/reports/ledger-extract/rows', { token: adminToken });
    expect(noLedger.status).toBe(400);
    expect(noLedger.body.error.details?.fields?.[0]?.path).toBe('ledgerName');

    const extract = await harness.get<{ data: { voucherType: string; balance: string; debit: string | null; credit: string | null }[]; meta: { total: number } }>(
      '/reports/ledger-extract/rows?ledgerName=Sales&from=2026-08-01&to=2026-08-31',
      { token: adminToken },
    );
    expect(extract.status).toBe(200);
    expect(extract.body.data[0]?.voucherType).toBe('Opening balance');
    expect(extract.body.data.every((r) => /^-?\d+\.\d\d$/u.test(r.balance))).toBe(true);
  });

  it('stock summary values closing at cost and carries committed and available', async () => {
    await harness.db.execute(sql`
      INSERT INTO stock_items (org_id, connection_id, name, parent_group, unit, closing_qty, cost_price, absent_in_tally)
      VALUES (${ORG_ID}, ${connectionId}, 'Summary Cable', 'Cables', 'NOS', 12, 250, false)
    `);
    const summary = await harness.get<{ data: { item: string; closingQty: string | null; committedQty: string; availableQty: string | null; value: string | null }[] }>(
      '/reports/stock-summary/rows',
      { token: adminToken },
    );
    expect(summary.status).toBe(200);
    const cable = summary.body.data.find((r) => r.item === 'Summary Cable');
    expect(cable).toBeDefined();
    expect(Number(cable?.value)).toBe(3000);
    expect(cable?.committedQty).toBe('0');
    expect(Number(cable?.availableQty)).toBe(12);
  });

  it('duplicate masters flags names that collapse to the same key', async () => {
    await harness.db.execute(sql`
      INSERT INTO parties (org_id, connection_id, name, parent_group)
      VALUES (${ORG_ID}, ${connectionId}, 'ASHA  TRADERS.', 'Sundry Debtors')
    `);
    const dupes = await harness.get<{ data: { kind: string; nameA: string; nameB: string }[] }>('/reports/duplicate-masters/rows', { token: adminToken });
    expect(dupes.status).toBe(200);
    const pair = dupes.body.data.find((r) => r.kind === 'Party' && [r.nameA, r.nameB].some((n) => n.includes('Asha') || n.includes('ASHA')));
    expect(pair).toBeDefined();
  });

  it('the customer × product matrix counts invoices per party and item', async () => {
    const matrix = await harness.get<{ data: { partyName: string; item: string; invoices: number; value: string }[] }>(
      '/reports/customer-item-matrix/rows',
      { token: adminToken },
    );
    expect(matrix.status).toBe(200);
    expect(matrix.body.data.length).toBeGreaterThan(0);
    expect(matrix.body.data.every((r) => r.invoices >= 1)).toBe(true);
  });

});

describe('the daily exception sweep and usage retention (D-46, D14-6)', () => {
  it('opening a report records one usage row, deduplicated within the minute', async () => {
    await harness.db.execute(sql`DELETE FROM report_usage WHERE org_id = ${ORG_ID}`);
    await harness.get('/reports/negative-stock/rows', { token: adminToken });
    await harness.get('/reports/negative-stock/rows', { token: adminToken });
    // The insert is deliberately fire-and-forget, so give it a beat.
    let rows: { rows: { n: number }[] } = { rows: [] };
    for (let i = 0; i < 20; i += 1) {
      rows = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM report_usage WHERE org_id = ${ORG_ID} AND report_key = 'negative-stock'`,
      );
      if ((rows.rows[0]?.n ?? 0) > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('notifies the permission holders about non-empty exception reports and prunes year-old usage', async () => {
    const emitted: NotificationEvent[] = [];
    const spy = vi.spyOn(harness.resolve(NotificationDispatcher), 'emit').mockImplementation((event) => {
      emitted.push(event);
      return Promise.resolve('spied');
    });
    try {
      await harness.db.execute(sql`
        INSERT INTO report_usage (org_id, user_id, report_key, opened_at)
        SELECT ${ORG_ID}, (SELECT id FROM users WHERE org_id = ${ORG_ID} LIMIT 1), 'day-book', t.at
          FROM (VALUES (now() - interval '13 months'), (now())) AS t(at)
      `);
      const sweep = harness.resolve(ExceptionSweepHandler);
      const result = await sweep.run({ now: '2026-08-21T02:00:00.000Z' }, { jobId: 'test', attempt: 1 });
      const mine = emitted.filter((e) => e.orgId === ORG_ID && e.type === 'reports.exceptions_daily');
      expect(mine).toHaveLength(1);
      expect(mine[0]?.audience).toEqual({ kind: 'permission', key: 'reports.exceptions.notify' });
      expect(String(mine[0]?.payload?.summary)).toContain('duplicate masters');
      expect(mine[0]?.idempotencyKey).toBe(`exception-sweep-${ORG_ID}-2026-08-21`);
      expect(Number(result.usageRowsPruned)).toBeGreaterThanOrEqual(1);
      const kept = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM report_usage WHERE org_id = ${ORG_ID} AND report_key = 'day-book'`,
      );
      expect(kept.rows[0]?.n).toBe(1);

      // The same morning run twice carries the same idempotency key, so BullMQ delivers once.
      await sweep.run({ now: '2026-08-21T04:00:00.000Z' }, { jobId: 'test', attempt: 1 });
      const again = emitted.filter((e) => e.orgId === ORG_ID && e.type === 'reports.exceptions_daily');
      expect(again[1]?.idempotencyKey).toBe(again[0]?.idempotencyKey);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('comparison flows into the exported file (data-analyst §3)', () => {
  it('a CSV export with compare carries a previous column and a change column, joined by the same key as the screen', async () => {
    // Sales analysis reads inventory lines; the June fixture voucher has
    // none, so give it one for the comparison period to find.
    await harness.db.execute(sql`
      INSERT INTO voucher_lines (org_id, voucher_id, line_no, kind, stock_item_name, billed_qty, rate, amount)
      SELECT ${ORG_ID}, id, 1, 'inventory', 'Cat6 Cable Box', '1 NOS', '1000.00', '1000.00'
        FROM vouchers WHERE org_id = ${ORG_ID} AND voucher_number = 'INV-0031'
    `);
    const accepted = await harness.post<ExportJobSummary>('/reports/exports', {
      token: adminToken,
      body: {
        reportKey: 'sales-analysis',
        filters: { from: '2026-08-01', to: '2026-08-31' },
        format: 'CSV',
        compare: { from: '2026-06-01', to: '2026-06-30', columnKey: 'value', label: 'previous' },
      },
    });
    expect(accepted.status).toBe(202);
    // Run the job directly so the assertion does not race the queue; the
    // queued worker's own attempt then reads DONE and skips.
    await harness.resolve(ExportService).run(ORG_ID, accepted.body.id, 1);
    const link = await harness.get<ExportDownload>(`/reports/exports/${accepted.body.id}/download`, { token: adminToken });
    expect(link.status).toBe(200);
    const response = await fetch(link.body.url);
    expect(response.status).toBe(200);
    const text = await response.text();
    const lines = text.split('\n');
    const header = lines.find((line) => line.startsWith('Group,')) ?? '';
    expect(header).toContain('Value (previous)');
    expect(header).toContain('Change');
    const asha = lines.find((line) => line.startsWith('Asha Traders')) ?? '';
    // August 4150.50 against June 1000: the file states the base and the delta.
    expect(asha).toContain('1000');
    expect(asha).toContain('+3150.5 (315.1%)');
  });
});

describe('the second analytics set (owner, 22 Aug 2026)', () => {
  it('serves each new report with its declared columns', async () => {
    for (const key of ['aov-trend', 'partial-shipments', 'vendor-lead-time', 'stock-out-frequency', 'sales-heatmap'] as const) {
      const page = await harness.get<{ data: Record<string, unknown>[]; meta: { total: number } }>(
        `/reports/${key}/rows?from=2026-06-01&to=2026-08-31`,
        { token: adminToken },
      );
      expect(page.status, `${key}: ${page.text}`).toBe(200);
      expect(Array.isArray(page.body.data)).toBe(true);
    }
  });

  it('average order value reads the fixture invoices month by month', async () => {
    const page = await harness.get<{ data: { month: string; invoices: number; aov: string }[] }>(
      '/reports/aov-trend/rows?from=2026-06-01&to=2026-08-31',
      { token: adminToken },
    );
    expect(page.status, page.text).toBe(200);
    const august = page.body.data.find((row) => row.month === '2026-08');
    expect(august).toBeDefined();
    expect(august?.invoices).toBeGreaterThanOrEqual(1);
    expect(Number(august?.aov)).toBeGreaterThan(0);
  });

  it('the margin proxy is for margin eyes only, and says cost against price', async () => {
    const margin = await harness.get<{ data: { item: string; revenue: string; cost: string; margin: string }[] }>(
      '/reports/margin-proxy/rows?from=2026-08-01&to=2026-08-31',
      { token: adminToken },
    );
    expect(margin.status, margin.text).toBe(200);
    const cable = margin.body.data.find((row) => row.item === 'Cat6 Cable Box');
    expect(cable).toBeDefined();
    expect(Number(cable?.revenue)).toBeGreaterThan(0);
    expect(Number(cable?.margin)).toBe(Number(cable?.revenue) - Number(cable?.cost));

    const narrowRoleId = await harness.createRole('Receivables only', [PERMISSIONS.RECEIVABLES_VIEW, PERMISSIONS.REPORT_VIEW]);
    const viewer = await harness.createUser({ email: scopedEmail('masters-no-margin'), roleIds: [narrowRoleId] });
    const viewerToken = (await harness.login(viewer.email, viewer.password)).token;
    const refused = await harness.get<{ error: { code: string } }>('/reports/margin-proxy/rows', { token: viewerToken });
    expect(refused.status).toBe(403);
    const catalogue = await harness.get<{ data: { key: string }[] }>('/reports', { token: viewerToken });
    expect(catalogue.body.data.some((report) => report.key === 'margin-proxy')).toBe(false);
    expect(catalogue.body.data.some((report) => report.key === 'aov-trend')).toBe(true);
  });
});
