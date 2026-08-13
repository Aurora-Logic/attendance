/**
 * REQ-H-03: "employee chooses up to N per year from a pool; the choice consumes
 * an allowance and marks the day HOLIDAY for them only."
 *
 * Four sentences, four rules, and they are here as pure functions so each one
 * is testable without a database: the day is in the pool, the pool belongs to
 * the employee, the allowance has room, and the same day is not taken twice.
 *
 * Nothing here decides *who may act* -- that is the service's RBAC check --
 * and nothing here knows about attendance. The "marks the day HOLIDAY for them
 * only" half is already the day engine's, which reads the election and treats
 * an unelected restricted holiday as an ordinary working day.
 */

export interface ElectionContext {
  /** REQ-H-01's flag. Electing a public holiday is meaningless, not merely odd. */
  readonly restricted: boolean;
  /** REQ-H-02: the employee inherits this calendar, own setting before location. */
  readonly employeeCalendarId: string | null;
  /** The calendar the holiday being elected belongs to. */
  readonly holidayCalendarId: string;
  readonly allowance: number;
  /** Live elections this employee already holds in this calendar. */
  readonly used: number;
  readonly alreadyElected: boolean;
}

/** Never negative, whatever the two inputs are: see the CHECK in migration 0007. */
export function remainingAllowance(allowance: number, used: number): number {
  return Math.max(0, allowance - used);
}

export type ElectionRefusal =
  | 'NOT_RESTRICTED'
  | 'NOT_ON_CALENDAR'
  | 'NOT_ENABLED'
  | 'ALLOWANCE_EXHAUSTED'
  | 'ALREADY_ELECTED';

/** Null when the election may proceed. */
export function refuseElection(context: ElectionContext): ElectionRefusal | null {
  if (!context.restricted) return 'NOT_RESTRICTED';
  if (context.employeeCalendarId !== context.holidayCalendarId) return 'NOT_ON_CALENDAR';
  // Checked before the count, so a calendar that does not run restricted
  // holidays says so rather than reporting "0 of 0 left", which reads as an
  // exhausted allowance somebody could go and top up.
  if (context.allowance <= 0) return 'NOT_ENABLED';
  if (context.alreadyElected) return 'ALREADY_ELECTED';
  if (remainingAllowance(context.allowance, context.used) <= 0) return 'ALLOWANCE_EXHAUSTED';
  return null;
}

/**
 * The sentence the caller sees. Kept beside the reasons so a new refusal cannot
 * be added without one, and so the API and any future client render the same
 * words for the same cause.
 */
export function refusalMessage(refusal: ElectionRefusal, context: ElectionContext): string {
  switch (refusal) {
    case 'NOT_RESTRICTED':
      return 'That day is a public holiday for everyone on the calendar; there is nothing to elect.';
    case 'NOT_ON_CALENDAR':
      return 'That holiday belongs to a calendar this employee does not follow.';
    case 'NOT_ENABLED':
      return 'This calendar does not offer restricted holidays. Set an allowance on it first.';
    case 'ALREADY_ELECTED':
      return 'This employee has already taken that restricted holiday.';
    case 'ALLOWANCE_EXHAUSTED':
      return `All ${String(context.allowance)} restricted holidays for this calendar are already taken.`;
  }
}
