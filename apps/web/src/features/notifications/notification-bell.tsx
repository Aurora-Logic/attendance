import { BellIcon, ChecksIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import type { NotificationSummary } from '@vyuha/shared';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

import { NotificationList } from './notification-list';
import { BELL_PAGE_SIZE } from './types';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from './use-notifications';

/**
 * REQ-K-05: "Bell shows an unread count. The count text is white on the red
 * dot."
 *
 * **Which bell.** The shell already had a `BellIcon`, inside the account menu,
 * pointing at the Updates changelog, with its unread state shown as a
 * theme-primary dot on the avatar. Two bells a few pixels apart, one meaning
 * "the product changed" and one meaning "something happened to you", is a
 * coin toss every time somebody sees a dot. The bell in the header is now
 * this one -- REQ-K-05 names it, and it is the only one of the two the PRD
 * knows about -- and Updates keeps its place in the account menu with a
 * megaphone, which is what a changelog is.
 *
 * **Popover on a desktop, Sheet on a phone.** A dropdown pinned to the
 * top-right corner of a 360px screen is the furthest point on the device from
 * the thumb; CLAUDE.md §3 asks for a bottom Sheet on small screens and the
 * account menu beside it already opens that way.
 *
 * The count falls without a reload because reading returns the server's own
 * new count and the hook writes it straight into the cache. A badge that
 * decrements a number it keeps for itself drifts the moment a second device
 * reads the same row.
 */

/** Past this the badge says "9+": three digits stop being a dot. */
const MAX_BADGE_COUNT = 9;

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span
      // REQ-K-05, literally: white on the red dot.
      //
      // `bg-destructive-solid`, not `bg-destructive`. The latter is lifted on
      // dark so destructive *text* stays legible against a dark surface, and
      // white on that lifted red measures 2.89:1 in the browser -- under
      // WCAG AA, which NFR-07 asks for. The solid token holds the light red in
      // both themes and measures 4.77:1, so both requirements are true at once.
      className="bg-destructive-solid ring-background absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white ring-2 tabular-nums"
      // The trigger's own aria-label already says how many are unread, so the
      // digits would otherwise be announced twice.
      aria-hidden
    >
      {count > MAX_BADGE_COUNT ? `${String(MAX_BADGE_COUNT)}+` : count}
    </span>
  );
}

interface PanelProps {
  notifications: readonly NotificationSummary[];
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  unread: number;
  onActivate: (notification: NotificationSummary) => void;
  onMarkAll: () => void;
  markingAll: boolean;
  onSeeAll: () => void;
}

function PanelBody({
  notifications,
  isPending,
  error,
  onRetry,
  onActivate,
}: Pick<PanelProps, 'notifications' | 'isPending' | 'error' | 'onRetry' | 'onActivate'>) {
  return (
    <NotificationList
      notifications={notifications}
      isPending={isPending}
      error={error}
      onRetry={onRetry}
      onActivate={onActivate}
      emptyTitle="No notifications"
      emptyDescription="Leave decisions, approvals and punch reminders land here."
    />
  );
}

function PanelActions({
  unread,
  onMarkAll,
  markingAll,
  onSeeAll,
}: Pick<PanelProps, 'unread' | 'onMarkAll' | 'markingAll' | 'onSeeAll'>) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="flex-1"
        disabled={unread === 0 || markingAll}
        // Stated rather than silently greyed: CLAUDE.md §4 asks for a reason
        // wherever a control is disabled.
        title={unread === 0 ? 'Nothing is unread' : undefined}
        onClick={onMarkAll}
      >
        <ChecksIcon data-icon="inline-start" />
        {markingAll ? 'Marking' : 'Mark all read'}
      </Button>
      <Button variant="outline" size="sm" className="flex-1" onClick={onSeeAll}>
        See all
      </Button>
    </>
  );
}

export function NotificationBell() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const unreadQuery = useUnreadCount();
  const unread = unreadQuery.data?.unread ?? 0;

  // Only fetched while the panel is open. The badge is one integer and does
  // not need a page of rows behind it on every screen in the product.
  const listQuery = useNotifications(
    { page: 1, pageSize: BELL_PAGE_SIZE, unreadOnly: false },
    { enabled: open },
  );
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  function activate(notification: NotificationSummary): void {
    if (notification.readAt === null) markRead.mutate(notification.id);
    setOpen(false);

    const url = notification.actionUrl;
    if (url === null) return;
    // The server builds the action URL from `WEB_BASE_URL`, so it arrives
    // absolute. Routing needs the path, and taking it apart here also means a
    // URL pointing at another origin can never navigate this app off itself.
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin !== window.location.origin) return;
      void navigate(`${parsed.pathname}${parsed.search}`);
    } catch {
      // A malformed action URL is not a reason to fail the read that just
      // succeeded; the notification is marked and the panel closes either way.
    }
  }

  function seeAll(): void {
    setOpen(false);
    void navigate('/notifications');
  }

  const label =
    unread > 0 ? `Notifications, ${String(unread)} unread` : 'Notifications, none unread';

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      data-testid="notification-bell"
      className="relative"
      onClick={isMobile ? () => { setOpen(true); } : undefined}
    >
      <BellIcon />
      <UnreadBadge count={unread} />
    </Button>
  );

  const body = (
    <PanelBody
      notifications={listQuery.data?.data ?? []}
      isPending={listQuery.isPending}
      error={listQuery.error}
      onRetry={() => {
        void listQuery.refetch();
      }}
      onActivate={activate}
    />
  );

  const actions = (
    <PanelActions
      unread={unread}
      markingAll={markAll.isPending}
      onMarkAll={() => {
        markAll.mutate();
      }}
      onSeeAll={seeAll}
    />
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          {/* A flex column with a fixed header and footer: a sheet that
              scrolls as one block slides its title and its actions out of
              view. `min-h-0` on the middle is load-bearing -- a flex child
              defaults to min-height:auto and pushes the footer off the sheet
              instead of scrolling. */}
          <SheetContent side="bottom" className="flex max-h-[80svh] flex-col gap-0 p-0">
            <SheetHeader className="border-b">
              <SheetTitle>
                Notifications
                {unread > 0 ? (
                  <span className="text-muted-foreground ml-2 text-xs font-normal tabular-nums">
                    {unread} unread
                  </span>
                ) : null}
              </SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
            <SheetFooter className="flex-row gap-2 border-t">{actions}</SheetFooter>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-88 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-semibold">Notifications</span>
          {unread > 0 ? (
            <span className="text-muted-foreground text-xs tabular-nums">{unread} unread</span>
          ) : null}
        </div>
        {/* Bounded rather than unbounded: eight rows is the page size, and a
            popover that grows past the viewport has no way back. */}
        <div className="max-h-96 overflow-y-auto">{body}</div>
        <div className="flex flex-row gap-2 border-t p-2">{actions}</div>
      </PopoverContent>
    </Popover>
  );
}
