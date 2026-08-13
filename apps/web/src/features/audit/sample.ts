import type { AuditFacets, AuditPage } from './types';

/**
 * A short, deterministic trail for a development build with no `/audit-logs`
 * behind it.
 *
 * Deterministic on purpose -- no clock, no randomness. Rows that shuffle on
 * every render make the screen impossible to review and impossible to
 * screenshot twice, and an audit viewer whose contents move is exactly the
 * wrong thing to demonstrate.
 *
 * One page only: `hasMore` is false, so the Load more control correctly does
 * not appear. Faking a second page would make the cursor look tested when it
 * is not.
 */

const ACTOR = {
  id: '00000000-0000-0000-0000-0000000000a1',
  email: 'sample.admin@example.invalid',
  name: 'Sample Administrator',
};

export function sampleAuditPage(): AuditPage {
  return {
    data: [
      {
        id: 'sample-audit-1',
        createdAt: '2026-08-12T09:14:22.000Z',
        action: 'settings.updated',
        entityType: 'settings',
        entityId: '00000000-0000-0000-0000-0000000000f0',
        actor: ACTOR,
        impersonator: null,
        before: { attendance: { maxWorkMinutes: 960 } },
        after: { attendance: { maxWorkMinutes: 720 } },
        ip: '203.0.113.10',
        userAgent: 'Mozilla/5.0 (Macintosh)',
        requestId: '019f0000-0000-7000-8000-000000000001',
      },
      {
        id: 'sample-audit-2',
        createdAt: '2026-08-12T08:02:10.000Z',
        action: 'department.updated',
        entityType: 'department',
        entityId: '00000000-0000-0000-0000-0000000000d1',
        actor: ACTOR,
        impersonator: null,
        before: { name: 'Stores' },
        after: { name: 'Stores and Dispatch' },
        ip: '203.0.113.10',
        userAgent: 'Mozilla/5.0 (Macintosh)',
        requestId: '019f0000-0000-7000-8000-000000000002',
      },
      {
        id: 'sample-audit-3',
        createdAt: '2026-08-11T17:41:05.000Z',
        action: 'employee.created',
        entityType: 'employee',
        entityId: '00000000-0000-0000-0000-0000000000e1',
        actor: ACTOR,
        impersonator: null,
        before: null,
        after: { employeeCode: 'EMP-0026', firstName: 'Sample', status: 'ACTIVE' },
        ip: '203.0.113.11',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
        requestId: '019f0000-0000-7000-8000-000000000003',
      },
      {
        id: 'sample-audit-4',
        createdAt: '2026-08-11T03:30:00.000Z',
        action: 'session.family_revoked',
        entityType: 'auth',
        entityId: null,
        actor: null,
        impersonator: null,
        before: null,
        after: { reason: 'refresh token reuse detected' },
        ip: '198.51.100.7',
        userAgent: 'curl/8.5.0',
        requestId: '019f0000-0000-7000-8000-000000000004',
      },
    ],
    meta: { nextCursor: null, hasMore: false },
  };
}

export function sampleAuditFacets(): AuditFacets {
  return {
    actions: [
      'department.updated',
      'employee.created',
      'session.family_revoked',
      'settings.updated',
    ],
    entityTypes: ['auth', 'department', 'employee', 'settings'],
  };
}
