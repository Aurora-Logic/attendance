import { z } from 'zod';

import {
  LEAVE_DAY_PORTIONS,
  type LeaveCalendar,
  type LeaveCalendarEntry,
  type LeaveCalendarWarning,
  type LeaveDayPortion,
} from '@vyuha/shared';

import { toDateParam } from '@/features/attendance/format';

import { leaveTypeRefSchema, namedRefSchema } from './types';

/**
 * REQ-G-12, the parts that are arithmetic rather than markup.
 *
 * Kept out of the screen so they can be tested without a DOM: how many people
 * a date costs, which dates the server flagged, and where a month begins and
 * ends. The screen renders what these return and decides nothing itself.
 *
 * The threshold and the warnings are the server's — `GET /leave/calendar`
 * reads the organisation's `concurrent_absence_threshold` setting and answers
 * with both the entries and the dates that breach it. Nothing here re-derives
 * a warning: two places counting absences is two places to disagree about
 * whether today is safe to approve.
 */

const leaveCalendarEntrySchema = z.object({
  employee: namedRefSchema,
  department: namedRefSchema.nullable(),
  leaveType: leaveTypeRefSchema,
  date: z.string(),
  portion: z.enum(LEAVE_DAY_PORTIONS),
  leaveRequestId: z.string(),
}) satisfies z.ZodType<LeaveCalendarEntry>;

const leaveCalendarWarningSchema = z.object({
  date: z.string(),
  department: namedRefSchema.nullable(),
  awayCount: z.number().int(),
  threshold: z.number().int(),
}) satisfies z.ZodType<LeaveCalendarWarning>;

export const leaveCalendarSchema = z.object({
  from: z.string(),
  to: z.string(),
  entries: z.array(leaveCalendarEntrySchema),
  warnings: z.array(leaveCalendarWarningSchema),
  threshold: z.number().int(),
}) satisfies z.ZodType<LeaveCalendar>;

export type { LeaveCalendar, LeaveCalendarEntry, LeaveCalendarWarning };

export const PORTION_LABELS: Record<LeaveDayPortion, string> = {
  FULL: 'Full day',
  FIRST_HALF: 'First half',
  SECOND_HALF: 'Second half',
};

/**
 * The first and last date of the month a date falls in, inclusive.
 *
 * `toDateParam` rather than `toISOString().slice(0, 10)`: NFR-05 stores a
 * leave date as a DATE and not an instant, and converting through UTC moves
 * every date back a day for anyone east of Greenwich after mid-afternoon —
 * which here means a manager in India opening August and being sent July.
 */
export function monthBounds(date: Date): { from: string; to: string } {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  // Day 0 of the next month is the last day of this one, so February and the
  // leap day come from the runtime rather than from a table written here.
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: toDateParam(first), to: toDateParam(last) };
}

/**
 * Entries grouped by the date they fall on, each group sorted by name.
 *
 * One entry is one employee-day, so a five-day leave contributes five entries.
 * The grouping is what turns that into "who is away on the 14th".
 */
export function entriesByDate(
  entries: readonly LeaveCalendarEntry[],
): Map<string, LeaveCalendarEntry[]> {
  const byDate = new Map<string, LeaveCalendarEntry[]>();
  for (const entry of entries) {
    const bucket = byDate.get(entry.date);
    if (bucket === undefined) byDate.set(entry.date, [entry]);
    else bucket.push(entry);
  }
  for (const bucket of byDate.values()) {
    bucket.sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  }
  return byDate;
}

/**
 * How many people a date costs.
 *
 * Distinct employees, not entries: an employee who took a first half on one
 * request and a second half on another is one person away that day, and
 * counting them twice would raise a warning the server never raised.
 */
export function awayCount(entries: readonly LeaveCalendarEntry[]): number {
  return new Set(entries.map((entry) => entry.employee.id)).size;
}

/** The server's warnings, keyed by date, so a day cell can ask about itself. */
export function warningsByDate(
  warnings: readonly LeaveCalendarWarning[],
): Map<string, LeaveCalendarWarning[]> {
  const byDate = new Map<string, LeaveCalendarWarning[]>();
  for (const warning of warnings) {
    const bucket = byDate.get(warning.date);
    if (bucket === undefined) byDate.set(warning.date, [warning]);
    else bucket.push(warning);
  }
  return byDate;
}

/**
 * One warning as a sentence.
 *
 * The department is named when the server sent one; an employee with no
 * department still counts towards a threshold, and saying "across the
 * organisation" is honest about which pool was counted rather than inventing
 * a department name for the row.
 */
export function warningSentence(warning: LeaveCalendarWarning): string {
  const where = warning.department === null ? 'across the organisation' : `in ${warning.department.name}`;
  return `${String(warning.awayCount)} away ${where}, at or over the threshold of ${String(warning.threshold)}.`;
}
