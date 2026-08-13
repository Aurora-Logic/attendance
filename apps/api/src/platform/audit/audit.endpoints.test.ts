import { SYSTEM_ROLES, type CursorPaginated, type DepartmentSummary } from '@vyuha/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import type { AuditFacets, AuditLogEntryView } from './audit-log.service.js';

/**
 * `GET /audit-logs` (REQ-M-02) over real HTTP.
 *
 * `audit_logs` is append-only and `resetOrganisation` therefore cannot clear
 * it, so this organisation accumulates rows across runs. Every assertion below
 * is written against ids created *by this run* rather than against "the first
 * row" or "the total count", which would pass once and then drift.
 */

const ORG_ID = '01900000-0000-7000-8000-00000000005a';

interface ErrorBody {
  error: { code: string; message: string };
}

type Page = CursorPaginated<AuditLogEntryView>;

let harness: ApiHarness;
let adminToken: string;
let hrToken: string;
let adminUserId = '';
let firstDepartmentId = '';
let secondDepartmentId = '';

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Audit Viewer Fixture Org');

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN);
  const hrRoleId = await harness.createSystemRole(SYSTEM_ROLES.HR);

  const employeeId = await harness.createEmployee({
    code: 'AUD-0001',
    firstName: 'Devika',
    lastName: 'Menon',
  });

  const admin = await harness.createUser({
    email: scopedEmail('audit-admin'),
    roleIds: [adminRoleId],
    employeeId,
  });
  const hr = await harness.createUser({ email: scopedEmail('audit-hr'), roleIds: [hrRoleId] });

  adminUserId = admin.id;
  adminToken = (await harness.login(admin.email, admin.password)).token;
  hrToken = (await harness.login(hr.email, hr.password)).token;
  expect(adminToken).not.toBe('');

  // Two writes this run, so ordering and paging have something of this run's
  // own to assert against.
  const first = await harness.post<DepartmentSummary>('/departments', {
    token: adminToken,
    body: { name: 'Audit Fixture One', code: 'AUD-ONE' },
  });
  expect(first.status, first.text).toBe(201);
  firstDepartmentId = first.body.id;

  const second = await harness.post<DepartmentSummary>('/departments', {
    token: adminToken,
    body: { name: 'Audit Fixture Two', code: 'AUD-TWO' },
  });
  expect(second.status, second.text).toBe(201);
  secondDepartmentId = second.body.id;

  const renamed = await harness.patch<DepartmentSummary>(`/departments/${firstDepartmentId}`, {
    token: adminToken,
    body: { name: 'Audit Fixture One Renamed' },
  });
  expect(renamed.status, renamed.text).toBe(200);

  expect(await harness.waitForAuditEntity(secondDepartmentId)).toBe(true);
  // The rename is the last write; without waiting for it the diff assertion
  // below races the interceptor, which deliberately does not block the
  // response on the insert.
  await waitForActions(firstDepartmentId, 2);
}, 40_000);

afterAll(async () => {
  await harness.close();
});

async function waitForActions(entityId: string, wanted: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const page = await harness.get<Page>(`/audit-logs?entityId=${entityId}&limit=10`, {
      token: adminToken,
    });
    if (page.body.data.length >= wanted) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Only ${String(page.body.data.length)} audit rows for ${entityId} after 5s; expected ${String(wanted)}.`,
      );
    }
    await new Promise((done) => setTimeout(done, 50));
  }
}

describe('access', () => {
  it('is refused to a role without audit.view', async () => {
    const denied = await harness.get<ErrorBody>('/audit-logs', { token: hrToken });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('is refused without a token', async () => {
    const anonymous = await harness.get<ErrorBody>('/audit-logs');
    expect(anonymous.status).toBe(401);
  });

  it('exposes no way to write', async () => {
    // REQ-M-01 is enforced by the migration's REVOKE and by there being one
    // writer in the process. This asserts the third leg: no route.
    const posted = await harness.post<ErrorBody>('/audit-logs', {
      token: adminToken,
      body: { action: 'forged' },
    });
    expect(posted.status).toBe(404);

    const patched = await harness.patch<ErrorBody>(`/audit-logs/${firstDepartmentId}`, {
      token: adminToken,
      body: { action: 'forged' },
    });
    expect(patched.status).toBe(404);

    const deleted = await harness.request<ErrorBody>('DELETE', '/audit-logs', {
      token: adminToken,
    });
    expect(deleted.status).toBe(404);
  });
});

describe('the trail (REQ-M-01, REQ-M-02)', () => {
  it('names the actor and resolves the employee behind the account', async () => {
    const page = await harness.get<Page>(`/audit-logs?entityId=${secondDepartmentId}`, {
      token: adminToken,
    });

    expect(page.status, page.text).toBe(200);
    expect(page.body.data).toHaveLength(1);

    const entry = page.body.data[0];
    expect(entry?.action).toBe('department.created');
    expect(entry?.entityType).toBe('department');
    expect(entry?.actor?.id).toBe(adminUserId);
    expect(entry?.actor?.name).toBe('Devika Menon');
    expect(entry?.impersonator).toBeNull();
    expect(entry?.requestId).toBeTruthy();
  });

  it('carries the before and after of an update', async () => {
    const page = await harness.get<Page>(
      `/audit-logs?entityId=${firstDepartmentId}&action=department.updated`,
      { token: adminToken },
    );

    expect(page.body.data.length).toBeGreaterThanOrEqual(1);
    const entry = page.body.data[0];
    // REQ-M-01's diff, already narrowed to the fields that moved.
    expect(entry?.before).toMatchObject({ name: 'Audit Fixture One' });
    expect(entry?.after).toMatchObject({ name: 'Audit Fixture One Renamed' });
  });

  it('returns the newest first', async () => {
    const page = await harness.get<Page>('/audit-logs?limit=20', { token: adminToken });

    const times = page.body.data.map((entry) => Date.parse(entry.createdAt));
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  it('filters by action', async () => {
    const page = await harness.get<Page>('/audit-logs?action=department.created&limit=50', {
      token: adminToken,
    });

    expect(page.body.data.length).toBeGreaterThan(0);
    expect(page.body.data.every((entry) => entry.action === 'department.created')).toBe(true);
  });

  it('filters by entity type', async () => {
    const page = await harness.get<Page>('/audit-logs?entityType=department&limit=50', {
      token: adminToken,
    });

    expect(page.body.data.length).toBeGreaterThan(0);
    expect(page.body.data.every((entry) => entry.entityType === 'department')).toBe(true);
  });

  it('filters by instant, and excludes what falls outside', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const empty = await harness.get<Page>(`/audit-logs?from=${encodeURIComponent(future)}`, {
      token: adminToken,
    });
    expect(empty.body.data).toEqual([]);

    // The control: the same filter with a sane lower bound is not empty, so
    // the assertion above is about the filter rather than about an empty table.
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const filled = await harness.get<Page>(`/audit-logs?from=${encodeURIComponent(past)}`, {
      token: adminToken,
    });
    expect(filled.body.data.length).toBeGreaterThan(0);
  });
});

describe('cursor paging', () => {
  it('walks the trail without repeating or skipping a row', async () => {
    const first = await harness.get<Page>('/audit-logs?limit=2', { token: adminToken });
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.hasMore).toBe(true);
    expect(first.body.meta.nextCursor).toBeTruthy();

    const second = await harness.get<Page>(
      `/audit-logs?limit=2&cursor=${encodeURIComponent(first.body.meta.nextCursor ?? '')}`,
      { token: adminToken },
    );

    const firstIds = first.body.data.map((entry) => entry.id);
    const secondIds = second.body.data.map((entry) => entry.id);

    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    // And the two pages are contiguous: everything on page two is older than
    // everything on page one, which is what "no skipping" means for a keyset.
    const oldestOnFirst = Math.min(...first.body.data.map((e) => Date.parse(e.createdAt)));
    const newestOnSecond = Math.max(...second.body.data.map((e) => Date.parse(e.createdAt)));
    expect(newestOnSecond).toBeLessThanOrEqual(oldestOnFirst);
  });

  it('refuses a cursor it did not issue', async () => {
    const rejected = await harness.get<ErrorBody>('/audit-logs?cursor=not-a-real-cursor', {
      token: adminToken,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('caps the page size rather than honouring it', async () => {
    const rejected = await harness.get<ErrorBody>('/audit-logs?limit=5000', {
      token: adminToken,
    });
    expect(rejected.status).toBe(400);
  });
});

describe('facets', () => {
  it('list the actions and entity types actually present', async () => {
    const facets = await harness.get<AuditFacets>('/audit-logs/facets', { token: adminToken });

    expect(facets.status, facets.text).toBe(200);
    expect(facets.body.actions).toContain('department.created');
    expect(facets.body.entityTypes).toContain('department');
  });

  it('are refused to a role without audit.view', async () => {
    const denied = await harness.get<ErrorBody>('/audit-logs/facets', { token: hrToken });
    expect(denied.status).toBe(403);
  });
});
