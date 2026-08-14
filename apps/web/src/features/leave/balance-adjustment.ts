import { MAX_LEAVE_DAYS, closingLeaveBalance, roundLeaveDays } from '@vyuha/shared';

import type { LeaveBalance } from './types';

/**
 * The arithmetic and the validation behind the balance-adjustment form
 * (REQ-G-03's `adjusted` bucket).
 *
 * Out of the component so it can be tested without a DOM, and because every
 * rule here has to agree with the shared schema the server parses the body
 * with — `leaveAdjustmentSchema`: signed, non-zero, within the column's range,
 * with a reason of at least three characters.
 */

export type AdjustmentDirection = 'ADD' | 'REMOVE';

/** Why the form cannot be submitted as it stands. */
export const ADJUSTMENT_PROBLEMS = [
  'NO_EMPLOYEE',
  'NO_TYPE',
  'AMOUNT_MISSING',
  'AMOUNT_ZERO',
  'AMOUNT_TOO_LARGE',
  'AMOUNT_NOT_A_NUMBER',
  'REASON_TOO_SHORT',
] as const;

export type AdjustmentProblem = (typeof ADJUSTMENT_PROBLEMS)[number];

export const ADJUSTMENT_PROBLEM_LABELS: Record<AdjustmentProblem, string> = {
  NO_EMPLOYEE: 'Choose whose balance is being corrected.',
  NO_TYPE: 'Choose which leave type the correction applies to.',
  AMOUNT_MISSING: 'Enter how many days to add or remove.',
  AMOUNT_ZERO: 'A correction of zero days would write a ledger row that changes nothing.',
  AMOUNT_TOO_LARGE: `The largest correction this column can hold is ${String(MAX_LEAVE_DAYS)} days.`,
  AMOUNT_NOT_A_NUMBER: 'Days must be a number, in whole or half days.',
  REASON_TOO_SHORT: 'The reason is the audit trail for this correction. Write at least a few words.',
};

export interface AdjustmentDraft {
  employeeId: string | null;
  leaveTypeId: string | null;
  direction: AdjustmentDirection;
  /** As typed. Kept as a string so a half-finished "1." is not read as 1. */
  amount: string;
  reason: string;
}

/**
 * The signed day count the endpoint takes, or null when the amount is not yet
 * a number.
 *
 * Direction is a control rather than a minus sign the reader has to type. A
 * typed "-5" and a typed "5" look almost identical in a narrow field and mean
 * opposite things to somebody's leave balance; two labelled buttons cannot be
 * misread.
 */
export function signedDays(draft: AdjustmentDraft): number | null {
  const trimmed = draft.amount.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return roundLeaveDays(draft.direction === 'REMOVE' ? -parsed : parsed);
}

export function adjustmentProblems(draft: AdjustmentDraft): readonly AdjustmentProblem[] {
  const problems: AdjustmentProblem[] = [];
  if (draft.employeeId === null) problems.push('NO_EMPLOYEE');
  if (draft.leaveTypeId === null) problems.push('NO_TYPE');

  const trimmed = draft.amount.trim();
  if (trimmed.length === 0) problems.push('AMOUNT_MISSING');
  else {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) problems.push('AMOUNT_NOT_A_NUMBER');
    else if (roundLeaveDays(parsed) === 0) problems.push('AMOUNT_ZERO');
    else if (Math.abs(roundLeaveDays(parsed)) > MAX_LEAVE_DAYS) problems.push('AMOUNT_TOO_LARGE');
  }

  if (draft.reason.trim().length < 3) problems.push('REASON_TOO_SHORT');
  return problems;
}

/**
 * What the closing balance becomes.
 *
 * Quoted from `closingLeaveBalance` — the shared definition the server's
 * projection, its property test and the check constraint in migration 0009 all
 * use — rather than re-derived as `closing + days`. An adjustment moves the
 * `adjusted` bucket and nothing else, so feeding the moved bucket back through
 * the invariant is exact, and it cannot drift from the number the server
 * answers with.
 */
export function projectedClosing(balance: LeaveBalance, days: number): number {
  return closingLeaveBalance({ ...balance, adjusted: roundLeaveDays(balance.adjusted + days) });
}
