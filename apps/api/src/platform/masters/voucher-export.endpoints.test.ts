import { SYSTEM_ROLES } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * Owner, 22 Aug 2026: a Tally voucher on the organisation's paper. The
 * workbook is the half a test can hold in its hands: it comes back as a
 * spreadsheet for the receivables key, refuses without it, and names a
 * voucher that is not there.
 */
const ORG_ID = '01900000-0000-7000-8000-00000000f0ce';

let harness: ApiHarness;
let adminToken = '';
let employeeToken = '';
let voucherId = '';

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Voucher Paper Org');
  await harness.db.execute(sql`DELETE FROM voucher_lines WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM vouchers WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM parties WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`UPDATE integration_connections SET deleted_at = now() WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`);
  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE, { isSystem: true });
  const admin = await harness.createUser({ email: scopedEmail('voucher-paper-admin'), roleIds: [adminRoleId] });
  const employee = await harness.createUser({ email: scopedEmail('voucher-paper-employee'), roleIds: [employeeRoleId] });
  adminToken = (await harness.login(admin.email, admin.password)).token;
  employeeToken = (await harness.login(employee.email, employee.password)).token;
  const connection = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO integration_connections (org_id, system, name, company_guid) VALUES (${ORG_ID}, 'TALLY', 'Paper Co', 'guid-voucher-paper') RETURNING id
  `);
  const connectionId = connection.rows[0]?.id ?? '';
  const party = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO parties (org_id, connection_id, name, parent_group) VALUES (${ORG_ID}, ${connectionId}, 'Asha Traders', 'Sundry Debtors') RETURNING id
  `);
  const voucher = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO vouchers (org_id, connection_id, alter_id, voucher_date, voucher_type, voucher_number, party_name, party_id, narration, is_cancelled, amount, last_pulled_at)
    VALUES (${ORG_ID}, ${connectionId}, 1, '2026-08-10', 'Sales', 'INV-P1', 'Asha Traders', ${party.rows[0]?.id ?? ''}, 'Against order', false, 9440, now()) RETURNING id
  `);
  voucherId = voucher.rows[0]?.id ?? '';
  await harness.db.execute(sql`
    INSERT INTO voucher_lines (org_id, voucher_id, line_no, kind, ledger_name, is_deemed_positive, amount) VALUES
      (${ORG_ID}, ${voucherId}, 1, 'ledger', 'Asha Traders', true, 9440),
      (${ORG_ID}, ${voucherId}, 2, 'ledger', 'Output CGST', false, -720),
      (${ORG_ID}, ${voucherId}, 3, 'ledger', 'Output SGST', false, -720)
  `);
  await harness.db.execute(sql`
    INSERT INTO voucher_lines (org_id, voucher_id, line_no, kind, stock_item_name, billed_qty, rate, amount)
    VALUES (${ORG_ID}, ${voucherId}, 4, 'inventory', 'Cat6 cable 305m', '2 BOX', 4000, 8000)
  `);
});

afterAll(async () => {
  await harness.close();
});

describe('GET /masters/vouchers/:id/export.xlsx', () => {
  it('answers a workbook for the receivables key', async () => {
    const res = await harness.getRaw(`/masters/vouchers/${voucherId}/export.xlsx`, { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('spreadsheet');
    expect(res.headers.get('content-disposition') ?? '').toContain('.xlsx');
  });

  it('refuses without the key and names a voucher that is not there', async () => {
    const refused = await harness.getRaw(`/masters/vouchers/${voucherId}/export.xlsx`, { token: employeeToken });
    expect(refused.status).toBe(403);
    const missing = await harness.getRaw('/masters/vouchers/01900000-0000-7000-8000-0000000000ff/export.xlsx', { token: adminToken });
    expect(missing.status).toBe(404);
  });
});
