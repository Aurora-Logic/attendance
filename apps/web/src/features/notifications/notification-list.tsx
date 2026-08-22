import { ArrowClockwiseIcon, BellSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { notificationIcon } from '@/components/shared/entity-icons';
import { Fragment, type KeyboardEvent as ReactKeyboardEvent, createElement } from 'react';

import type { NotificationSummary } from '@vyuha/shared';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The rows behind the bell, and the same rows on the full screen.
 *
 * One component so the panel and the page cannot drift apart -- a notification
 * that reads one way in the popover and another on `/notifications` is two
 * implementations of the same list (CLAUDE.md §3 rule 4).
 *
 * Unread is carried by weight and a dot rather than by a background tint. A
 * tinted row is a second surface inside the surface, which is the box-in-box
 * rule in miniature, and weight survives both themes without a token.
 */

/**
 * "4 minutes ago" up to a day, then the date.
 *
 * Relative time is what a notification list is read with -- nobody scans a
 * bell for a timestamp -- but past a day it stops meaning anything and the
 * date is more useful than "8 days ago".
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} hr ago`;

  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(then);
}

interface NotificationListProps {
  notifications: readonly NotificationSummary[];
  onActivate: (notification: NotificationSummary) => void;
  /** Renders the loading state instead of the rows. */
  isPending?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function NotificationList({
  notifications,
  onActivate,
  isPending = false,
  error = null,
  onRetry,
  emptyTitle = 'Nothing yet',
  emptyDescription = 'Approvals, leave decisions and punch reminders will appear here.',
  className,
}: NotificationListProps) {
  if (isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading notifications"
        className={cn('flex flex-col gap-3 p-3', className)}
      >
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Empty className={className}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Could not load your notifications</EmptyTitle>
          <EmptyDescription>{error.message}</EmptyDescription>
        </EmptyHeader>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <ArrowClockwiseIcon data-icon="inline-start" />
            Try again
          </Button>
        ) : null}
      </Empty>
    );
  }

  if (notifications.length === 0) {
    return (
      <Empty className={className}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BellSimpleIcon />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ItemGroup role="list" className={cn('gap-0', className)}>
      {notifications.map((notification, index) => (
        <Fragment key={notification.id}>
          {index > 0 ? <ItemSeparator className="my-0" /> : null}
          <Item
            role="listitem"
            size="sm"
            // The whole row is the target, not a link inside it, and it clears
            // 44px on touch through the min-height rather than through padding.
            //
            // Activated the way `RecordTable` activates a row -- tabIndex plus
            // Enter, PRD §6.4 -- rather than by rendering a button inside the
            // Item. Space is added because this row behaves as a button rather
            // than as a table row, and a button that ignores Space is a button
            // half the keyboard users of this product will think is broken.
            className="hover:bg-accent/50 active:bg-accent min-h-11 cursor-pointer text-left"
            tabIndex={0}
            onClick={() => {
              onActivate(notification);
            }}
            onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onActivate(notification);
            }}
          >
            <ItemContent className="min-w-0 gap-0.5">
              <ItemTitle
                className={cn(
                  'flex min-w-0 items-center gap-2 text-xs',
                  notification.readAt === null ? 'font-semibold' : 'font-normal',
                )}
              >
                {notification.readAt === null ? (
                  <span
                    aria-hidden
                    className="bg-primary size-1.5 shrink-0 rounded-full"
                  />
                ) : null}
                <NotificationGlyph eventType={notification.eventType} />
                <span className="min-w-0 truncate">{notification.title}</span>
                <span className="text-muted-foreground ml-auto shrink-0 text-[11px] font-normal tabular-nums">
                  {relativeTime(notification.createdAt)}
                </span>
              </ItemTitle>
              <ItemDescription className="text-xs">{notification.body}</ItemDescription>
            </ItemContent>
          </Item>
        </Fragment>
      ))}
    </ItemGroup>
  );
}

/** The event family's glyph (owner, 22 Aug 2026), so a bell row reads before its words do. */
function NotificationGlyph({ eventType }: { eventType: string }) {
  return createElement(notificationIcon(eventType), { 'aria-hidden': true, className: 'text-muted-foreground size-3.5 shrink-0' });
}
