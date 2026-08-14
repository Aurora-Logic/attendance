import { z } from 'zod';

import type {
  RecomputeSummary,
  RestrictedHolidayOption,
  RestrictedHolidayPool,
  RestrictedHolidayResult,
} from '@vyuha/shared';

/**
 * REQ-H-03: "Employees choose up to N per year from a pool; the choice
 * consumes an allowance and marks the day HOLIDAY for them only."
 *
 * The parsers and the small amount of arithmetic the screen needs. `remaining`
 * is never computed here — the server serves it, precisely so that two places
 * are not subtracting the same numbers and disagreeing about whether the
 * button should be enabled.
 */

const recomputeSummarySchema = z.object({
  considered: z.number().int(),
  recomputed: z.number().int(),
  locked: z.number().int(),
  failed: z.number().int(),
}) satisfies z.ZodType<RecomputeSummary>;

const restrictedHolidayOptionSchema = z.object({
  id: z.string(),
  date: z.string(),
  name: z.string(),
  restricted: z.boolean(),
  elected: z.boolean(),
}) satisfies z.ZodType<RestrictedHolidayOption>;

export const restrictedHolidayPoolSchema = z.object({
  employeeId: z.string(),
  calendarId: z.string().nullable(),
  year: z.number().int(),
  allowance: z.number().int(),
  used: z.number().int(),
  remaining: z.number().int(),
  options: z.array(restrictedHolidayOptionSchema),
}) satisfies z.ZodType<RestrictedHolidayPool>;

export const restrictedHolidayResultSchema = z.object({
  pool: restrictedHolidayPoolSchema,
  recompute: recomputeSummarySchema,
}) satisfies z.ZodType<RestrictedHolidayResult>;

export type { RecomputeSummary, RestrictedHolidayOption, RestrictedHolidayPool };

/**
 * Why the pool cannot be used, or null when it can.
 *
 * Three different nothings that a single empty state would blur into one:
 * no calendar attached to this person at all, a calendar that does not run
 * restricted holidays, and a calendar that runs them but has none listed. Each
 * needs a different person to do a different thing about it, so each says so.
 */
export type PoolBlocker = 'NO_CALENDAR' | 'NOT_ENABLED' | 'NONE_LISTED' | null;

export function poolBlocker(pool: RestrictedHolidayPool | undefined): PoolBlocker {
  if (pool === undefined) return null;
  if (pool.calendarId === null) return 'NO_CALENDAR';
  if (pool.allowance <= 0) return 'NOT_ENABLED';
  if (pool.options.length === 0) return 'NONE_LISTED';
  return null;
}

/**
 * The pool in the order a person reads it: by date.
 *
 * The server returns whatever the calendar holds; a chronological list is what
 * makes "which of these is next" answerable without scanning.
 */
export function sortedOptions(
  pool: RestrictedHolidayPool | undefined,
): readonly RestrictedHolidayOption[] {
  if (pool === undefined) return [];
  return pool.options.toSorted((a, b) => a.date.localeCompare(b.date));
}

/**
 * The allowance as a sentence.
 *
 * Both numbers, always. "1 left" alone hides whether the allowance is one or
 * five, and an employee deciding between two festivals needs the denominator.
 */
export function allowanceSentence(pool: RestrictedHolidayPool): string {
  const taken = `${String(pool.used)} of ${String(pool.allowance)} taken`;
  if (pool.remaining <= 0) return `${taken}. None left this year.`;
  return `${taken}. ${String(pool.remaining)} left.`;
}

/**
 * What actually changed on the attendance record, for the toast.
 *
 * REQ-H-03 marks the day HOLIDAY "for them only", which the server does inline
 * by recomputing that one day. Reporting the count makes the effect something
 * the reader can see rather than something they have to trust — and a locked
 * period silently refusing the recompute is exactly the case that would
 * otherwise pass unnoticed.
 */
export function recomputeSentence(summary: RecomputeSummary): string {
  if (summary.locked > 0) {
    return 'The day falls in a locked period, so the attendance record was left alone.';
  }
  if (summary.failed > 0) {
    return 'The attendance day could not be recomputed; ask an administrator to check the roster.';
  }
  if (summary.recomputed === 0) return 'No attendance day needed recomputing.';
  return `${String(summary.recomputed)} attendance day${summary.recomputed === 1 ? '' : 's'} recomputed.`;
}
