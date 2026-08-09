import { useNavigate } from "react-router"
import { formatDistanceToNow } from "date-fns"
import { Bell, CheckCheck } from "lucide-react"
import { notificationTone } from "@attendance/shared"

import { cn } from "@/lib/utils"
import { useMarkNotificationsRead, useNotifications } from "@/lib/queries"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"

const TONE_DOT: Record<ReturnType<typeof notificationTone>, string> = {
  info: "bg-status-wfh",
  success: "bg-status-present",
  warning: "bg-status-half-day",
  muted: "bg-muted-foreground",
}

/**
 * The topbar bell. Approvals used to sit in a queue nobody was told about, and
 * the escalation settings fired into a log line at best.
 *
 * Hidden entirely in a demo session rather than shown empty: a bell that can
 * never have anything in it is chrome that teaches people to ignore bells.
 */
export function NotificationBell() {
  const navigate = useNavigate()
  const { notifications, unread, enabled } = useNotifications()
  const markRead = useMarkNotificationsRead()

  if (!enabled) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell />
          {unread > 0 ? (
            /*
              White count text on a red dark enough to hold it, in both themes
              (rule 1.7 wants 4.5:1). It read `text-destructive-foreground`,
              which this theme never defines — so the count inherited the
              button's foreground and came out near-black on red at 4.03:1 in
              light, and 2.75:1 in dark.

              `ring-background` keeps the dot legible where it overlaps the bell
              rather than clipping into it.
            */
            <span className="bg-notification-badge ring-background absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white tabular-nums ring-2">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => markRead.mutate(undefined)}
              disabled={markRead.isPending}
            >
              <CheckCheck />
              Mark all read
            </Button>
          ) : null}
        </div>
        <Separator />
        <div className="max-h-80 overflow-y-auto overscroll-contain">
          {notifications.length === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Bell />
                </EmptyMedia>
                <EmptyTitle>Nothing yet</EmptyTitle>
                <EmptyDescription>
                  Requests raised for you, decisions on yours, and escalations land here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            notifications.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  if (entry.readAt === null) markRead.mutate([entry.id])
                  navigate(entry.href)
                }}
                className={cn(
                  "hover:bg-muted/60 flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                  index > 0 && "border-t"
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    entry.readAt === null ? TONE_DOT[notificationTone(entry.kind)] : "bg-transparent"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      entry.readAt === null ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {entry.title}
                  </span>
                  <span className="text-muted-foreground block text-xs">{entry.body}</span>
                  <span className="text-muted-foreground/70 mt-0.5 block text-[11px]">
                    {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
