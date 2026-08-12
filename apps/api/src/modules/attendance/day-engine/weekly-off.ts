import { z } from 'zod';

import { occurrenceInMonth, parseCalendarDate } from './calendar-date.js';

/**
 * REQ-C-03, and 05-decisions: "Admin ticks the off days, alternate-Saturday
 * rule as a toggle, per-person override available. Nothing hardcoded."
 *
 * `weekly_off_patterns.config` is jsonb, the one column type Postgres will not
 * constrain for us, so it is validated on every read. CLAUDE.md is explicit
 * that anything crossing a boundary is untrusted input "even when you wrote
 * both ends" -- and this end will eventually be written by an admin screen.
 */

const isoWeekday = z.number().int().min(1).max(7);

export const weeklyOffConfigSchema = z
  .object({
    /** ISO-8601 weekdays that are always off. 1 = Monday, 7 = Sunday. */
    weekdays: z.array(isoWeekday).max(7),
    /**
     * Which occurrences of Saturday in the month are off, 1-5. REQ-C-03's
     * "alternate Saturdays (2nd/4th)" is `[2, 4]`. Absent or empty means the
     * rule is off, which is not the same as every Saturday being off -- that
     * is `weekdays: [6]`.
     */
    saturdaysOfMonth: z.array(z.number().int().min(1).max(5)).max(5).optional(),
  })
  .strict();

export type WeeklyOffConfig = z.infer<typeof weeklyOffConfigSchema>;

/**
 * Throws on a malformed pattern, naming the row.
 *
 * The tempting alternative -- treat an unreadable pattern as "no weekly offs"
 * -- turns a configuration mistake into a month of people marked ABSENT on
 * their day off, with no error anywhere to explain it. CLAUDE.md: the bugs that
 * cost the most are the ones that produce no error.
 */
export function parseWeeklyOffConfig(value: unknown, patternId: string): WeeklyOffConfig {
  const result = weeklyOffConfigSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`weekly_off_patterns.config is malformed for pattern ${patternId} -- ${issues}`);
  }
  return result.data;
}

const SATURDAY = 6;

/** REQ-C-03. Pure, so the roster screen and the day engine cannot disagree. */
export function matchesWeeklyOff(config: WeeklyOffConfig, date: string): boolean {
  const calendar = parseCalendarDate(date);

  if (config.weekdays.includes(calendar.isoWeekday)) return true;

  const saturdays = config.saturdaysOfMonth;
  if (saturdays !== undefined && calendar.isoWeekday === SATURDAY) {
    return saturdays.includes(occurrenceInMonth(calendar));
  }

  return false;
}
