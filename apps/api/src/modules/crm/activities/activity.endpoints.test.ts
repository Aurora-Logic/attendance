import {
  PERMISSIONS,
  SYSTEM_ROLES,
  type ActivityPage,
  type ActivityView,
  type ContactView,
  type DealView,
  type PipelineView,
} from '@vyuha/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../../test-support/api-harness.js';

/**
 * REQ-U-07: the activity log is the audit trail. A logged call is an audit
 * row; the timeline is that record's audit rows, so the system's own events
 * (created, stage changed, won) sit in the same list, in order, with actor.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000e0';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let harness: ApiHarness;
let adminToken: string;
let salesToken: string;
let viewerToken: string;
let contactId = '';
let dealId = '';

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Activities Fixture Org');
  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const salesRoleId = await harness.createRole('Sales', [
    PERMISSIONS.CRM_CONTACT_VIEW_SELF,
    PERMISSIONS.CRM_CONTACT_MANAGE,
    PERMISSIONS.CRM_DEAL_VIEW_SELF,
    PERMISSIONS.CRM_DEAL_MANAGE,
  ]);
  const viewerRoleId = await harness.createRole('Viewer', [PERMISSIONS.CRM_CONTACT_VIEW_ALL, PERMISSIONS.CRM_DEAL_VIEW_ALL]);
  const ravi = await harness.createEmployee({ code: 'ACT-001', firstName: 'Ravi', lastName: 'Kumar' });
  const admin = await harness.createUser({ email: scopedEmail('act-admin'), roleIds: [adminRoleId] });
  const sales = await harness.createUser({ email: scopedEmail('act-sales'), roleIds: [salesRoleId], employeeId: ravi });
  const viewer = await harness.createUser({ email: scopedEmail('act-viewer'), roleIds: [viewerRoleId] });
  adminToken = (await harness.login(admin.email, admin.password)).token;
  salesToken = (await harness.login(sales.email, sales.password)).token;
  viewerToken = (await harness.login(viewer.email, viewer.password)).token;

  const contact = await harness.post<ContactView>('/crm/contacts', { token: salesToken, body: { name: 'Asha Menon' } });
  contactId = contact.body.id;
  const deal = await harness.post<DealView>('/crm/deals', { token: salesToken, body: { name: 'Asha’s first order' } });
  dealId = deal.body.id;
  expect(await harness.waitForAuditAction('crm.deal.created')).toBe(true);
});

afterAll(async () => {
  await harness.close();
});

describe('logging (REQ-U-07)', () => {
  it('a call on a contact is one audit entry, and the timeline shows it above "Created" with the actor', async () => {
    const logged = await harness.post<ActivityView>('/crm/activities', {
      token: salesToken,
      body: { subjectType: 'contact', subjectId: contactId, kind: 'call', body: 'Discussed the Q3 order; wants a revised quote.' },
    });
    expect(logged.status).toBe(201);
    expect(logged.body.kind).toBe('call');
    expect(await harness.waitForAuditAction('crm.activity.call')).toBe(true);

    const page = await harness.get<ActivityPage>(`/crm/activities?subjectType=contact&subjectId=${contactId}`, { token: salesToken });
    expect(page.status).toBe(200);
    expect(page.body.data.map((a) => [a.kind, a.title])).toEqual([
      ['call', 'Call'],
      ['system', 'Created'],
    ]);
    expect(page.body.data[0]?.body).toBe('Discussed the Q3 order; wants a revised quote.');
    expect(page.body.data[0]?.actorName).toBe('Ravi Kumar');
    expect(page.body.nextCursor).toBeNull();
  });

  it('a note logged after the fact keeps its own time apart from when it was recorded', async () => {
    const logged = await harness.post<ActivityView>('/crm/activities', {
      token: salesToken,
      body: { subjectType: 'contact', subjectId: contactId, kind: 'meeting', body: 'Site visit.', occurredAt: '2026-08-10T09:30:00+05:30' },
    });
    expect(logged.status).toBe(201);
    expect(logged.body.occurredAt).toBe('2026-08-10T04:00:00.000Z');
    expect(await harness.waitForAuditAction('crm.activity.meeting')).toBe(true);
    const page = await harness.get<ActivityPage>(`/crm/activities?subjectType=contact&subjectId=${contactId}&limit=1`, { token: salesToken });
    expect(page.body.data[0]?.occurredAt).toBe('2026-08-10T04:00:00.000Z');
    expect(page.body.data[0]?.recordedAt).not.toBe('2026-08-10T04:00:00.000Z');
    expect(page.body.nextCursor).not.toBeNull();

    const next = await harness.get<ActivityPage>(
      `/crm/activities?subjectType=contact&subjectId=${contactId}&limit=5&cursor=${encodeURIComponent(page.body.nextCursor ?? '')}`,
      { token: salesToken },
    );
    expect(next.body.data.map((a) => a.title)).toEqual(['Call', 'Created']);
  });

  it('a deal’s stage moves appear as system entries naming both stages', async () => {
    const pipelines = await harness.get<PipelineView[]>('/crm/pipelines', { token: salesToken });
    const proposal = pipelines.body[0]?.stages.find((s) => s.name === 'Proposal');
    await harness.patch<DealView>(`/crm/deals/${dealId}`, { token: salesToken, body: { stageId: proposal?.id } });
    expect(await harness.waitForAuditAction('crm.deal.stage_changed')).toBe(true);
    await harness.post<ActivityView>('/crm/activities', {
      token: salesToken,
      body: { subjectType: 'deal', subjectId: dealId, kind: 'email', body: 'Sent the proposal PDF.' },
    });
    expect(await harness.waitForAuditAction('crm.activity.email')).toBe(true);

    const page = await harness.get<ActivityPage>(`/crm/activities?subjectType=deal&subjectId=${dealId}`, { token: salesToken });
    expect(page.body.data.map((a) => [a.title, a.body])).toEqual([
      ['Email', 'Sent the proposal PDF.'],
      ['Stage changed', 'Lead → Proposal'],
      ['Created', null],
    ]);
  });

  it('a viewer reads the timeline but cannot log; a stranger cannot read a record they cannot open', async () => {
    const read = await harness.get<ActivityPage>(`/crm/activities?subjectType=contact&subjectId=${contactId}`, { token: viewerToken });
    expect(read.status).toBe(200);
    expect(read.body.data.length).toBeGreaterThan(0);

    const refused = await harness.post<ErrorBody>('/crm/activities', {
      token: viewerToken,
      body: { subjectType: 'contact', subjectId: contactId, kind: 'note', body: 'Nope.' },
    });
    expect(refused.status).toBe(403);

    // The administrator has every key but no employee record: with view.all it sees the contact,
    // so it may log; what it may not do is reach a subject that does not exist.
    const missing = await harness.get<ErrorBody>(`/crm/activities?subjectType=deal&subjectId=01900000-0000-7000-8000-00000000dead`, {
      token: adminToken,
    });
    expect(missing.status).toBe(404);

    const badKind = await harness.post<ErrorBody>('/crm/activities', {
      token: salesToken,
      body: { subjectType: 'contact', subjectId: contactId, kind: 'fax', body: 'x' },
    });
    expect(badKind.status).toBe(400);
  });
});
