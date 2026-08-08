import * as z from "zod"

/**
 * In-app notifications. Approvals sat in a queue nobody was told about, and
 * the escalation settings had never fired — a manager on leave silently
 * stalled every request routed to them.
 *
 * In-app only, deliberately: email and WhatsApp need SMTP/provider
 * credentials the company has not supplied, and a delivery channel that
 * silently drops messages is worse than one that visibly does not exist yet.
 * The feed is the durable record; a channel adapter can read from it later.
 */

export const NOTIFICATION_KINDS = [
  "APPROVAL_RAISED",
  "APPROVAL_DECIDED",
  "APPROVAL_ESCALATED",
  "PUNCH_FLAGGED",
  "COMP_OFF_EXPIRING",
] as const
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS)
export type NotificationKind = z.infer<typeof notificationKindSchema>

export const notificationSchema = z.object({
  id: z.string(),
  /** Employee this is *for* — the feed is always scoped to one person. */
  employeeId: z.string(),
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string(),
  /** Where clicking it should go, e.g. "/approvals". */
  href: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
})
export type Notification = z.infer<typeof notificationSchema>

/** Tone for the dot beside each row — same vocabulary as the status badges. */
export function notificationTone(
  kind: NotificationKind
): "info" | "success" | "warning" | "muted" {
  switch (kind) {
    case "APPROVAL_DECIDED":
      return "success"
    case "APPROVAL_ESCALATED":
    case "PUNCH_FLAGGED":
    case "COMP_OFF_EXPIRING":
      return "warning"
    case "APPROVAL_RAISED":
      return "info"
  }
}

export const unreadCount = (feed: Notification[]): number =>
  feed.filter((entry) => entry.readAt === null).length

/**
 * Has an approval waited long enough to move up? Escalation is measured in
 * whole days from when it was raised, matching how the setting reads
 * ("escalate to L2 after N days") rather than in hours, which would surprise
 * someone who raised a request at 23:50.
 */
export function shouldEscalate(
  createdAtISO: string,
  afterDays: number,
  nowISO: string
): boolean {
  const created = new Date(createdAtISO).getTime()
  const now = new Date(nowISO).getTime()
  if (!Number.isFinite(created) || !Number.isFinite(now)) return false
  return Math.floor((now - created) / 86_400_000) >= afterDays
}
