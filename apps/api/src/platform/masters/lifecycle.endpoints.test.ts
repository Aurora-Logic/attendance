import { SYSTEM_ROLES, type ItemLifecycle, type PartyLifecycle } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * Owner, 22 Aug 2026: the life of an item and of a party over real HTTP.
 * One confirmed order is enough to prove the joins: it shows up in both
 * lifecycles with its number and its door, the figures count it, and a
 * person without the masters key is refused.
 */
const ORG_ID = '01900000-0000-7000-8000-00000000f0cc';

let harness: ApiHarness;
let adminToken = '';
let employeeToken = '';
let partyId = '';
let itemId = '';
let orderId = '';

interface SalesDocumentView {
  id: string;
  number: string;
  status: string;
}
interface ErrorBody {
  error: { code: string };
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Lifecycle Org');
  await harness.db.execute(sql`DELETE FROM stock_items WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM parties WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`UPDATE integration_connections SET deleted_at = now() WHERE org_id = ${ORG_ID} AND deleted_at IS NULL`);

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE, { isSystem: true });
  const admin = await harness.createUser({ email: scopedEmail('lifecycle-admin'), roleIds: [adminRoleId] });
  const employee = await harness.createUser({ email: scopedEmail('lifecycle-employee'), roleIds: [employeeRoleId] });
  adminToken = (await harness.login(admin.email, admin.password)).token;
  employeeToken = (await harness.login(employee.email, employee.password)).token;

  const connection = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO integration_connections (org_id, system, name, company_guid) VALUES (${ORG_ID}, 'TALLY', 'Lifecycle Co', 'guid-lifecycle-co') RETURNING id
  `);
  const connectionId = connection.rows[0]?.id ?? '';
  const party = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO parties (org_id, connection_id, name, parent_group) VALUES (${ORG_ID}, ${connectionId}, 'Asha Traders', 'Sundry Debtors') RETURNING id
  `);
  partyId = party.rows[0]?.id ?? '';
  const item = await harness.db.execute<{ id: string }>(sql`
    INSERT INTO stock_items (org_id, connection_id, name, unit, parent_group, gst_rate) VALUES (${ORG_ID}, ${connectionId}, 'Cat6 cable 305m', 'BOX', 'Cables', '18.00') RETURNING id
  `);
  itemId = item.rows[0]?.id ?? '';

  const created = await harness.post<SalesDocumentView>('/sales/orders', { token: adminToken, body: { partyId, lines: [{ stockItemId: itemId, quantity: '2', rate: '4000' }] } });
  expect(created.status).toBe(201);
  orderId = created.body.id;
  const confirmed = await harness.post<SalesDocumentView>(`/sales/orders/${orderId}/confirm`, { token: adminToken });
  expect([200, 201]).toContain(confirmed.status);
});

afterAll(async () => {
  await harness.close();
});

describe('GET /masters/items/:id/lifecycle', () => {
  it('counts the confirmed order and lists it with a door', async () => {
    const res = await harness.get<ItemLifecycle>(`/masters/items/${itemId}/lifecycle`, { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.body.item.name).toBe('Cat6 cable 305m');
    expect(Number(res.body.figures.ordered)).toBe(2);
    expect(res.body.figures.openOrders).toBe(1);
    expect(res.body.customers[0]?.name).toBe('Asha Traders');
    const order = res.body.events.find((event) => event.kind === 'order');
    expect(order?.href).toBe(`/sales/orders/${orderId}`);
    expect(order?.quantity).not.toBeNull();
  });

  it('answers 404 for an item that is not there and 403 without the masters key', async () => {
    const missing = await harness.get<ErrorBody>('/masters/items/01900000-0000-7000-8000-0000000000ff/lifecycle', { token: adminToken });
    expect(missing.status).toBe(404);
    const refused = await harness.get<ErrorBody>(`/masters/items/${itemId}/lifecycle`, { token: employeeToken });
    expect(refused.status).toBe(403);
  });
});

describe('GET /masters/parties/:id/lifecycle', () => {
  it('reads the party as a customer with one open order', async () => {
    const res = await harness.get<PartyLifecycle>(`/masters/parties/${partyId}/lifecycle`, { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('customer');
    expect(res.body.figures.orders).toBe(1);
    expect(res.body.figures.openOrders).toBe(1);
    expect(res.body.figures.purchaseOrders).toBe(0);
    expect(res.body.events.some((event) => event.kind === 'order' && event.href === `/sales/orders/${orderId}`)).toBe(true);
  });
});
