import { roundLeaveDays } from '@vyuha/shared';

/**
 * REQ-K-03's "low leave balance", as a decision rather than a side effect.
 *
 * Pure, because the interesting part is not the emit -- it is which movements
 * warrant a warning and which do not, and that is a rule with edges worth
 * pinning: Leave Without Pay, a balance already below the line, and a single
 * approval that jumps the line from well above it.
 */

/**
 * The threshold. The PRD names the event and not the number, so this is a
 * recorded default rather than an answer -- see OPEN-QUESTIONS K-1. Two days
 * is the point at which somebody planning a long weekend needs to know before
 * they ask, rather than after they are refused.
 */
export const LOW_LEAVE_BALANCE_DAYS = 2;

/**
 * True only on the **crossing**: the balance was at or above the threshold and
 * this movement took it below.
 *
 * Warning whenever a balance is merely low would send the same notification on
 * every subsequent approval of the same type, which is how a bell becomes
 * something people stop looking at. The crossing test is also what keeps Leave
 * Without Pay quiet: it opens at zero and every approval takes it further
 * negative, so it can never have been above the line to begin with.
 */
export function crossedLowBalance(before: number, after: number): boolean {
  return (
    roundLeaveDays(before) >= LOW_LEAVE_BALANCE_DAYS &&
    roundLeaveDays(after) < LOW_LEAVE_BALANCE_DAYS
  );
}

/**
 * What the balance was a moment before this approval.
 *
 * Derived rather than read back: the AVAILED row deducts exactly `days`, so
 * the previous closing figure is the new one plus that. A second read would be
 * another round trip and could disagree with the transaction that just
 * committed.
 */
export function balanceBeforeApproval(closingAfter: number, days: number): number {
  return roundLeaveDays(closingAfter + days);
}
