/**
 * The date arithmetic REQ-C-04 to REQ-C-06 need, as pure functions.
 *
 * Separated from the service because every one of these is a place an
 * off-by-one costs a day of somebody's attendance, and a function that takes
 * two strings and returns a third can be tested exhaustively where a service
 * method that also writes rows cannot.
 *
 * Dates are `YYYY-MM-DD` throughout, never `Date`. A roster range is calendar
 * data: "the 10th" is the 10th in the office's timezone, and turning it into
 * an instant here would introduce a timezone the caller never asked about.
 * String comparison on this format is chronological, which is the whole reason
 * the format is used.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;

const MS_PER_DAY = 86_400_000;

/** Parses and calendar-checks; `2026-02-30` is refused rather than rolled over. */
export function parseDate(value: string, label: string): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(value);
  if (match === null) {
    throw new RangeError(`Expected ${label} to be YYYY-MM-DD, received "${value}".`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`${label} "${value}" is not a real calendar date.`);
  }
  return { year, month, day };
}

function toUtcMs(value: string, label: string): number {
  const { year, month, day } = parseDate(value, label);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`, inclusive at both ends. Never below zero. */
export function inclusiveDayCount(from: string, to: string): number {
  const span = toUtcMs(to, 'to') - toUtcMs(from, 'from');
  return span < 0 ? 0 : Math.floor(span / MS_PER_DAY) + 1;
}

/** Every date in `[from, to]`, inclusive. */
export function eachDate(from: string, to: string): string[] {
  const start = toUtcMs(from, 'from');
  const end = toUtcMs(to, 'to');
  const dates: string[] = [];
  for (let ms = start; ms <= end; ms += MS_PER_DAY) dates.push(fromUtcMs(ms));
  return dates;
}

export interface DateRange {
  readonly from: string;
  /** Null is open-ended: the assignment runs until a later one supersedes it. */
  readonly to: string | null;
}

/** Inclusive at both ends, matching the `'[]'` bounds on the exclusion constraint. */
export function rangesOverlap(left: DateRange, right: DateRange): boolean {
  const leftEndsBefore = left.to !== null && left.to < right.from;
  const rightEndsBefore = right.to !== null && right.to < left.from;
  return !leftEndsBefore && !rightEndsBefore;
}

/**
 * The window a roster change can disturb.
 *
 * An edit affects the dates it covered *and* the dates it now covers: narrowing
 * an assignment uncovers days at the end, and those days change shift just as
 * surely as the ones that were added. Recomputing only the new range would
 * leave the uncovered days still claiming the old shift, which is the silent
 * half of the bug REQ-C-06 exists to prevent.
 */
export function affectedWindow(ranges: readonly DateRange[]): DateRange | null {
  let from: string | null = null;
  let to: string | null = null;
  let openEnded = false;

  for (const range of ranges) {
    if (from === null || range.from < from) from = range.from;
    if (range.to === null) openEnded = true;
    else if (to === null || range.to > to) to = range.to;
  }

  if (from === null) return null;
  return { from, to: openEnded ? null : to };
}

/**
 * The part of a window that can hold a computed attendance day.
 *
 * REQ-E-01 puts one row per employee per date "from their date of joining to
 * the earlier of today and their last working date", so nothing past today has
 * one and an open-ended assignment does not mean an unbounded recompute. This
 * is what keeps a standing roster change from trying to walk to the end of
 * time looking for rows.
 *
 * Returns null when the whole window is in the future and there is therefore
 * nothing to recompute.
 */
export function computedWindow(
  window: DateRange,
  today: string,
): { from: string; to: string } | null {
  if (window.from > today) return null;
  const to = window.to === null || window.to > today ? today : window.to;
  return { from: window.from, to };
}

/** The `YYYY-MM` months a window touches, for the period-lock check (REQ-E-09). */
export function monthsInRange(from: string, to: string): { year: number; month: number }[] {
  const start = parseDate(from, 'from');
  const end = parseDate(to, 'to');
  const months: { year: number; month: number }[] = [];

  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Today in a named IANA zone, as `YYYY-MM-DD`. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  // `en-CA` renders as YYYY-MM-DD, which is the format the rest of this file
  // relies on being chronologically sortable. Asking the platform rather than
  // doing offset arithmetic means the zone's own history and its DST rules
  // decide where the date boundary falls.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
