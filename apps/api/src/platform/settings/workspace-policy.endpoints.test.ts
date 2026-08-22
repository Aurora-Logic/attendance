import { SYSTEM_ROLES } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, CookieJar } from '../../test-support/api-harness.js';

/**
 * Owner, 22 Aug 2026: the session window and the audit retention are
 * organisation settings. Over real HTTP: a shorter window shortens the
 * cookie and the row, and end-on-close makes a session cookie. (Audit
 * retention is not a setting: the trail is append-only at the database.)
 */
const ORG_ID = '01900000-0000-7000-8000-00000000f0cb';
const PASSWORD = 'fixture-passphrase-2026';

let harness: ApiHarness;
let admin: { id: string; email: string };

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Workspace Policy Org');
  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN);
  const a = await harness.createUser({ email: 'policy-admin@example.test', password: PASSWORD, roleIds: [adminRoleId] });
  admin = { id: a.id, email: a.email };
});

afterAll(async () => {
  await harness.close();
});

async function signIn(jar = new CookieJar()) {
  await harness.clearLoginRateLimit();
  return harness.post<{ accessToken?: string }>('/auth/login', { body: { email: admin.email, password: PASSWORD }, withCookies: true }, jar);
}

describe('session window and end-on-close', () => {
  it('a two-hour window expires the row in two hours; end-on-close drops Max-Age from the cookie', async () => {
    const first = await signIn();
    const token = first.body.accessToken;
    const set = await harness.patch('/settings', { token, body: { security: { sessionHours: 2, endSessionOnClose: true } } });
    expect(set.status).toBe(200);

    const jar = new CookieJar();
    const login = await signIn(jar);
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('vyuha_refresh=');
    expect(setCookie.toLowerCase()).not.toContain('max-age');

    const rows = await harness.db.execute<{ hours: string }>(
      sql`SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) / 3600 AS hours FROM sessions WHERE user_id = ${admin.id} ORDER BY created_at DESC LIMIT 1`,
    );
    expect(Math.round(Number(rows.rows[0]?.hours ?? 0))).toBe(2);

    const back = await harness.patch('/settings', { token, body: { security: { sessionHours: 720, endSessionOnClose: false } } });
    expect(back.status).toBe(200);
    const again = await signIn(new CookieJar());
    expect((again.headers.get('set-cookie') ?? '').toLowerCase()).toContain('max-age');
  });
});
