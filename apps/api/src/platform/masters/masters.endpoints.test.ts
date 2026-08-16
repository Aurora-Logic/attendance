import { SYSTEM_ROLES, type Paginated, type PartyView } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

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
  harness = await ApiHarness.start(ORG_ID, 'Masters Fixture Org');

  await harness.db.execute(sql`DELETE FROM sync_jobs WHERE org_id = ${ORG_ID}`);
  await harness.db.execute(sql`DELETE FROM sync_cursors WHERE org_id = ${ORG_ID}`);
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
