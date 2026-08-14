import {
  NOTIFICATION_EVENTS,
  SYSTEM_ROLES,
  type NotificationPreference,
  type NotificationReadResult,
  type NotificationSummary,
  type NotificationUnreadCount,
  type Paginated,
} from '@vyuha/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import { notificationPreferences, notifications } from '../db/schema/index.js';
import { NotificationDispatcher } from './notification.dispatcher.js';

/**
 * `/me/notifications` and `/me/notification-preferences` over real HTTP
 * (REQ-K-02, REQ-K-04, REQ-K-05).
 *
 * The rows under test are written by the real dispatcher rather than inserted
 * by hand: the point of this endpoint is that the in-app channel's output can
 * finally be read back, and a fixture that hand-wrote the row would prove the
 * SELECT works against a shape the channel might not produce.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000f4';

interface ErrorBody {
  error: { code: string; message: string };
}

let harness: ApiHarness;
let dispatcher: NotificationDispatcher;

let ashaToken: string;
let ashaUserId: string;
let ashaEmployeeId: string;
let bhaskarToken: string;
let bhaskarUserId: string;
let bhaskarEmployeeId: string;
let rolelessToken: string;
let rolelessUserId: string;

/**
 * A real dispatch writes an audit row and runs both channels, so a fixture
 * that produces three of them is comfortably slower than the 5s default. The
 * tests that build a fixture this way take an explicit budget rather than the
 * suite raising its floor for everything.
 */
const DISPATCH_FIXTURE_TIMEOUT_MS = 30_000;

async function notifyAsha(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await dispatcher.deliver({
      orgId: ORG_ID,
      type: NOTIFICATION_EVENTS.LEAVE_APPROVED,
      audience: { kind: 'employees', employeeIds: [ashaEmployeeId] },
      payload: {
        leaveType: 'Casual Leave',
        fromDate: `0${String(index + 1)}-08-2026`,
        toDate: `0${String(index + 1)}-08-2026`,
        approverName: 'Ravi',
        leaveRequestId: `01900000-0000-7000-8000-00000000010${String(index)}`,
      },
    });
  }
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Notification Endpoints Fixture Org');
  dispatcher = harness.resolve(NotificationDispatcher);

  const employeeRole = await harness.createSystemRole(SYSTEM_ROLES.EMPLOYEE);

  ashaEmployeeId = await harness.createEmployee({ code: 'NB-A', firstName: 'Asha' });
  bhaskarEmployeeId = await harness.createEmployee({ code: 'NB-B', firstName: 'Bhaskar' });

  const asha = await harness.createUser({
    email: scopedEmail('bell.asha'),
    roleIds: [employeeRole],
    employeeId: ashaEmployeeId,
  });
  const bhaskar = await harness.createUser({
    email: scopedEmail('bell.bhaskar'),
    roleIds: [employeeRole],
    employeeId: bhaskarEmployeeId,
  });
  // No roles at all. A notification is addressed to an account, so an account
  // holding no permission key must still be able to read its own bell.
  const roleless = await harness.createUser({ email: scopedEmail('bell.roleless') });

  ashaUserId = asha.id;
  bhaskarUserId = bhaskar.id;
  rolelessUserId = roleless.id;

  ashaToken = (await harness.login(asha.email, asha.password)).token;
  bhaskarToken = (await harness.login(bhaskar.email, bhaskar.password)).token;
  rolelessToken = (await harness.login(roleless.email, roleless.password)).token;
  expect([ashaToken, bhaskarToken, rolelessToken].every((token) => token !== '')).toBe(true);
}, 60_000);

afterEach(async () => {
  await harness.db.delete(notifications).where(eq(notifications.orgId, ORG_ID));
  await harness.db
    .delete(notificationPreferences)
    .where(eq(notificationPreferences.orgId, ORG_ID));
});

afterAll(async () => {
  await harness.close();
});

describe('GET /me/notifications (REQ-K-02)', () => {
  it('refuses an unauthenticated request', async () => {
    const result = await harness.get('/me/notifications');
    expect(result.status).toBe(401);
  });

  it('answers an account with no roles at all', async () => {
    const result = await harness.get<Paginated<NotificationSummary>>('/me/notifications', {
      token: rolelessToken,
    });
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual([]);
    expect(result.body.meta.total).toBe(0);
  });

  it('returns the caller rows newest first, with the action url lifted out', async () => {
    await notifyAsha(3);

    const result = await harness.get<Paginated<NotificationSummary>>('/me/notifications', {
      token: ashaToken,
    });
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveLength(3);
    expect(result.body.meta.total).toBe(3);

    const [newest, , oldest] = result.body.data;
    expect(newest?.title).toBe('Your leave was approved');
    // The in-app channel stores it inside the jsonb payload; the endpoint is
    // what turns that into a typed field the client can navigate to.
    expect(newest?.actionUrl).toContain('/leave/');
    expect(newest?.readAt).toBeNull();
    expect(newest?.eventType).toBe(NOTIFICATION_EVENTS.LEAVE_APPROVED);
    expect(
      new Date(newest?.createdAt ?? 0).getTime() >= new Date(oldest?.createdAt ?? 0).getTime(),
    ).toBe(true);
  }, DISPATCH_FIXTURE_TIMEOUT_MS);

  it('pages, and filters to unread on request', async () => {
    await notifyAsha(3);

    const page = await harness.get<Paginated<NotificationSummary>>(
      '/me/notifications?page=2&pageSize=2',
      { token: ashaToken },
    );
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 3 });

    const first = page.body.data[0]?.id;
    expect(first).toBeDefined();
    await harness.post(`/me/notifications/${String(first)}/read`, { token: ashaToken });

    const unread = await harness.get<Paginated<NotificationSummary>>(
      '/me/notifications?unreadOnly=true',
      { token: ashaToken },
    );
    expect(unread.body.meta.total).toBe(2);
    expect(unread.body.data.every((row) => row.readAt === null)).toBe(true);
  }, DISPATCH_FIXTURE_TIMEOUT_MS);

  it('refuses a page size beyond the envelope maximum', async () => {
    const result = await harness.get<ErrorBody>('/me/notifications?pageSize=5000', {
      token: ashaToken,
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('IDOR: one person reads their own notifications and nobody else (Security §15)', () => {
  it('never returns another account rows, and marking one read is a 404', async () => {
    await notifyAsha(2);

    const ashaList = await harness.get<Paginated<NotificationSummary>>('/me/notifications', {
      token: ashaToken,
    });
    const target = ashaList.body.data[0]?.id;
    expect(target).toBeDefined();

    // Bhaskar is in the same organisation, holds the same role, and is holding
    // a real id belonging to Asha. This is the whole attack.
    const bhaskarList = await harness.get<Paginated<NotificationSummary>>('/me/notifications', {
      token: bhaskarToken,
    });
    expect(bhaskarList.status).toBe(200);
    expect(bhaskarList.body.data).toEqual([]);
    expect(bhaskarList.body.meta.total).toBe(0);

    const stolen = await harness.post<ErrorBody>(`/me/notifications/${String(target)}/read`, {
      token: bhaskarToken,
    });
    // 404, not 403: a 403 would confirm the id names a real notification.
    expect(stolen.status).toBe(404);
    expect(stolen.body.error.code).toBe('NOT_FOUND');

    // And the row is untouched, which is the assertion that would fail if the
    // update had run before the ownership predicate.
    const rows = await harness.db
      .select({ readAt: notifications.readAt, userId: notifications.userId })
      .from(notifications)
      .where(and(eq(notifications.orgId, ORG_ID), eq(notifications.id, String(target))));
    expect(rows[0]?.readAt).toBeNull();
    expect(rows[0]?.userId).toBe(ashaUserId);
  }, DISPATCH_FIXTURE_TIMEOUT_MS);

  it('read-all clears only the caller rows', async () => {
    await notifyAsha(2);
    await dispatcher.deliver({
      orgId: ORG_ID,
      type: NOTIFICATION_EVENTS.LEAVE_APPROVED,
      audience: { kind: 'employees', employeeIds: [bhaskarEmployeeId] },
      payload: { leaveType: 'Sick Leave', fromDate: '05-08-2026', toDate: '05-08-2026' },
    });

    const cleared = await harness.post<NotificationReadResult>('/me/notifications/read-all', {
      token: ashaToken,
    });
    expect(cleared.status).toBe(201);
    expect(cleared.body).toEqual({ marked: 2, unread: 0 });

    const bhaskarUnread = await harness.get<NotificationUnreadCount>(
      '/me/notifications/unread-count',
      { token: bhaskarToken },
    );
    expect(bhaskarUnread.body.unread).toBe(1);
  }, DISPATCH_FIXTURE_TIMEOUT_MS);
});

describe('unread count and marking read (REQ-K-05)', () => {
  it('counts unread, falls as rows are read, and is idempotent per row', async () => {
    await notifyAsha(2);

    const before = await harness.get<NotificationUnreadCount>('/me/notifications/unread-count', {
      token: ashaToken,
    });
    expect(before.body).toEqual({ unread: 2 });

    const list = await harness.get<Paginated<NotificationSummary>>('/me/notifications', {
      token: ashaToken,
    });
    const id = String(list.body.data[0]?.id);

    const first = await harness.post<NotificationReadResult>(`/me/notifications/${id}/read`, {
      token: ashaToken,
    });
    expect(first.body).toEqual({ marked: 1, unread: 1 });

    // A second device opening the same notification is not an error, and it
    // must not decrement the count a second time.
    const replay = await harness.post<NotificationReadResult>(`/me/notifications/${id}/read`, {
      token: ashaToken,
    });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual({ marked: 0, unread: 1 });
  }, DISPATCH_FIXTURE_TIMEOUT_MS);

  it('answers 400 for an id that is not a uuid, not 404', async () => {
    const result = await harness.post<ErrorBody>('/me/notifications/not-a-uuid/read', {
      token: ashaToken,
    });
    expect(result.status).toBe(400);
  });

  it('writes an audit row for the read (REQ-M-01)', async () => {
    await notifyAsha(1);
    const list = await harness.get<Paginated<NotificationSummary>>('/me/notifications', {
      token: ashaToken,
    });
    await harness.post(`/me/notifications/${String(list.body.data[0]?.id)}/read`, {
      token: ashaToken,
    });
    expect(await harness.waitForAuditAction('notification.read')).toBe(true);
  }, DISPATCH_FIXTURE_TIMEOUT_MS);
});

describe('preferences (REQ-K-04)', () => {
  it('returns the whole grid, defaults included, before anything is stored', async () => {
    const result = await harness.get<NotificationPreference[]>('/me/notification-preferences', {
      token: ashaToken,
    });
    expect(result.status).toBe(200);
    // Thirteen events times the two channels this phase delivers on.
    expect(result.body).toHaveLength(26);
    expect(result.body.every((row) => row.isDefault)).toBe(true);

    const reminder = result.body.filter(
      (row) => row.eventType === NOTIFICATION_EVENTS.PUNCH_REMINDER,
    );
    // REQ-K-03 marks the punch reminder opt-in, and it is the only one.
    expect(reminder.every((row) => !row.enabled)).toBe(true);

    const approved = result.body.filter(
      (row) => row.eventType === NOTIFICATION_EVENTS.LEAVE_APPROVED,
    );
    expect(approved.every((row) => row.enabled)).toBe(true);
  });

  it('stores a preference, and switching one off suppresses delivery', async () => {
    const saved = await harness.patch<NotificationPreference[]>('/me/notification-preferences', {
      token: ashaToken,
      body: {
        preferences: [
          { eventType: NOTIFICATION_EVENTS.LEAVE_APPROVED, channel: 'in_app', enabled: false },
          { eventType: NOTIFICATION_EVENTS.LEAVE_APPROVED, channel: 'email', enabled: false },
        ],
      },
    });
    expect(saved.status).toBe(200);
    const stored = saved.body.filter(
      (row) => row.eventType === NOTIFICATION_EVENTS.LEAVE_APPROVED,
    );
    expect(stored.every((row) => !row.enabled && !row.isDefault)).toBe(true);

    const report = await dispatcher.deliver({
      orgId: ORG_ID,
      type: NOTIFICATION_EVENTS.LEAVE_APPROVED,
      audience: { kind: 'employees', employeeIds: [ashaEmployeeId] },
      payload: { leaveType: 'Casual Leave', fromDate: '09-08-2026', toDate: '09-08-2026' },
    });
    expect(report).toMatchObject({ recipients: 1, delivered: 0, suppressed: 1 });

    const count = await harness.get<NotificationUnreadCount>('/me/notifications/unread-count', {
      token: ashaToken,
    });
    expect(count.body.unread).toBe(0);
  }, DISPATCH_FIXTURE_TIMEOUT_MS);

  it('switches the opt-in punch reminder on, which is the default running backwards', async () => {
    await harness.patch('/me/notification-preferences', {
      token: ashaToken,
      body: {
        preferences: [
          { eventType: NOTIFICATION_EVENTS.PUNCH_REMINDER, channel: 'in_app', enabled: true },
        ],
      },
    });

    const report = await dispatcher.deliver({
      orgId: ORG_ID,
      type: NOTIFICATION_EVENTS.PUNCH_REMINDER,
      audience: { kind: 'employees', employeeIds: [ashaEmployeeId] },
      payload: { shiftName: 'General', startsAt: '09:00' },
    });
    expect(report).toMatchObject({ recipients: 1, delivered: 1, suppressed: 0 });
  }, DISPATCH_FIXTURE_TIMEOUT_MS);

  it('saving twice updates rather than colliding with the unique index', async () => {
    const body = {
      preferences: [
        { eventType: NOTIFICATION_EVENTS.PUNCH_MISSING_OUT, channel: 'email', enabled: false },
      ],
    };
    const first = await harness.patch('/me/notification-preferences', {
      token: ashaToken,
      body,
    });
    expect(first.status).toBe(200);

    const second = await harness.patch<NotificationPreference[]>(
      '/me/notification-preferences',
      { token: ashaToken, body: { preferences: [{ ...body.preferences[0], enabled: true }] } },
    );
    expect(second.status).toBe(200);
    const row = second.body.find(
      (entry) =>
        entry.eventType === NOTIFICATION_EVENTS.PUNCH_MISSING_OUT && entry.channel === 'email',
    );
    expect(row).toMatchObject({ enabled: true, isDefault: false });

    const stored = await harness.db
      .select({ id: notificationPreferences.id })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.orgId, ORG_ID),
          eq(notificationPreferences.userId, ashaUserId),
          eq(notificationPreferences.eventType, NOTIFICATION_EVENTS.PUNCH_MISSING_OUT),
        ),
      );
    expect(stored).toHaveLength(1);
  });

  it('refuses a channel this phase cannot deliver on', async () => {
    const result = await harness.patch<ErrorBody>('/me/notification-preferences', {
      token: ashaToken,
      body: {
        preferences: [
          { eventType: NOTIFICATION_EVENTS.LEAVE_APPROVED, channel: 'whatsapp', enabled: true },
        ],
      },
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses an event that is not in the catalogue', async () => {
    const result = await harness.patch<ErrorBody>('/me/notification-preferences', {
      token: ashaToken,
      body: {
        preferences: [{ eventType: 'leave.invented', channel: 'in_app', enabled: true }],
      },
    });
    expect(result.status).toBe(400);
  });

  it('one account preferences do not reach another (REQ-K-04)', async () => {
    await harness.patch('/me/notification-preferences', {
      token: ashaToken,
      body: {
        preferences: [
          { eventType: NOTIFICATION_EVENTS.LEAVE_APPROVED, channel: 'in_app', enabled: false },
        ],
      },
    });

    const bhaskarGrid = await harness.get<NotificationPreference[]>(
      '/me/notification-preferences',
      { token: bhaskarToken },
    );
    expect(bhaskarGrid.body.every((row) => row.isDefault)).toBe(true);

    const stored = await harness.db
      .select({ userId: notificationPreferences.userId })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.orgId, ORG_ID));
    expect(stored.map((row) => row.userId)).toEqual([ashaUserId]);
    expect(stored.map((row) => row.userId)).not.toContain(rolelessUserId);
    expect(stored.map((row) => row.userId)).not.toContain(bhaskarUserId);
  });

  it('writes an audit row naming what changed (REQ-M-01)', async () => {
    await harness.patch('/me/notification-preferences', {
      token: ashaToken,
      body: {
        preferences: [
          { eventType: NOTIFICATION_EVENTS.LEAVE_REJECTED, channel: 'email', enabled: false },
        ],
      },
    });
    expect(await harness.waitForAuditAction('notification.preferences.updated')).toBe(true);
  }, DISPATCH_FIXTURE_TIMEOUT_MS);
});
