import type { RegularizationRefusal } from '@vyuha/shared';

import { addDays } from '../day-engine/calendar-date.js';

/**
 * REQ-F-02: "Configurable limits: how many days back a regularization may be
 * raised (default 7) and how many per month (default 3)."
 *
 * Pure, and separate from the service, for two reasons.
 *
 * **Both numbers are settings.** They arrive as arguments and are never read
 * here, so this file cannot accidentally become the place the default lives.
 * `attendance.regularization_window_days` and
 * `attendance.regularization_max_per_month` are read once, in the repository,
 * and the settings catalogue names this module as what enforces them.
 *
 * **The boundary cases are the whole requirement.** "Seven days back" is
 * either seven or eight dates depending on whether today counts, and a
 * calendar month boundary is either inclusive or off by one; both are decided
 * here, in one place, with a test per edge rather than a comment claiming it
 * was thought about.
 */

export interface RegularizationWindow {
  /** Today, as a calendar date in the *employee's* zone. Never the server's. */
  readonly today: string;
  /** `attendance.regularization_window_days`. */
  readonly windowDays: number;
}

/**
 * The oldest date still inside the window.
 *
 * Today counts as one of the days. A window of 1 therefore means "today only",
 * which is the reading that makes 0 impossible to express by accident — the
 * schema floors the setting at 1, and a window that admitted nothing would
 * disable the feature through a number that looks like a small limit.
 */
export function earliestRegularizableDate(window: RegularizationWindow): string {
  return addDays(window.today, -(window.windowDays - 1));
}

export interface RegularizationAttempt extends RegularizationWindow {
  /** The date being regularized. */
  readonly date: string;
  /** `attendance.regularization_max_per_month`. Zero switches the feature off. */
  readonly maxPerMonth: number;
  /**
   * How many this employee has already raised in the calendar month of
   * `today` — not of `date`.
   *
   * The month the cap is counted over is the month the request is *made* in,
   * because the cap exists to stop one person filing a stream of corrections,
   * and counting by the corrected date would let somebody file three for
   * March and three for April in the same afternoon.
   */
  readonly raisedThisMonth: number;
  /** The employee's date of joining; there is no attendance before it. */
  readonly dateOfJoining: string;
}

/** Null when the attempt is allowed. */
export function refuseRegularization(attempt: RegularizationAttempt): RegularizationRefusal | null {
  // Checked before the window: a date in the future is not "too old", and
  // saying so would send the reader looking at the wrong setting.
  if (attempt.date > attempt.today) return 'FUTURE_DATE';
  if (attempt.date < attempt.dateOfJoining) return 'BEFORE_JOINING';
  if (attempt.date < earliestRegularizableDate(attempt)) return 'OUTSIDE_WINDOW';
  // `>=` rather than `>`: `raisedThisMonth` is the count *before* this one, so
  // an employee who has already used all three is at the cap, not one short.
  if (attempt.raisedThisMonth >= attempt.maxPerMonth) return 'MONTHLY_CAP_REACHED';
  return null;
}

/**
 * The first and last date of the calendar month a date falls in.
 *
 * Calendar month, per OPEN-QUESTIONS item 7, which fixes the attendance cycle
 * to a calendar month until somebody answers otherwise. If that becomes a
 * 26th-to-25th cutoff, this is the function that changes and the cap moves
 * with it.
 */
export function monthBounds(date: string): { from: string; to: string } {
  const year = date.slice(0, 4);
  const month = date.slice(5, 7);
  const from = `${year}-${month}-01`;
  // The day before the first of the next month, so month lengths and leap
  // years come from the calendar rather than from a table written here.
  const nextMonth =
    month === '12'
      ? `${String(Number(year) + 1)}-01-01`
      : `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`;
  return { from, to: addDays(nextMonth, -1) };
}

/**
 * The prose for a refusal.
 *
 * The message states the number in force rather than the default, so an
 * organisation that widened the window to 30 days does not read a refusal
 * quoting 7. That is the whole reason these are settings.
 */
export function refusalMessage(
  refusal: RegularizationRefusal,
  attempt: Pick<RegularizationAttempt, 'date' | 'today' | 'windowDays' | 'maxPerMonth'>,
): string {
  switch (refusal) {
    case 'FUTURE_DATE':
      return `${attempt.date} has not happened yet. A regularization corrects a day that has already been worked.`;
    case 'BEFORE_JOINING':
      return `${attempt.date} is before this employee joined, so there is no attendance day to correct.`;
    case 'OUTSIDE_WINDOW':
      return (
        `A regularization can be raised for the last ${String(attempt.windowDays)} day(s), ` +
        `back to ${earliestRegularizableDate(attempt)}. ${attempt.date} is older than that.`
      );
    case 'MONTHLY_CAP_REACHED':
      return attempt.maxPerMonth === 0
        ? 'Regularization is switched off for this organisation.'
        : `You have already raised ${String(attempt.maxPerMonth)} regularization(s) this month, which is the limit.`;
    case 'PERIOD_LOCKED':
      return `Attendance for ${attempt.date} is in a locked period and cannot be changed.`;
    case 'ALREADY_PENDING':
      return `A regularization for ${attempt.date} is already waiting for a decision.`;
  }
}
