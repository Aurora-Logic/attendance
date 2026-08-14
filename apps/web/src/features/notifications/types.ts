import { z } from 'zod';

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
  type NotificationPreference,
  type NotificationReadResult,
  type NotificationSummary,
  type NotificationUnreadCount,
} from '@vyuha/shared';

/**
 * Parsers for what the bell reads back.
 *
 * The shapes are the published contract and are imported, never restated. What
 * lives here is the *parser*, for the reason the attendance feature gives: an
 * unvalidated response fails three components deep inside a row renderer, and
 * the stack trace names the list rather than the field the server changed.
 *
 * `z.ZodType<NotificationSummary>` is the link that makes drift a compile
 * error rather than a field that silently renders blank.
 */

const eventTypeSchema = z.enum(
  NOTIFICATION_EVENT_TYPES as [NotificationEventType, ...NotificationEventType[]],
);

export const notificationSchema: z.ZodType<NotificationSummary> = z.object({
  id: z.string(),
  eventType: eventTypeSchema,
  title: z.string(),
  body: z.string(),
  actionUrl: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

export const unreadCountSchema: z.ZodType<NotificationUnreadCount> = z.object({
  unread: z.number().int().nonnegative(),
});

export const readResultSchema: z.ZodType<NotificationReadResult> = z.object({
  marked: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
});

export const preferenceSchema: z.ZodType<NotificationPreference> = z.object({
  eventType: eventTypeSchema,
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
  isDefault: z.boolean(),
});

export const preferenceListSchema = z.array(preferenceSchema);

/**
 * The bell's panel shows the most recent few, not a page of fifty. Anything
 * longer belongs on the screen behind "See all", which pages properly.
 */
export const BELL_PAGE_SIZE = 8;
