import { SYSTEM_ROLES } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';

/**
 * Owner, 22 Aug 2026: packing an order nobody had picked answered "Packing
 * failed. Something went wrong on our side." The database's rule (a line
 * packs only what it has picked) is right; the answer was not. Whatever the
 * service checks first, the person must read a sentence and a 409, never a
 * 500, and the order must be left exactly as it was.
 */
const ORG_ID = '01900000-0000-7000-8000-00000000f0cd';

let harness: ApiHarness;
let adminToken = '';
let orderId = '';
let lineId = '';

interface SalesDocumentView {
  id: string;
  number: string;
  status: string;
  lines: { id: string; quantity: string; packedQty: string }[];
}
interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Pack Before Pick Org');
  await harness.db.execute(sql`DELETE FROM stock_items WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM parties WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`UPDATE integration_connections SET deleted_at = now() WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`);

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const admin = await harness.createUser({ email: scopedEmail('pack-before-pick-admin'), roleIds: [adminRoleId] });
  adminToken = (await harness.login(admin.email, admin.password)).token;

  const connection = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO integration_connections (org_id, system, name, company_guid) VALUES (${ORG_ID}, 'TALLY', 'Pack Co', 'guid-pack-before-pick') RETURNING id
  `);
  const connectionId = connection.rows[0]?.id ?? '';
  const party = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO parties (org_id, connection_id, name, parent_group) VALUES (${ORG_ID}, ${connectionId}, 'Unpicked Traders', 'Sundry Debtors') RETURNING id
  `);
  const item = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO stock_items (org_id, connection_id, name, unit, parent_group, gst_rate) VALUES (${ORG_ID}, ${connectionId}, 'Cat6 cable 305m', 'BOX', 'Cables', '18.00') RETURNING id
  `);

  const created = await harness.post<SalesDocumentView>('/sales/orders', { token: adminToken, body: { partyId: party.rows[0]?.id ?? '', lines: [{ stockItemId: item.rows[0]?.id ?? '', quantity: '5', rate: '4000' }] } });
  expect(created.status).toBe(201);
  orderId = created.body.id;
  const confirmed = await harness.post<SalesDocumentView>(`/sales/orders/${orderId}/confirm`, { token: adminToken });
  expect([200, 201]).toContain(confirmed.status);
  const order = await harness.get<SalesDocumentView>(`/sales/orders/${orderId}`, { token: adminToken });
  lineId = order.body.lines[0]?.id ?? '';
  expect(lineId).not.toBe('');
});

afterAll(async () => {
  await harness.close();
});

describe('POST /sales/orders/:id/packs before any pick', () => {
  it('is refused with a sentence and a 409, and nothing moves', async () => {
    const res = await harness.post<ErrorBody>(`/sales/orders/${orderId}/packs`, { token: adminToken, body: { boxCount: 1, lines: [{ lineId, quantity: '2' }] } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toMatch(/pick/iu);

    const after = await harness.db.execute<{ packed_qty: string; picked_qty: string; packs: string }>(sql`
      SELECT l.packed_qty, l.picked_qty, (SELECT count(*) FROM pack_records p WHERE p.document_id = ${orderId}) AS packs
        FROM sales_document_lines l WHERE l.id = ${lineId}
    `);
    expect(Number(after.rows[0]?.packed_qty)).toBe(0);
    expect(Number(after.rows[0]?.picked_qty)).toBe(0);
    expect(Number(after.rows[0]?.packs)).toBe(0);
  });
});
