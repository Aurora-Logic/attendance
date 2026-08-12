import { eachDayOfInterval, format } from 'date-fns';

/**
 * REQ-G-06 / REQ-G-07: how many days an application actually consumes.
 *
 * Pure, and separate from the form, because this is the arithmetic the person
 * is being asked to trust before they submit. It has to be readable on its own
 * and testable without a browser. The server recomputes it on submission and
 * its answer is the one that binds; this exists so the answer is not a
 * surprise.
 */

/** `yyyy-MM-dd`, the key holidays and leave dates are compared on (NFR-05). */
export function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Sunday.
 *
 * The weekly-off pattern belongs to the employee's roster, and there is no
 * roster endpoint yet, so this is the fallback the count is built on. It is
 * not hidden: the breakdown returned below reports how many days were skipped
 * as weekly offs, and the form prints that line, so a wrong assumption shows
 * up as a visibly wrong count rather than as a silently wrong balance.
 */
export const DEFAULT_WEEKLY_OFF_DAYS: ReadonlySet<number> = new Set([0]);

export interface LeaveDayCountInput {
  from: Date;
  to: Date;
  /** REQ-G-06: a half-day flag on each boundary day. */
  halfDayStart: boolean;
  halfDayEnd: boolean;
  /** `yyyy-MM-dd` of every holiday in the employee's calendar (REQ-H-01). */
  holidays: ReadonlySet<string>;
  /** Day-of-week indices, Sunday 0, that are weekly offs. */
  weeklyOffDays: ReadonlySet<number>;
  /** REQ-G-01: some types consume the holidays and offs sandwiched in a range. */
  countsSandwichDays: boolean;
}

export interface LeaveDayCount {
  /** Days deducted from the balance. Fractional when a boundary is a half day. */
  totalDays: number;
  /** Every date in the range, counted or not. */
  calendarDays: number;
  holidaysSkipped: number;
  weeklyOffsSkipped: number;
  /** Boundary days counted as 0.5. */
  halfDays: number;
}

const EMPTY: LeaveDayCount = {
  totalDays: 0,
  calendarDays: 0,
  holidaysSkipped: 0,
  weeklyOffsSkipped: 0,
  halfDays: 0,
};

export function countLeaveDays(input: LeaveDayCountInput): LeaveDayCount {
  const { from, to } = input;
  // An inverted range is a state the form can hold while someone is still
  // picking dates. Zero is the honest answer for it; the form reports the
  // ordering problem separately rather than showing a negative count.
  if (from.getTime() > to.getTime()) return EMPTY;

  const days = eachDayOfInterval({ start: from, end: to });
  const lastIndex = days.length - 1;

  let totalDays = 0;
  let holidaysSkipped = 0;
  let weeklyOffsSkipped = 0;
  let halfDays = 0;

  days.forEach((day, index) => {
    const isHoliday = input.holidays.has(toIsoDate(day));
    const isWeeklyOff = input.weeklyOffDays.has(day.getDay());

    if (!input.countsSandwichDays && (isHoliday || isWeeklyOff)) {
      // A holiday that is also a weekly off is one skipped day, not two, and
      // it is reported as a holiday because that is the reason a reader will
      // recognise on the calendar.
      if (isHoliday) holidaysSkipped += 1;
      else weeklyOffsSkipped += 1;
      return;
    }

    // The two boundaries can be the same day: a single-day half-day
    // application sets both flags off one checkbox and must still count 0.5,
    // not 0.
    const isFirst = index === 0;
    const isLast = index === lastIndex;
    const half = (isFirst && input.halfDayStart) || (isLast && input.halfDayEnd);

    if (half) {
      halfDays += 1;
      totalDays += 0.5;
    } else {
      totalDays += 1;
    }
  });

  return {
    totalDays,
    calendarDays: days.length,
    holidaysSkipped,
    weeklyOffsSkipped,
    halfDays,
  };
}

/** "1 day", "2.5 days" — never "1 days". */
export function formatDays(value: number): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${text} ${value === 1 ? 'day' : 'days'}`;
}
