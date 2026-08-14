import { Injectable } from '@nestjs/common';
import {
  paginated,
  pageSlice,
  type NotificationListQuery,
  type NotificationPreference,
  type NotificationPreferencesInput,
  type NotificationReadResult,
  type NotificationSummary,
  type NotificationUnreadCount,
  type Paginated,
} from '@vyuha/shared';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationRepository } from './notification.repository.js';

/**
 * The read side of REQ-K-02, and the preference writes of REQ-K-04.
 *
 * The in-app channel has been writing `notifications` rows since the dispatcher
 * landed and nothing could ever read one back. This is that half.
 *
 * **Every method acts on the principal's own user id and takes no user
 * parameter.** That is the access-control design, not an omission: there is no
 * argument a caller could supply to read somebody else's bell, so the IDOR this
 * endpoint would otherwise be prone to has no shape to take. The permission
 * policy is `Authenticated` for the same reason consent's is -- an account with
 * no roles at all still has its own notifications.
 *
 * Reading is not audited. REQ-M-01 covers state-changing actions, and one audit
 * row per bell-open per person per day would bury the trail that matters under
 * the trail that does not. Marking read *is* audited, once per call with a
 * count, rather than once per row.
 */
@Injectable()
export class NotificationService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly preferences: NotificationPreferencesService,
    private readonly auditContext: AuditContext,
  ) {}

  async list(
    principal: Principal,
    query: NotificationListQuery,
  ): Promise<Paginated<NotificationSummary>> {
    const repository = this.repository(principal);
    const { limit, offset } = pageSlice(query);

    const [data, total] = await Promise.all([
      repository.list({ userId: principal.userId, unreadOnly: query.unreadOnly, limit, offset }),
      repository.countFor(principal.userId, query.unreadOnly),
    ]);

    return paginated(data, query, total);
  }

  async unreadCount(principal: Principal): Promise<NotificationUnreadCount> {
    return { unread: await this.repository(principal).countFor(principal.userId, true) };
  }

  /**
   * 404 rather than 403 when the row is not the caller's.
   *
   * The two are indistinguishable to the repository by construction -- the id
   * and the owner are one predicate -- and that is the point: answering 403
   * would confirm that a notification with that id exists for somebody, which
   * is exactly the fact an enumeration attempt is fishing for.
   */
  async markRead(principal: Principal, id: string): Promise<NotificationReadResult> {
    const repository = this.repository(principal);
    const at = new Date();
    const marked = await repository.markOneRead(principal.userId, id, at);

    if (marked) {
      this.auditContext.record({
        action: 'notification.read',
        entityType: 'notification',
        entityId: id,
        before: { readAt: null },
        after: { readAt: at.toISOString() },
      });
    } else if (!(await repository.existsForUser(principal.userId, id))) {
      // Nothing moved and the id is not one of theirs. Already-read is the
      // other reason nothing moved, and that is not an error: two devices
      // opening the same notification must not make the second one fail.
      throw AppError.notFound('Notification', id);
    }

    return {
      marked: marked ? 1 : 0,
      unread: await repository.countFor(principal.userId, true),
    };
  }

  async markAllRead(principal: Principal): Promise<NotificationReadResult> {
    const repository = this.repository(principal);
    const marked = await repository.markAllRead(principal.userId, new Date());

    if (marked > 0) {
      // One row for the action, not one per notification: clearing a bell with
      // forty unread items is one thing the person did.
      this.auditContext.record({
        action: 'notification.read_all',
        entityType: 'notification',
        entityId: null,
        before: null,
        after: { marked },
      });
    }

    return { marked, unread: await repository.countFor(principal.userId, true) };
  }

  listPreferences(principal: Principal): Promise<NotificationPreference[]> {
    return this.preferences.listFor(principal.orgId, principal.userId);
  }

  async savePreferences(
    principal: Principal,
    input: NotificationPreferencesInput,
  ): Promise<NotificationPreference[]> {
    const written = await this.preferences.saveFor(
      principal.orgId,
      principal.userId,
      input.preferences,
    );

    this.auditContext.record({
      action: 'notification.preferences.updated',
      entityType: 'notification_preferences',
      entityId: principal.userId,
      before: null,
      after: {
        written,
        // The values, not just the count: "who turned off the missing-punch
        // email and when" is the question this row exists to answer.
        preferences: input.preferences.map(
          (preference) =>
            `${preference.eventType}:${preference.channel}=${String(preference.enabled)}`,
        ),
      },
    });

    return this.preferences.listFor(principal.orgId, principal.userId);
  }

  private repository(principal: Principal): NotificationRepository {
    return new NotificationRepository(this.db, orgContextOf(principal));
  }
}
