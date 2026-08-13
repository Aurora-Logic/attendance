import { roundLeaveDays, type LeaveDayPortion } from '@vyuha/shared';

import { addDays, parseCalendarDate } from '../day-engine/calendar-date.js';

/**
 * REQ-G-06 and REQ-G-07: turning a date range into the days a leave actually
 * consumes.
 *
 * Pure, and separate from the service, because this is the arithmetic the
 * employee is asked to trust before they submit and the arithmetic the balance
 * is deducted by afterwards. The preview endpoint and the application endpoint
 * both call this one function, so the number on the form is the number that is
 * deducted -- not a client-side estimate the server later disagrees with.
 *
 * Nothing here reads a database. The caller supplies which dates are holidays
 * and which are weekly offs, because those come from the employee's calendar
 * and roster, and the day engine already owns both lookups.
 */

export interface LeaveDayExpansionInput {
  readonly fromDate: string;
  readonly toDate: string;
  readonly fromPortion: LeaveDayPortion;
  readonly toPortion: LeaveDayPortion;
  /** True for a date the employee's holiday calendar marks (REQ-H-01). */
  readonly isHoliday: (date: string) => boolean;
  /** True for a date the employee's weekly-off pattern marks (REQ-C-03). */
  readonly isWeeklyOff: (date: string) => boolean;
  /** REQ-G-01's `counts_sandwich_days` on the leave type. */
  readonly countsSandwichDays: boolean;
}

export interface ExpandedLeaveDay {
  readonly date: string;
  readonly portion: LeaveDayPortion;
  /** False for a non-working day inside the range that is not deducted. */
  readonly isCounted: boolean;
  /** Why it was not counted, for the preview's breakdown. */
  readonly nonWorking: 'HOLIDAY' | 'WEEKLY_OFF' | null;
}

export interface LeaveDayExpansion {
  readonly days: readonly ExpandedLeaveDay[];
  readonly calendarDays: number;
  readonly workingDays: number;
  readonly holidaysSkipped: number;
  readonly weeklyOffsSkipped: number;
  readonly sandwichDaysCounted: number;
  readonly halfDays: number;
  readonly totalDays: number;
}

/**
 * Guards a range someone typed. A year of leave is a mistake, not a request,
 * and expanding one date at a time means an unbounded range is an unbounded
 * loop and an unbounded INSERT.
 */
export const MAX_LEAVE_RANGE_DAYS = 366;

const HALF = 0.5;

function portionValue(portion: LeaveDayPortion): number {
  return portion === 'FULL' ? 1 : HALF;
}

/**
 * REQ-G-07: "no application on holidays/weekly offs (they are skipped, not
 * consumed, unless the type counts sandwich days)".
 *
 * The one word the requirement leaves to interpretation is *sandwich*. Read
 * literally, every non-working day in the range would be consumed by a type
 * with the flag set -- which would charge somebody for the Sunday their leave
 * happens to end on. A sandwich day, in the sense the column is named for, is
 * one with a working leave day on each side of it, and that is what this
 * counts: leading and trailing non-working days are never consumed, whatever
 * the flag says.
 *
 * Flagged in the slice report as an interpretation, and it is one line to
 * change if the intended reading was the literal one -- `sandwichStart` and
 * `sandwichEnd` are the whole of it.
 */
export function expandLeaveDays(input: LeaveDayExpansionInput): LeaveDayExpansion {
  // Both are validated as calendar dates by the schema; this catches the
  // ordering, which a schema on two independent fields cannot.
  if (input.toDate < input.fromDate) {
    throw new RangeError(`Leave range ends before it starts: ${input.fromDate}..${input.toDate}`);
  }
  parseCalendarDate(input.fromDate);
  parseCalendarDate(input.toDate);

  const dates: string[] = [];
  for (let date = input.fromDate; date <= input.toDate; date = addDays(date, 1)) {
    dates.push(date);
    if (dates.length > MAX_LEAVE_RANGE_DAYS) {
      throw new RangeError(
        `A leave range may not exceed ${String(MAX_LEAVE_RANGE_DAYS)} days; received ${input.fromDate}..${input.toDate}.`,
      );
    }
  }

  const nonWorking = dates.map((date): ExpandedLeaveDay['nonWorking'] => {
    // A holiday that is also a weekly off is one skipped day, not two, and it
    // is reported as a holiday because that is the reason a reader recognises.
    if (input.isHoliday(date)) return 'HOLIDAY';
    if (input.isWeeklyOff(date)) return 'WEEKLY_OFF';
    return null;
  });

  const firstWorking = nonWorking.findIndex((reason) => reason === null);
  const lastWorking = nonWorking.findLastIndex((reason) => reason === null);
  const sandwichStart = firstWorking;
  const sandwichEnd = lastWorking;

  const lastIndex = dates.length - 1;
  const days: ExpandedLeaveDay[] = [];
  let holidaysSkipped = 0;
  let weeklyOffsSkipped = 0;
  let sandwichDaysCounted = 0;
  let workingDays = 0;
  let halfDays = 0;
  let totalDays = 0;

  dates.forEach((date, index) => {
    const reason = nonWorking[index] ?? null;

    if (reason !== null) {
      const sandwiched =
        input.countsSandwichDays &&
        sandwichStart >= 0 &&
        index > sandwichStart &&
        index < sandwichEnd;

      if (!sandwiched) {
        if (reason === 'HOLIDAY') holidaysSkipped += 1;
        else weeklyOffsSkipped += 1;
        days.push({ date, portion: 'FULL', isCounted: false, nonWorking: reason });
        return;
      }

      // A sandwiched day is consumed whole. A half-day flag applies to a
      // boundary the employee chose, and a sandwiched day is by definition not
      // one of the boundaries.
      sandwichDaysCounted += 1;
      totalDays += 1;
      days.push({ date, portion: 'FULL', isCounted: true, nonWorking: reason });
      return;
    }

    // The two boundaries can be the same date: a one-day half-day application
    // sets both portions off one control and must still count 0.5, not 0.
    const portion: LeaveDayPortion =
      index === 0 && input.fromPortion !== 'FULL'
        ? input.fromPortion
        : index === lastIndex && input.toPortion !== 'FULL'
          ? input.toPortion
          : 'FULL';

    workingDays += 1;
    if (portion !== 'FULL') halfDays += 1;
    totalDays += portionValue(portion);
    days.push({ date, portion, isCounted: true, nonWorking: null });
  });

  return {
    days,
    calendarDays: dates.length,
    workingDays,
    holidaysSkipped,
    weeklyOffsSkipped,
    sandwichDaysCounted,
    halfDays,
    totalDays: roundLeaveDays(totalDays),
  };
}
