/**
 * Calendar arithmetic on a `YYYY-MM-DD` string.
 *
 * A date in this product is not an instant. Joining dates, holidays and
 * attendance dates are calendar facts, and the moment one is turned into a
 * `Date` in the server's local zone it starts shifting by a day for anyone east
 * or west of it. Everything here therefore works on the string, or on a UTC
 * midnight instant that exists only so the runtime can tell us a weekday.
 *
 * The one conversion that genuinely needs a timezone -- a shift's wall-clock
 * start on a given date, as an instant -- is done by Postgres in the repository
 * with `AT TIME ZONE`, not here.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export interface CalendarDate {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  /** 1-31. */
  readonly day: number;
  /** ISO-8601: 1 = Monday ... 7 = Sunday, matching `organizations.week_start`. */
  readonly isoWeekday: number;
}

/**
 * Throws rather than returning null. Every caller reached here from a `date`
 * column, so a malformed value is a corrupted row or a bug in a query -- and a
 * null would flow on to become "not a weekly off", which marks somebody absent
 * on their day off.
 */
export function parseCalendarDate(value: string): CalendarDate {
  const match = ISO_DATE.exec(value);
  if (match === null) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received "${value}".`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Date.UTC rolls an impossible date over rather than rejecting it, so
  // "2026-02-30" would silently become 2 March. Compare the parts back.
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new RangeError(`"${value}" is not a real calendar date.`);
  }

  const sundayZero = utc.getUTCDay();
  return { year, month, day, isoWeekday: sundayZero === 0 ? 7 : sundayZero };
}

/**
 * Which occurrence of its own weekday this date is within the month: the 1st
 * Saturday, the 2nd, and so on. REQ-C-03's alternate-Saturday rule is expressed
 * as "the 2nd and 4th", and this is what that counts.
 */
export function occurrenceInMonth(date: CalendarDate): number {
  return Math.ceil(date.day / 7);
}

/**
 * The neighbouring calendar date, still as a string.
 *
 * Done through a UTC midnight instant so month and year ends, and leap days,
 * come from the runtime rather than from arithmetic written here. UTC
 * specifically: a local-zone Date would cross a daylight-saving boundary and
 * land on the same day twice.
 */
export function addDays(value: string, days: number): string {
  const { year, month, day } = parseCalendarDate(value);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

/**
 * What calendar date it is, right now, where the employee is standing.
 *
 * `en-CA` because it formats as `YYYY-MM-DD`; the locale is a formatting
 * choice, not a language one, and the alternative is assembling the parts from
 * `formatToParts` for the same answer. NFR-05: an attendance date is a calendar
 * fact in the location's zone, never the server's.
 */
export function localDateIn(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
