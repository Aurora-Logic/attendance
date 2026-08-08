import * as z from "zod"

/**
 * The layer over Tally.
 *
 * Tally is the system of record for commercial masters and stock — customers,
 * items, vendors, ledgers. This app is the operational layer on top: it adds
 * the workflow Tally has no opinion about (picking, packing, dispatch, proof
 * of delivery) and pushes the resulting documents back.
 *
 * Attendance and payroll are deliberately **outside** this boundary. They are
 * this system's own domain and never sync.
 *
 * Connectivity is a connector agent on the Windows machine where Tally runs:
 * Tally's XML gateway listens only on the local network and only while Tally
 * is open, so nothing hosted elsewhere can reach it directly. The agent talks
 * to Tally locally and to this API over HTTPS, which also means it can queue
 * while Tally is closed instead of losing the change.
 */

/* ------------------------------------------------------------- entities */

export const TALLY_ENTITIES = ["customer", "vendor", "item", "stockGroup", "ledger"] as const
export const tallyEntitySchema = z.enum(TALLY_ENTITIES)
export type TallyEntity = z.infer<typeof tallyEntitySchema>

/**
 * One synced record, in the shape both sides agree on.
 *
 * `tallyGuid` is Tally's own identifier and the join key — names change, GUIDs
 * do not. `alterId` is Tally's monotonic edit counter, which is how we ask it
 * for "everything changed since" without diffing whole masters.
 */
export const syncRecordSchema = z.object({
  entity: tallyEntitySchema,
  tallyGuid: z.string().min(1),
  /** Tally's master name — display only. Never a key. */
  name: z.string(),
  /** Tally's AlterID at the time this snapshot was taken. */
  alterId: z.number().int().nonnegative(),
  /** When this side last changed the record (ISO 8601, UTC). */
  updatedAt: z.string(),
  /** Whatever the entity carries; validated per entity downstream. */
  fields: z.record(z.string(), z.unknown()),
})
export type SyncRecord = z.infer<typeof syncRecordSchema>

/* --------------------------------------------------------- reconciliation */

export type SyncSide = "app" | "tally"

export type SyncDecision =
  | { action: "pull"; reason: string }
  | { action: "push"; reason: string }
  | { action: "none"; reason: string }
  | { action: "conflict"; winner: SyncSide; reason: string }

/**
 * Which side wins, when both may edit.
 *
 * Last-write-wins on `updatedAt`, with one rule that matters more than the
 * comparison: a decision is only ever `conflict` when **both** sides changed
 * since the last successful sync. That distinction is what stops a routine
 * one-sided edit from being reported as a conflict, and what makes the
 * conflict log small enough that somebody actually reads it.
 *
 * Ties go to Tally. Two edits in the same millisecond are almost certainly one
 * logical change echoing back, and Tally is the accounting record.
 */
export function reconcile(input: {
  app: { updatedAt: string } | null
  tally: { updatedAt: string; alterId: number } | null
  /** State at the end of the last successful sync, if there was one. */
  lastSynced: { updatedAt: string; alterId: number } | null
}): SyncDecision {
  const { app, tally, lastSynced } = input

  if (!app && !tally) return { action: "none", reason: "Nothing on either side." }
  if (!app && tally) return { action: "pull", reason: "New in Tally." }
  if (app && !tally) return { action: "push", reason: "New here, not yet in Tally." }

  const appTime = Date.parse(app!.updatedAt)
  const tallyTime = Date.parse(tally!.updatedAt)
  if (!Number.isFinite(appTime) || !Number.isFinite(tallyTime)) {
    // An unparseable timestamp must not silently win. Tally is the record.
    return { action: "pull", reason: "A timestamp was unreadable; taking Tally's copy." }
  }

  if (!lastSynced) {
    // Never synced: both exist independently, so this genuinely is a conflict.
    const winner: SyncSide = tallyTime >= appTime ? "tally" : "app"
    return {
      action: "conflict",
      winner,
      reason: "Both sides already had this record before the first sync.",
    }
  }

  const lastTime = Date.parse(lastSynced.updatedAt)
  const appChanged = appTime > lastTime
  const tallyChanged = tally!.alterId > lastSynced.alterId

  if (!appChanged && !tallyChanged) return { action: "none", reason: "Unchanged on both sides." }
  if (tallyChanged && !appChanged) return { action: "pull", reason: "Changed in Tally only." }
  if (appChanged && !tallyChanged) return { action: "push", reason: "Changed here only." }

  const winner: SyncSide = tallyTime >= appTime ? "tally" : "app"
  return {
    action: "conflict",
    winner,
    reason:
      winner === "tally"
        ? "Both sides changed; Tally's edit is newer."
        : "Both sides changed; this side's edit is newer.",
  }
}

/**
 * A conflict that was resolved. Last-write-wins **discards** something, so the
 * losing copy is kept here: an accountant who finds a master wrong needs to
 * see what the other side said, not be told a timestamp settled it.
 */
export const syncConflictSchema = z.object({
  id: z.string(),
  entity: tallyEntitySchema,
  tallyGuid: z.string(),
  name: z.string(),
  winner: z.enum(["app", "tally"]),
  reason: z.string(),
  /** The copy that lost, verbatim, so it can be restored by hand. */
  discarded: z.record(z.string(), z.unknown()),
  at: z.string(),
  /** Cleared once a human has looked at it. */
  reviewedAt: z.string().nullable(),
})
export type SyncConflict = z.infer<typeof syncConflictSchema>

/* --------------------------------------------------- the agent's contract */

export const syncPullRequestSchema = z.object({
  /** Highest AlterID this side has already seen, per entity. */
  /** Highest AlterID seen per entity; absent means never synced. */
  since: z.partialRecord(tallyEntitySchema, z.number().int().nonnegative()).default({}),
})

export const syncPushRequestSchema = z.object({
  agentVersion: z.string().default(""),
  /** Company as loaded in Tally — a mismatch means the wrong books. */
  company: z.string().min(1),
  records: z.array(syncRecordSchema).max(2000),
})
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>

export const AGENT_HEARTBEAT_STALE_MS = 10 * 60 * 1000

/**
 * Is the connector still alive? A sync layer that silently stops is worse than
 * one that was never connected: screens keep showing masters that are quietly
 * hours or days out of date.
 */
export function agentHealth(
  lastSeenISO: string | null,
  nowISO: string
): { state: "never" | "live" | "stale"; staleForMs: number } {
  if (!lastSeenISO) return { state: "never", staleForMs: 0 }
  const gap = Date.parse(nowISO) - Date.parse(lastSeenISO)
  if (!Number.isFinite(gap)) return { state: "never", staleForMs: 0 }
  return {
    state: gap > AGENT_HEARTBEAT_STALE_MS ? "stale" : "live",
    staleForMs: Math.max(gap, 0),
  }
}
