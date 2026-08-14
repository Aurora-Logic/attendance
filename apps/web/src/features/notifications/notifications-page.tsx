import { ChecksIcon } from '@phosphor-icons/react';
import { useNavigate, useSearchParams } from 'react-router';

import type { NotificationSummary } from '@vyuha/shared';

import { PageHeader } from '@/components/shared/page-header';
import { RecordPagination } from '@/components/shared/record-pagination';
import { TabsToolbar, TabsToolbarAction } from '@/components/shared/tabs-toolbar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { NotificationList } from './notification-list';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from './use-notifications';

/**
 * REQ-K-02's list in full, with the paging the bell's panel deliberately does
 * not have.
 *
 * Off the sidebar, the same treatment `/profile` and `/updates` take: PRD §6.1
 * fixes the sidebar to Work, Records, Reports and Setup, and a personal
 * notification list belongs to none of them. It is reached from the bell.
 *
 * The page number and the filter live in the URL rather than in state, which
 * is what `RecordPagination` reads and what makes a link to page three of the
 * unread list a link to page three of the unread list.
 */

const PAGE_SIZE = 25;

function readPositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = readPositiveInt(searchParams.get('page'), 1);
  const unreadOnly = searchParams.get('view') === 'unread';

  const query = useNotifications({ page, pageSize: PAGE_SIZE, unreadOnly });
  const unreadQuery = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unread = unreadQuery.data?.unread ?? 0;

  function activate(notification: NotificationSummary): void {
    if (notification.readAt === null) markRead.mutate(notification.id);

    const url = notification.actionUrl;
    if (url === null) return;
    try {
      // Absolute when it comes from the server, and taken apart here so a URL
      // pointing at another origin can never navigate this app off itself.
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin !== window.location.origin) return;
      void navigate(`${parsed.pathname}${parsed.search}`);
    } catch {
      // A malformed action URL does not undo the read that just succeeded.
    }
  }

  function switchView(value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value === 'unread') next.set('view', 'unread');
    else next.delete('view');
    // Narrowing the list invalidates the page number: page 3 of a one-page
    // unread list renders as no rows and reads as an empty screen.
    next.delete('page');
    setSearchParams(next);
  }

  const list = (
    <div className="border">
      <NotificationList
        notifications={query.data?.data ?? []}
        isPending={query.isPending}
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
        onActivate={activate}
        emptyTitle={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
        emptyDescription={
          unreadOnly
            ? 'Everything here has been read.'
            : 'Leave decisions, approvals and punch reminders land here. Choose which of them reach you from your profile.'
        }
      />
    </div>
  );

  return (
    <>
      <PageHeader description="Everything the product has told you, newest first." />

      <Tabs value={unreadOnly ? 'unread' : 'all'} onValueChange={switchView}>
        <TabsToolbar
          list={
            <TabsList>
              <TabsTrigger value="all" className="px-3">
                All
              </TabsTrigger>
              <TabsTrigger value="unread" className="px-3">
                Unread
                {unread > 0 ? (
                  <span className="text-muted-foreground ml-1.5 tabular-nums">{unread}</span>
                ) : null}
              </TabsTrigger>
            </TabsList>
          }
        >
          <TabsToolbarAction>
            <Button
              variant="outline"
              size="sm"
              disabled={unread === 0 || markAll.isPending}
              // Stated rather than silently greyed (CLAUDE.md §4).
              title={unread === 0 ? 'Nothing is unread' : undefined}
              onClick={() => {
                markAll.mutate();
              }}
            >
              <ChecksIcon data-icon="inline-start" />
              {markAll.isPending ? 'Marking' : 'Mark all read'}
            </Button>
          </TabsToolbarAction>

          <TabsContent value="all" className="flex flex-col gap-4">
            {list}
            <RecordPagination
              page={page}
              pageSize={PAGE_SIZE}
              total={query.data?.meta.total ?? 0}
            />
          </TabsContent>
          <TabsContent value="unread" className="flex flex-col gap-4">
            {list}
            <RecordPagination
              page={page}
              pageSize={PAGE_SIZE}
              total={query.data?.meta.total ?? 0}
            />
          </TabsContent>
        </TabsToolbar>
      </Tabs>
    </>
  );
}
