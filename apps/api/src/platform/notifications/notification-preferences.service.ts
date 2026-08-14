import { Injectable } from '@nestjs/common';
import {
  DELIVERABLE_NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  type NotificationChannel as NotificationChannelKey,
  type NotificationPreference,
  type NotificationPreferenceUpdate,
} from '@vyuha/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../db/db.provider.js';
import { notificationPreferences } from '../db/schema/index.js';
import { NOTIFICATION_TEMPLATES, type NotificationEventType } from './notification-events.js';

/**
 * REQ-K-04: per-user, per-event, per-channel.
 *
 * Absence of a row means the template's default, and that is deliberate rather
 * than lazy. Writing a row per user per event per channel at account creation
 * would be a few thousand rows nobody ever reads, and every new event added
 * later would need a backfill or would silently be off for existing users.
 *
 * The defaults run in both directions, which is what makes the table worth
 * having: a row can switch an event *on* that ships off (the opt-in punch
 * reminder) as easily as it can switch one off.
 */

export interface PreferenceLookup {
  isEnabled(userId: string, channel: NotificationChannelKey): boolean;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(@InjectDatabase() private readonly db: Database) {}

  /**
   * One query for the whole fan-out. A per-recipient lookup would be N
   * round-trips for an event going to a department.
   */
  async lookupFor(
    orgId: string,
    eventType: NotificationEventType,
    userIds: readonly string[],
  ): Promise<PreferenceLookup> {
    const defaults = new Set(NOTIFICATION_TEMPLATES[eventType].defaultChannels);

    const rows =
      userIds.length === 0
        ? []
        : await this.db
            .select({
              userId: notificationPreferences.userId,
              channel: notificationPreferences.channel,
              enabled: notificationPreferences.enabled,
            })
            .from(notificationPreferences)
            .where(
              and(
                eq(notificationPreferences.orgId, orgId),
                eq(notificationPreferences.eventType, eventType),
                inArray(notificationPreferences.userId, [...userIds]),
                isNull(notificationPreferences.deletedAt),
              ),
            );

    const explicit = new Map<string, boolean>();
    for (const row of rows) explicit.set(`${row.userId}:${row.channel}`, row.enabled);

    return {
      isEnabled(userId: string, channel: NotificationChannelKey): boolean {
        return explicit.get(`${userId}:${channel}`) ?? defaults.has(channel);
      },
    };
  }

  /**
   * REQ-K-04 for one person, every event and every deliverable channel.
   *
   * The whole grid is returned, not just the rows that exist. A screen that
   * received only stored rows would have to know the template defaults to
   * render the rest, which is the second definition of a default this table
   * exists to avoid -- and it would be the definition that goes stale first.
   */
  async listFor(orgId: string, userId: string): Promise<NotificationPreference[]> {
    const rows = await this.db
      .select({
        eventType: notificationPreferences.eventType,
        channel: notificationPreferences.channel,
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.orgId, orgId),
          eq(notificationPreferences.userId, userId),
          isNull(notificationPreferences.deletedAt),
        ),
      );

    const stored = new Map<string, boolean>();
    for (const row of rows) stored.set(`${row.eventType}:${row.channel}`, row.enabled);

    const grid: NotificationPreference[] = [];
    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      const defaults = new Set(NOTIFICATION_TEMPLATES[eventType].defaultChannels);
      for (const channel of DELIVERABLE_NOTIFICATION_CHANNELS) {
        const explicit = stored.get(`${eventType}:${channel}`);
        grid.push({
          eventType,
          channel,
          enabled: explicit ?? defaults.has(channel),
          isDefault: explicit === undefined,
        });
      }
    }
    return grid;
  }

  /**
   * Writes the caller's own preference rows. Returns the number of rows the
   * statement actually touched.
   *
   * An upsert on the partial unique index rather than a read-then-write: two
   * tabs saving the same switch would otherwise both find no row and both
   * insert, and the index would refuse the second with a 500 naming a
   * constraint. The conflict target has to repeat the index predicate because
   * the index is partial -- the same shape `ConsentRepository` uses.
   *
   * A row is always written, even when the value equals the template default.
   * "Explicitly the same as the default" and "never expressed an opinion" are
   * different states: the first survives a change to the default, and REQ-K-04
   * is about the person's choice, not about the shipped one.
   */
  async saveFor(
    orgId: string,
    userId: string,
    updates: readonly NotificationPreferenceUpdate[],
  ): Promise<number> {
    if (updates.length === 0) return 0;

    const now = new Date();
    const rows = await this.db
      .insert(notificationPreferences)
      .values(
        updates.map((update) => ({
          orgId,
          userId,
          eventType: update.eventType,
          channel: update.channel,
          enabled: update.enabled,
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
          updatedBy: userId,
        })),
      )
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.eventType,
          notificationPreferences.channel,
        ],
        // `targetWhere`, not `where`: the first names the partial index the
        // conflict is against, the second would be a WHERE on the UPDATE. The
        // deprecated `where` silently becomes the latter, which leaves Postgres
        // with no matching arbiter index and a 500 on every save.
        targetWhere: sql`deleted_at IS NULL`,
        set: {
          enabled: sql`excluded.enabled`,
          updatedAt: now,
          updatedBy: userId,
        },
      })
      .returning({ id: notificationPreferences.id });

    return rows.length;
  }

  /**
   * The users who have switched an event **on** for at least one channel.
   *
   * For the opt-in events only (REQ-K-03's punch reminder), where the set of
   * people who could possibly receive anything is exactly the set with a row.
   * A sweep that walked every employee to build a dispatch the dispatcher would
   * then suppress for all of them is work nobody asked for, at the cadence a
   * reminder needs.
   *
   * It narrows candidates; it never decides delivery. The dispatcher still
   * consults `lookupFor` for every recipient, so this cannot let a suppressed
   * notification through -- only stop one being built.
   */
  async usersOptedIn(orgId: string, eventType: NotificationEventType): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ userId: notificationPreferences.userId })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.orgId, orgId),
          eq(notificationPreferences.eventType, eventType),
          eq(notificationPreferences.enabled, true),
          isNull(notificationPreferences.deletedAt),
        ),
      );
    return rows.map((row) => row.userId);
  }
}
