import type { DayStatus } from "@attendance/shared"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

/**
 * One hue per day status, read from the `--status-*` tokens. Colour lives in
 * index.css; this map only names tokens, so a palette change is one file.
 */
const STATUS: Record<
  DayStatus,
  { short: string; label: string; className: string }
> = {
  PRESENT: {
    short: "P",
    label: "Present",
    className: "bg-status-present/12 text-status-present",
  },
  HALF_DAY: {
    short: "HD",
    label: "Half day",
    className: "bg-status-half-day/15 text-status-half-day",
  },
  ABSENT: {
    short: "A",
    label: "Absent",
    className: "bg-status-absent/12 text-status-absent",
  },
  ON_LEAVE: {
    short: "L",
    label: "On leave",
    className: "bg-status-leave/12 text-status-leave",
  },
  ON_LEAVE_HALF: {
    short: "LH",
    label: "Half-day leave",
    className: "bg-status-leave/12 text-status-leave",
  },
  WEEKLY_OFF: {
    short: "WO",
    label: "Weekly off",
    className: "bg-status-weekly-off/12 text-status-weekly-off",
  },
  HOLIDAY: {
    short: "H",
    label: "Holiday",
    className: "bg-status-holiday/12 text-status-holiday",
  },
  WFH: {
    short: "W",
    label: "Work from home",
    className: "bg-status-wfh/12 text-status-wfh",
  },
  ON_DUTY: {
    short: "OD",
    label: "On duty",
    className: "bg-status-on-duty/12 text-status-on-duty",
  },
  PENDING_APPROVAL: {
    short: "PA",
    label: "Pending approval",
    className: "bg-warning/15 text-warning",
  },
}

export const DAY_STATUS_META = STATUS

export function StatusBadge({
  status,
  variant = "full",
  className,
}: {
  status: DayStatus
  /** `code` renders the short muster code only — used inside the grid. */
  variant?: "full" | "code"
  className?: string
}) {
  const meta = STATUS[status]
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent", meta.className, className)}
    >
      {variant === "code" ? (
        meta.short
      ) : (
        <>
          <span className="font-semibold">{meta.short}</span>
          <span className="font-normal">{meta.label}</span>
        </>
      )}
    </Badge>
  )
}

export function StatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {(Object.keys(STATUS) as DayStatus[])
        .filter((status) => status !== "ON_LEAVE_HALF" && status !== "PENDING_APPROVAL")
        .map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
    </div>
  )
}
