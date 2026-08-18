import { PERMISSIONS, SYSTEM_ROLES, type GoToResponse } from '@vyuha/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * REQ-O-05 over real HTTP: the record index behind Alt+G.
 *
 * The assertions that matter most are the two negative ones. A manager with
 * team breadth searching a name that matches two people must receive only the
 * one inside their team — Go To must not become the endpoint that leaks the
 * register's scope rule. And a caller holding no `employee.view` at all must
 * receive a well-formed empty answer, because the source is filtered out
 * before it is queried, not after.
 */

// `…b9` looked free but was seed.test.ts's TEST_ORG_ID — invisible to the
// org-ids check, which then scanned only src/ and matched only ORG_ID by
// name. Four fixture employees leaked into the seed's counts and failed
// three of its assertions, identically on two runs. Both blind spots are
// closed in org-ids.test.ts; this id is registered there like every other.
const ORG_ID = '01900000-0000-7000-8000-0000000000ba';

let harness: ApiHarness;
let adminToken: string;
let managerToken: string;
let punchOnlyToken: string;

let reportEmployeeId = '';

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Go To Fixture Org');

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  // The register's read key and nothing that widens it, so breadth stays team.
  const viewerRoleId = await harness.createRole('Go To Viewer', [PERMISSIONS.EMPLOYEE_VIEW]);
  const punchOnlyRoleId = await harness.createRole('Go To Punch Only', [PERMISSIONS.PUNCH_SELF]);

  const managerEmployeeId = await harness.createEmployee({
    code: 'GTO-0001',
    firstName: 'Meera',
    lastName: 'Krishnan',
  });
  reportEmployeeId = await harness.createEmployee({
    code: 'GTO-0102',
    firstName: 'Kavya',
    lastName: 'Nair',
    reportingManagerId: managerEmployeeId,
  });
  // Same first name as the report, outside the manager's team: the scope probe.
  await harness.createEmployee({
    code: 'GTO-0900',
    firstName: 'Kavya',
    lastName: 'Pillai',
  });
  await harness.createEmployee({
    code: 'GTO-0500',
    firstName: 'Retired',
    lastName: 'Person',
    status: 'INACTIVE',
  });

  const admin = await harness.createUser({
    email: scopedEmail('goto-admin'),
    roleIds: [adminRoleId],
  });
  const manager = await harness.createUser({
    email: scopedEmail('goto-manager'),
    roleIds: [viewerRoleId],
    employeeId: managerEmployeeId,
  });
  const punchOnly = await harness.createUser({
    email: scopedEmail('goto-punch-only'),
    roleIds: [punchOnlyRoleId],
  });

  adminToken = (await harness.login(admin.email, admin.password)).token;
  managerToken = (await harness.login(manager.email, manager.password)).token;
  punchOnlyToken = (await harness.login(punchOnly.email, punchOnly.password)).token;
});

afterAll(async () => {
  await harness.close();
});

function search(q: string, token: string) {
  return harness.get<GoToResponse>(`/go-to?q=${encodeURIComponent(q)}`, { token });
}

describe('GET /go-to', () => {
  it('refuses an unauthenticated caller', async () => {
    const response = await harness.get('/go-to?q=kavya');
    expect(response.status).toBe(401);
  });

  it('finds an employee by exact code, ranked first', async () => {
    const response = await search('gto-0102', adminToken);
    expect(response.status).toBe(200);
    const first = response.body.records[0];
    expect(first?.type).toBe('employee');
    expect(first?.id).toBe(reportEmployeeId);
    expect(first?.title).toBe('Kavya Nair');
    expect(first?.code).toBe('GTO-0102');
  });

  it('finds employees by name fragment', async () => {
    const response = await search('krishn', adminToken);
    expect(response.status).toBe(200);
    expect(response.body.records.map((r) => r.title)).toContain('Meera Krishnan');
  });

  it('scopes a team-breadth caller to their own team (the register rule, not a copy)', async () => {
    const response = await search('kavya', managerToken);
    expect(response.status).toBe(200);
    const titles = response.body.records.map((r) => r.title);
    expect(titles).toContain('Kavya Nair');
    expect(titles).not.toContain('Kavya Pillai');
  });

  it('an admin searching the same term sees both, so the narrowing above is scope and not data', async () => {
    const response = await search('kavya', adminToken);
    const titles = response.body.records.map((r) => r.title);
    expect(titles).toContain('Kavya Nair');
    expect(titles).toContain('Kavya Pillai');
  });

  it('answers empty, not 403, for a caller whose permissions reach no source', async () => {
    const response = await search('kavya', punchOnlyToken);
    expect(response.status).toBe(200);
    expect(response.body.records).toEqual([]);
  });

  it('answers empty below the minimum query length instead of matching half the organisation', async () => {
    const response = await search('k', adminToken);
    expect(response.status).toBe(200);
    expect(response.body.records).toEqual([]);
  });

  it('treats SQL wildcards as text, so "%" finds nobody rather than everybody', async () => {
    const response = await search('%%%', adminToken);
    expect(response.status).toBe(200);
    expect(response.body.records).toEqual([]);
  });

  it('still finds a retired employee, saying so rather than hiding them', async () => {
    const response = await search('gto-0500', adminToken);
    const first = response.body.records[0];
    expect(first?.title).toBe('Retired Person');
    expect(first?.subtitle).toContain('INACTIVE');
  });
});
