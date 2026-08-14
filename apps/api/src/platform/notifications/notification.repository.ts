import type { NotificationEventType, NotificationSummary } from '@vyuha/shared';
import { and, count, desc, eq, isNull } from 'drizzle-orm';

import type { Database } from '../db/db.provider.js';
import { notifications } from '../db/schema/index.js';
import { ScopedRepository, type OrgContext } from '../db/scoped-repository.js';

/**
 * REQ-K-05's reads, and the two writes that clear them.
 *
 * Every method takes the owner's user id and every statement filters on it, on
 * top of the org and soft-delete predicates `ScopedRepository` already applies.
 * That is the IDOR control, and it is deliberately not a check performed after
 * a fetch: a row belonging to somebody else never enters the process, so there
 * is nothing for a careless log line or an error body to leak. Security §15 --
 * "every read filtered by org_id + scope; never trust an ID from the client".
 *
 * `markOneRead` therefore takes the id *and* the user id in the same WHERE. A
 * version that loaded by id, compared the owner and then updated would be a
 * read of another person's notification followed by a decision, which is one
 * refactor away from being a read with no decision at all.
 */

export interface NotificationListFilters {
  readonly userId: string;
  readonly unreadOnly: boolean;
  readonly limit: number;
  readonly offset: number;
}

/**
 * The in-app channel stores `actionUrl` inside the jsonb payload alongside the
 * template's own fields, so it is lifted out here rather than in the service.
 * The blob is untrusted from a type system's point of view -- jsonb is `unknown`
 * -- so a value that is not a string becomes null instead of reaching the client
 * as whatever it happened to be.
 */
function actionUrlOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('actionUrl' in payload)) return null;
  const value: unknown = (payload as Record<string, unknown>).actionUrl;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class NotificationRepository extends ScopedRepository<typeof notifications> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, notifications, ctx);
  }

  async list(filters: NotificationListFilters): Promise<NotificationSummary[]> {
    const rows = await this.db
      .select({
        id: notifications.id,
        eventType: notifications.eventType,
        title: notifications.title,
        body: notifications.body,
        payload: notifications.payload,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(this.ownedBy(filters.userId, filters.unreadOnly))
      // Newest first, matching both covering indexes so neither the bell's
      // unread query nor the full list has to sort.
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(filters.limit)
      .offset(filters.offset);

    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType as NotificationEventType,
      title: row.title,
      body: row.body,
      actionUrl: actionUrlOf(row.payload),
      readAt: row.readAt === null ? null : row.readAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async countFor(userId: string, unreadOnly: boolean): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(this.ownedBy(userId, unreadOnly));
    return rows[0]?.value ?? 0;
  }

  /** True when this call is what marked it. Already-read and not-yours are both false. */
  async markOneRead(userId: string, id: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: at, updatedAt: at, updatedBy: userId })
      .where(and(this.ownedBy(userId, true), eq(notifications.id, id)))
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  /**
   * Whether this id names a live notification belonging to this user, read or
   * unread. The only way the service distinguishes "already read" from "not
   * yours", and it still never loads a row it does not own.
   */
  async existsForUser(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(this.ownedBy(userId, false), eq(notifications.id, id)))
      .limit(1);
    return rows.length > 0;
  }

  /** Returns how many rows this call moved, which is what the caller reports. */
  async markAllRead(userId: string, at: Date): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: at, updatedAt: at, updatedBy: userId })
      .where(this.ownedBy(userId, true))
      .returning({ id: notifications.id });
    return rows.length;
  }

  /**
   * The scope predicate for everything above: this organisation, alive, and
   * this user. Written once so no query in this file can be built without it.
   */
  private ownedBy(userId: string, unreadOnly: boolean) {
    return this.scoped(
      eq(notifications.userId, userId),
      unreadOnly ? isNull(notifications.readAt) : undefined,
    );
  }
}
