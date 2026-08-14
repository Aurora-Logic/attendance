import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type {
  NotificationPreference,
  NotificationReadResult,
  NotificationSummary,
  NotificationUnreadCount,
  Paginated,
} from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { Authenticated } from '../rbac/route-policy.js';
import { NotificationListQueryDto, NotificationPreferencesDto } from './notifications.dto.js';
import { NotificationService } from './notification.service.js';

/**
 * `/api/v1/me/notifications` and `/api/v1/me/notification-preferences`
 * (REQ-K-02, REQ-K-04, REQ-K-05).
 *
 * Under `/me` for the reason consent is: every route here acts on the caller's
 * own account and there is no path segment naming a user. That is what makes
 * the IDOR question answerable by construction rather than by a check -- there
 * is no id to tamper with, and the service takes the user from the principal.
 *
 * `Authenticated` rather than a permission key, again like consent: notifications
 * are addressed to an account, and an account holding no roles at all still has
 * its own bell. A permission key here would mean an employee with a bare role
 * could be sent a notification they were then forbidden to read.
 *
 * Marking read is `POST` rather than `PATCH` on the collection: it is an action
 * on a notification, not an edit of one, and the body would otherwise be an
 * empty object whose only content was the verb.
 */
@Controller('me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('notifications')
  @Authenticated()
  list(
    @CurrentUser() principal: Principal,
    @Query() query: NotificationListQueryDto,
  ): Promise<Paginated<NotificationSummary>> {
    return this.notifications.list(principal, query);
  }

  /**
   * Declared before `notifications/:id/read` for the registration-order reason
   * the approvals controller documents, and separate from the list because the
   * bell polls this on its own: a count is one integer, and paying for a page
   * of rows to render a badge is the cost this endpoint exists to avoid.
   */
  @Get('notifications/unread-count')
  @Authenticated()
  unreadCount(@CurrentUser() principal: Principal): Promise<NotificationUnreadCount> {
    return this.notifications.unreadCount(principal);
  }

  @Post('notifications/read-all')
  @Authenticated()
  markAllRead(@CurrentUser() principal: Principal): Promise<NotificationReadResult> {
    return this.notifications.markAllRead(principal);
  }

  @Post('notifications/:id/read')
  @Authenticated()
  markRead(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationReadResult> {
    return this.notifications.markRead(principal, id);
  }

  @Get('notification-preferences')
  @Authenticated()
  listPreferences(@CurrentUser() principal: Principal): Promise<NotificationPreference[]> {
    return this.notifications.listPreferences(principal);
  }

  /**
   * PATCH, and a batch. Absent pairs mean unchanged, which is PATCH semantics
   * and the convention every other update endpoint in this API follows
   * (OPEN-QUESTIONS P2-5). A PUT would mean the client had to send all
   * twenty-six pairs to change one, and a stale tab would then quietly revert
   * whatever another device had just set.
   */
  @Patch('notification-preferences')
  @Authenticated()
  savePreferences(
    @CurrentUser() principal: Principal,
    @Body() body: NotificationPreferencesDto,
  ): Promise<NotificationPreference[]> {
    return this.notifications.savePreferences(principal, body);
  }
}
