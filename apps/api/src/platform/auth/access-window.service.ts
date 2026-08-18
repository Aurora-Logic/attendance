import { Injectable } from '@nestjs/common';
import { DEFAULT_ACCESS_WINDOW, ERROR_CODES, PERMISSIONS, accessWindowSchema, type AccessWindow } from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';

/**
 * 12 Area AB. The window is a setting on the organisation's clock; whether
 * it is closed *now* is a pure question over local wall time; the refusal
 * names when sign-in reopens and the permission that exempts (REQ-AB-04).
 * What is exempt is decided at the routes (D-23: punch and its offline
 * sync; the agent, jobs and exports never pass through here at all).
 */

const SETTING_KEY = 'access.window';

export interface WindowVerdict {
  readonly closed: boolean;
  /** The local time sign-in reopens ("09:00", "09:00 tomorrow"), when closed. */
  readonly reopensAt: string | null;
  /** REQ-AB-05: minutes until today's close, when open and today applies; null when it does not close today. */
  readonly closesInMinutes: number | null;
}

@Injectable()
export class AccessWindowService {
  constructor(@InjectDatabase() private readonly db: Database) {}

  async read(orgId: string): Promise<AccessWindow> {
    const rows = await this.db.execute<{ value: unknown }>(sql`
      SELECT value FROM settings WHERE org_id = ${orgId} AND scope = 'ORG' AND key = ${SETTING_KEY} AND deleted_at IS NULL LIMIT 1
    `);
    const parsed = accessWindowSchema.safeParse(rows.rows[0]?.value);
    return parsed.success ? parsed.data : DEFAULT_ACCESS_WINDOW;
  }

  async write(orgId: string, actorUserId: string | null, window: AccessWindow): Promise<AccessWindow> {
    await this.db.execute(sql`
      INSERT INTO settings (org_id, scope, scope_id, key, value, created_by, updated_by)
      VALUES (${orgId}, 'ORG', NULL, ${SETTING_KEY}, ${JSON.stringify(window)}::jsonb, ${actorUserId}, ${actorUserId})
      ON CONFLICT (org_id, scope, (coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)), key) WHERE deleted_at IS NULL
      DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
    `);
    return window;
  }

  async verdict(orgId: string, at: Date = new Date()): Promise<WindowVerdict> {
    const [window, timezone] = await Promise.all([this.read(orgId), this.timezone(orgId)]);
    return evaluateWindow(window, timezone, at);
  }

  /**
   * REQ-AB-03 read straight from the role grants — for the moments before a
   * principal exists (login) or when rotating one would be the wrong order
   * (refresh, REQ-AB-05).
   */
  async holdsExemption(userId: string): Promise<boolean> {
    const held = await this.db.execute<{ one: number }>(sql`
      SELECT 1 AS one FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ${userId} AND p.key = ${PERMISSIONS.ACCESS_OUTSIDE_WINDOW}
       LIMIT 1
    `);
    return held.rows.length > 0;
  }

  /** The refusal every route and the login share (REQ-AB-04). */
  refusal(verdict: WindowVerdict): AppError {
    return new AppError(ERROR_CODES.ACCESS_WINDOW_CLOSED, `Sign-in is closed for the night. It reopens at ${verdict.reopensAt ?? 'the configured hour'}.`, {
      status: 403,
      details: { reopensAt: verdict.reopensAt, requiredPermission: PERMISSIONS.ACCESS_OUTSIDE_WINDOW },
    });
  }

  private async timezone(orgId: string): Promise<string> {
    const rows = await this.db.execute<{ timezone: string }>(sql`SELECT timezone FROM organizations WHERE id = ${orgId}`);
    return rows.rows[0]?.timezone ?? 'Asia/Kolkata';
  }
}

/** Local wall-clock parts of an instant in a zone. */
function localParts(at: Date, timezone: string): { minutes: number; weekday: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hour = Number(get('hour')) % 24;
  return { minutes: hour * 60 + Number(get('minute')), weekday: weekdays.indexOf(get('weekday')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

function minutesOf(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Exported for the unit test: no clock, no database. */
export function evaluateWindow(window: AccessWindow, timezone: string, at: Date): WindowVerdict {
  if (!window.enabled || window.days.length === 0) return { closed: false, reopensAt: null, closesInMinutes: null };
  const local = localParts(at, timezone);
  const closes = minutesOf(window.closesAt);
  const reopens = minutesOf(window.reopensAt);
  const overnight = closes > reopens;
  // An overnight window that closed yesterday evening applies this morning if yesterday was an applicable day.
  const yesterday = (local.weekday + 6) % 7;
  const closedNow = overnight
    ? (local.minutes >= closes && window.days.includes(local.weekday)) || (local.minutes < reopens && window.days.includes(yesterday))
    : local.minutes >= closes && local.minutes < reopens && window.days.includes(local.weekday);
  if (!closedNow) {
    // REQ-AB-05: the client warns fifteen minutes ahead; it needs to know when "ahead" is.
    const closesToday = window.days.includes(local.weekday) && local.minutes < closes;
    return { closed: false, reopensAt: null, closesInMinutes: closesToday ? closes - local.minutes : null };
  }
  // Reopens at `reopensAt` today if still ahead, else tomorrow — stated as a local time the reader can act on.
  const reopenToday = local.minutes < reopens;
  const label = `${window.reopensAt}${reopenToday ? '' : ' tomorrow'}`;
  return { closed: true, reopensAt: label, closesInMinutes: null };
}
