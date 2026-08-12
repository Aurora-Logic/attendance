import { Injectable } from '@nestjs/common';
import type { NotificationChannel as NotificationChannelKey } from '@vyuha/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';

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
}
