import { createHash } from 'node:crypto';

import { SYSTEM_ROLES, type OrgBranding } from '@vyuha/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import { files, organizations } from '../db/schema/index.js';

/**
 * REQ-L-01's logo, over real HTTP (OPEN-QUESTIONS P0-7).
 *
 * It used to live in the browser's localStorage, which meant a second person
 * signing in saw the monogram. These tests are what "the server owns it" has to
 * mean: the bytes go through the same magic-byte sniff and the same sharp
 * re-encode as a punch photo, the row in `files` is what `organizations.logo_key`
 * points at, and any signed-in account can read the link back while only
 * `settings.manage` can change it.
 *
 * The multipart requests are built with `fetch` and `FormData` rather than the
 * harness helpers, which speak JSON only. That is also closer to what the
 * browser actually sends.
 */

/** Unique across the suite; see `org-ids.test.ts` for why that is checked. */
const ORG_ID = '01900000-0000-7000-8000-0000000000b8';

interface ErrorBody {
  error: { code: string; message: string };
}

let harness: ApiHarness;
let adminToken: string;
let employeeToken: string;

async function squarePng(size = 128, colour = { r: 12, g: 34, b: 56 }): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: colour } })
    .png()
    .toBuffer();
}

async function uploadLogo(
  bytes: Buffer,
  options: { token?: string; filename?: string; type?: string; field?: string } = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const form = new FormData();
  form.append(
    options.field ?? 'logo',
    // The declared type is deliberately settable per call: the server must not
    // consult it, and one of the tests below proves that by lying.
    new Blob([new Uint8Array(bytes)], { type: options.type ?? 'image/png' }),
    options.filename ?? 'logo.png',
  );

  const response = await fetch(`${harness.baseUrl}/settings/logo`, {
    method: 'POST',
    headers: { authorization: `Bearer ${options.token ?? adminToken}` },
    body: form,
  });

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body, text };
}

async function logoKey(): Promise<string | null> {
  const rows = await harness.db
    .select({ logoKey: organizations.logoKey })
    .from(organizations)
    .where(eq(organizations.id, ORG_ID));
  return rows[0]?.logoKey ?? null;
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Branding Fixture Org');
  await harness.db.update(organizations).set({ logoKey: null }).where(eq(organizations.id, ORG_ID));

  const adminRoleId = await harness.createSystemRole(SYSTEM_ROLES.ADMIN);
  const employeeRoleId = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);

  const admin = await harness.createUser({
    email: scopedEmail('branding-admin'),
    roleIds: [adminRoleId],
  });
  const employee = await harness.createUser({
    email: scopedEmail('branding-employee'),
    roleIds: [employeeRoleId],
  });

  adminToken = (await harness.login(admin.email, admin.password)).token;
  employeeToken = (await harness.login(employee.email, employee.password)).token;
  expect(adminToken).not.toBe('');
  expect(employeeToken).not.toBe('');
}, 30_000);

afterAll(async () => {
  await harness.close();
});

describe('GET /settings/branding', () => {
  it('answers an ordinary employee, because the sidebar renders it on every screen', async () => {
    const read = await harness.get<OrgBranding>('/settings/branding', { token: employeeToken });

    expect(read.status, read.text).toBe(200);
    expect(read.body.name).toBe('Branding Fixture Org');
    expect(read.body.logoUrl).toBeNull();
    expect(read.body.logoUrlExpiresInSeconds).toBeNull();
  });

  it('still needs a session', async () => {
    const refused = await harness.get<ErrorBody>('/settings/branding');
    expect(refused.status).toBe(401);
  });
});

describe('POST /settings/logo', () => {
  let storedFileId = '';

  it('refuses a caller without settings.manage', async () => {
    const refused = await uploadLogo(await squarePng(), { token: employeeToken });
    expect(refused.status, refused.text).toBe(403);
  });

  it('refuses a request with no file part', async () => {
    const response = await fetch(`${harness.baseUrl}/settings/logo`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: new FormData(),
    });
    expect(response.status).toBe(400);
  });

  it('stores the logo, re-encodes it, and points the organisation at the row', async () => {
    const input = await squarePng();
    const uploaded = await uploadLogo(input);

    expect(uploaded.status, uploaded.text).toBe(200);
    const branding = uploaded.body as OrgBranding;
    expect(branding.logoUrl).toMatch(/^https?:\/\//u);
    expect(branding.logoUrlExpiresInSeconds).toBeGreaterThan(0);

    const key = await logoKey();
    expect(key).not.toBeNull();
    storedFileId = key ?? '';

    const rows = await harness.db.select().from(files).where(eq(files.id, storedFileId));
    const row = rows[0];
    expect(row?.purpose).toBe('ORG_LOGO');
    expect(row?.mime).toBe('image/png');

    // The bytes in the bucket are the ones the row describes, and they are not
    // the bytes the client sent -- the whole point of the sanitiser.
    const fetched = Buffer.from(await (await fetch(branding.logoUrl ?? '')).arrayBuffer());
    expect(createHash('sha256').update(fetched).digest('hex')).toBe(row?.checksum);
    expect(fetched.equals(input)).toBe(false);

    expect(await harness.waitForAuditAction('settings.logo_updated')).toBe(true);
  });

  it('lets any signed-in account read the stored logo back', async () => {
    // The bug this endpoint exists to fix was that only the uploader's browser
    // had the logo. If this ever regresses to a permission check, this is the
    // test that goes red.
    const read = await harness.get<OrgBranding>('/settings/branding', { token: employeeToken });
    expect(read.status, read.text).toBe(200);
    expect(read.body.logoUrl).toMatch(/^https?:\/\//u);

    const response = await fetch(read.body.logoUrl ?? '');
    expect(response.status).toBe(200);
  });

  it('decides the type from the bytes, not from the content type the client claimed', async () => {
    const png = await squarePng(64, { r: 200, g: 10, b: 10 });
    const lying = await uploadLogo(png, { type: 'application/pdf', filename: 'logo.pdf' });

    // Accepted: the declared type is not consulted at all, and the bytes are a
    // real PNG. A server that trusted the header would have refused this.
    expect(lying.status, lying.text).toBe(200);
  });

  it('refuses a file that is not an image whatever it is called', async () => {
    const notAnImage = Buffer.from('%PDF-1.7\n%âãÏÓ\nnot a picture', 'binary');
    const refused = await uploadLogo(notAnImage, { filename: 'logo.png', type: 'image/png' });

    expect(refused.status, refused.text).toBe(422);
    expect((refused.body as ErrorBody).error.message).toContain('PDF');
  });

  it('refuses a decodable format outside the whitelist', async () => {
    const webp = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .webp()
      .toBuffer();

    const refused = await uploadLogo(webp, { type: 'image/webp', filename: 'logo.webp' });
    expect(refused.status, refused.text).toBe(422);
  });

  it('hands the replaced object to the retention sweep rather than orphaning it', async () => {
    const previous = storedFileId;
    expect(previous).not.toBe('');

    const replaced = await uploadLogo(await squarePng(96, { r: 1, g: 250, b: 1 }));
    expect(replaced.status, replaced.text).toBe(200);

    const nextKey = await logoKey();
    expect(nextKey).not.toBe(previous);

    const rows = await harness.db.select().from(files).where(eq(files.id, previous));
    // An object nothing points at any more would otherwise sit in the bucket
    // for the life of the deployment.
    expect(rows[0]?.expiresAt).not.toBeNull();
    storedFileId = nextKey ?? '';
  });
});

describe('DELETE /settings/logo', () => {
  it('refuses a caller without settings.manage', async () => {
    const refused = await harness.del<ErrorBody>('/settings/logo', { token: employeeToken });
    expect(refused.status).toBe(403);
  });

  it('clears the logo for everybody and retires the object', async () => {
    const before = await logoKey();
    expect(before).not.toBeNull();

    const removed = await harness.del<OrgBranding>('/settings/logo', { token: adminToken });
    expect(removed.status, removed.text).toBe(200);
    expect(removed.body.logoUrl).toBeNull();

    expect(await logoKey()).toBeNull();

    const rows = await harness.db.select().from(files).where(eq(files.id, before ?? ''));
    expect(rows[0]?.expiresAt).not.toBeNull();

    const asEmployee = await harness.get<OrgBranding>('/settings/branding', {
      token: employeeToken,
    });
    expect(asEmployee.body.logoUrl).toBeNull();

    expect(await harness.waitForAuditAction('settings.logo_removed')).toBe(true);
  });

  it('is idempotent, so a second press is not an error', async () => {
    const again = await harness.del<OrgBranding>('/settings/logo', { token: adminToken });
    expect(again.status, again.text).toBe(200);
    expect(again.body.logoUrl).toBeNull();
  });
});

describe('a logo_key that no longer resolves', () => {
  it('falls back to the monogram instead of breaking every screen', async () => {
    // The shape a restored database or a completed purge leaves behind. The
    // branding endpoint is called on every page load by every user, so this
    // failing loudly would take the whole application down rather than one mark.
    await harness.db
      .update(organizations)
      .set({ logoKey: '019ffb00-0000-7000-8000-00000000c0de' })
      .where(eq(organizations.id, ORG_ID));

    const read = await harness.get<OrgBranding>('/settings/branding', { token: employeeToken });
    expect(read.status, read.text).toBe(200);
    expect(read.body.logoUrl).toBeNull();

    // And the same for a value that is not an id at all, which is what an
    // earlier design that stored the storage key would have left.
    await harness.db
      .update(organizations)
      .set({ logoKey: 'logos/whatever/not-an-id.png' })
      .where(eq(organizations.id, ORG_ID));

    const malformed = await harness.get<OrgBranding>('/settings/branding', {
      token: employeeToken,
    });
    expect(malformed.status, malformed.text).toBe(200);
    expect(malformed.body.logoUrl).toBeNull();

    await harness.db
      .update(organizations)
      .set({ logoKey: null })
      .where(eq(organizations.id, ORG_ID));
  });
});
