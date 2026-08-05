import type { EstimateDisplayStatus, PoDisplayStatus, ScheduleStatus } from "@attendance/shared"

import { Badge } from "@/components/ui/badge"

/**
 * Same principle as StatusBadge: four outcomes carry colour — moving (info),
 * needs attention (warning), done (success), dead (destructive) — the rest
 * stay neutral so the register reads as data. Variants only, per F12.
 */
const PO_STATUS_META: Record<
  PoDisplayStatus,
  { label: string; variant: "success" | "warning" | "info" | "destructive" | "secondary" | "outline" }
> = {
  DRAFT: { label: "Draft", variant: "outline" },
  PENDING_APPROVAL: { label: "Pending approval", variant: "warning" },
  APPROVED: { label: "Approved", variant: "info" },
  PARTIALLY_RECEIVED: { label: "Partially received", variant: "info" },
  RECEIVED: { label: "Received", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
  CLOSED: { label: "Closed", variant: "secondary" },
}

export function PoStatusBadge({ status }: { status: PoDisplayStatus }) {
  const meta = PO_STATUS_META[status]
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

export const PO_STATUS_LABEL = Object.fromEntries(
  Object.entries(PO_STATUS_META).map(([status, meta]) => [status, meta.label])
) as Record<PoDisplayStatus, string>

const SCHEDULE_META: Record<
  ScheduleStatus,
  { label: string; variant: "success" | "warning" | "destructive" | "secondary" }
> = {
  FULFILLED: { label: "Fulfilled", variant: "success" },
  ON_TRACK: { label: "On track", variant: "secondary" },
  DUE_SOON: { label: "Due soon", variant: "warning" },
  OVERDUE: { label: "Overdue", variant: "destructive" },
}

export function ScheduleStatusBadge({ status }: { status: ScheduleStatus }) {
  const meta = SCHEDULE_META[status]
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

/** Estimate lifecycle, same colour discipline as POs. */
const ESTIMATE_META: Record<
  EstimateDisplayStatus,
  { label: string; variant: "success" | "warning" | "info" | "destructive" | "secondary" | "outline" }
> = {
  DRAFT: { label: "Draft", variant: "outline" },
  SENT: { label: "Sent", variant: "info" },
  ACCEPTED: { label: "Accepted", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  EXPIRED: { label: "Expired", variant: "warning" },
  CLOSED: { label: "Closed", variant: "secondary" },
}

export function EstimateStatusBadge({ status }: { status: EstimateDisplayStatus }) {
  const meta = ESTIMATE_META[status]
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

export const ESTIMATE_STATUS_LABEL = Object.fromEntries(
  Object.entries(ESTIMATE_META).map(([status, meta]) => [status, meta.label])
) as Record<EstimateDisplayStatus, string>
