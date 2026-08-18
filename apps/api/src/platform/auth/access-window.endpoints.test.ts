import { SYSTEM_ROLES, type AccessWindow } from '@vyuha/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, CookieJar, scopedEmail } from '../../test-support/api-harness.js';

/**
 * 12 Area AB, end to end: a window that is closed *now* (set to cover the
 * whole clock) refuses an employee's sign-in naming when it reopens and the
 * exempting key, lets Admin through, keeps an existing session's punch
 * context reachable (REQ-AB-06) and its non-exempt routes refused
 * (REQ-AB-05: not terminated, refused per request), and audits the refusal.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000eb';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

let harness: ApiHarness;
let adminToken = '';
let admin: { email: string; password: string };
let employee: { email: string; password: string };
let employeeToken = '';
let employeeJar: CookieJar | undefined;

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Window Fixture Org');
  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN, { isSystem: true });
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE, { isSystem: true });
  const employeeId = await harness.createEmployee({ code: 'WIN-001', firstName: 'Nisha', lastName: 'Rao' });
  admin = await harness.createUser({ email: scopedEmail('win-admin'), roleIds: [adminRoleId] });
  employee = await harness.createUser({ email: scopedEmail('win-employee'), roleIds: [employeeRoleId], employeeId });
  adminToken = (await harness.login(admin.email, admin.password)).token;
  const login = await harness.login(employee.email, employee.password);
  employeeToken = login.token;
  employeeJar = login.jar;
});

afterAll(async () => {
  // Leave the organisation open for whoever runs next.
  await harness.put('/settings/access-window', { token: adminToken, body: { enabled: false, closesAt: '19:30', reopensAt: '09:00', days: [0, 1, 2, 3, 4, 5, 6] } });
  await harness.close();
});

describe('the access window (12 Area AB)', () => {
  it('is a setting, read and written under settings.manage, off by default', async () => {
    const before = await harness.get<AccessWindow>('/settings/access-window', { token: adminToken });
    expect(before.body.enabled).toBe(false);
    const forbidden = await harness.put('/settings/access-window', { token: employeeToken, body: { enabled: true, closesAt: '00:00', reopensAt: '23:59', days: [0, 1, 2, 3, 4, 5, 6] } });
    expect(forbidden.status).toBe(403);
    // Closed for the whole clock, every day: "now" is inside it whenever this runs.
    const written = await harness.put<AccessWindow>('/settings/access-window', { token: adminToken, body: { enabled: true, closesAt: '00:00', reopensAt: '23:59', days: [0, 1, 2, 3, 4, 5, 6] } });
    expect(written.status).toBe(200);
    expect(await harness.waitForAuditAction('settings.access_window.updated')).toBe(true);
  });

  it('refuses an employee’s sign-in, names when it reopens and the exempting key, and audits it; Admin signs in', async () => {
    const refused = await harness.post<ErrorBody>('/auth/login', { body: { email: employee.email, password: employee.password } });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ACCESS_WINDOW_CLOSED');
    expect(refused.body.error.message).toContain('reopens at 23:59');
    expect(refused.body.error.details?.requiredPermission).toBe('access.outside_window');
    expect(await harness.waitForAuditAction('auth.login_refused_window')).toBe(true);

    const adminLogin = await harness.post<{ accessToken: string }>('/auth/login', { body: { email: admin.email, password: admin.password } });
    expect(adminLogin.status).toBe(200);
  });

  it('an employee’s existing session is not terminated: punch context answers, everything else is refused per request', async () => {
    const context = await harness.get('/me/today', { token: employeeToken });
    expect(context.status).toBe(200);
    const me = await harness.get<{ accessWindow: { closesInMinutes: number | null; exempt: boolean } }>('/auth/me', { token: employeeToken });
    expect(me.status).toBe(200);
    expect(me.body.accessWindow).toEqual({ closesInMinutes: null, exempt: false });
    const adminMe = await harness.get<{ accessWindow: { exempt: boolean } }>('/auth/me', { token: adminToken });
    expect(adminMe.body.accessWindow.exempt).toBe(true);
    // REQ-AB-05: the refresh is refused after the cutoff, before the cookie is burnt, so the session simply runs out.
    const refused = await harness.post<ErrorBody>('/auth/refresh', { withCookies: true }, employeeJar);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ACCESS_WINDOW_CLOSED');
    const leave = await harness.get<ErrorBody>('/leave-types', { token: employeeToken });
    expect([403, 404]).toContain(leave.status);
    if (leave.status === 403) expect(leave.body.error.code).toBe('ACCESS_WINDOW_CLOSED');
    // Admin holds access.outside_window: nothing changes for them.
    const adminSettings = await harness.get('/settings', { token: adminToken });
    expect(adminSettings.status).toBe(200);
  });
});
