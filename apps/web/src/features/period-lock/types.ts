import { z } from 'zod';

/**
 * `GET/POST/DELETE /attendance/locks` (REQ-E-09), as this screen reads them.
 *
 * The endpoints do not exist. The shape below is taken from the
 * `attendance_period_locks` columns in technical design §4.2 rather than
 * invented, so connecting the screen later is a matter of the server matching a
 * contract that was already written down.
 *
 * Unlocking writes `unlockedAt` on the existing row rather than removing it:
 * "who locked March, who unlocked it, and why" has to survive, and a deleted
 * row audits badly.
 */

const actorSchema = z.object({ id: z.string(), name: z.string().nullable() });

export const periodLockSchema = z.object({
  id: z.string(),
  /** Null is an org-wide lock. One location today, so this is normally null. */
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  lockedAt: z.string(),
  lockedBy: actorSchema.nullable(),
  unlockedAt: z.string().nullable(),
  unlockedBy: actorSchema.nullable(),
  /** REQ-E-09 requires a reason to unlock. Null while the lock still stands. */
  reason: z.string().nullable(),
});

export type PeriodLock = z.infer<typeof periodLockSchema>;

export const periodLocksResponseSchema = z.object({ data: z.array(periodLockSchema) });

export type PeriodLocksResponse = z.infer<typeof periodLocksResponseSchema>;

/** A lock is live until it is unlocked; an unlocked row is history. */
export function isLive(lock: PeriodLock): boolean {
  return lock.unlockedAt === null;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function periodLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? String(month)} ${String(year)}`;
}

/** REQ-E-09 needs a reason substantial enough to mean something in an audit. */
export const MIN_UNLOCK_REASON = 10;
export const MAX_UNLOCK_REASON = 500;
