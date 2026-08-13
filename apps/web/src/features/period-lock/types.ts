import { z } from 'zod';

/**
 * `GET/POST/DELETE /attendance/locks` (REQ-E-09).
 *
 * Unlocking writes `unlockedAt` on the existing row rather than removing it:
 * "who locked March, who unlocked it, and why" has to survive, and a deleted
 * row audits badly.
 *
 * Two reason fields, not one. REQ-E-09 requires a reason for both actions, and
 * a single column would mean an unlock overwrote the reason the month was
 * closed for — the half an auditor is more likely to want. Migration 0011
 * renamed the original `reason` column to `lock_reason` and added the other.
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
  lockReason: z.string().nullable(),
  unlockedAt: z.string().nullable(),
  unlockedBy: actorSchema.nullable(),
  unlockReason: z.string().nullable(),
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
