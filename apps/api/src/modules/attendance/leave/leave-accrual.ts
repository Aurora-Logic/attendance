import { leaveYearBounds, roundLeaveDays, type LeaveAccrualMethod } from '@vyuha/shared';

/**
 * REQ-G-05: "pro-rated accrual for mid-year joiners and leavers", and the
 * carry forward REQ-G-01 makes a per-type rule.
 *
 * Pure. The jobs in `leave-jobs.handler.ts` read rows and write ledger
 * movements; every decision about *how much* is made here, where it can be
 * tested without a queue, a clock or a database.
 *
 * **No number in this file is a policy.** The entitlement, the cap and the
 * method all arrive from the leave type, and OPEN-QUESTIONS item 4 records
 * that the real values are still unanswered. Nothing here invents one -- an
 * accrual figure guessed in a service is a figure nobody can later find and
 * correct.
 */

const MONTHS_IN_YEAR = 12;

export interface AccrualPeriod {
  /** The calendar year the leave year opened in. */
  readonly leaveYear: number;
  /** 1-12, a real calendar month, not an offset from the leave year start. */
  readonly month: number;
  /** `2026-04` for a monthly accrual, `2026` for a yearly one. */
  readonly periodKey: string;
  readonly start: string;
  readonly end: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/** The calendar month `n` months after the leave year opened, 0-indexed. */
export function accrualPeriodFor(
  leaveYear: number,
  startMonth: number,
  monthOffset: number,
): AccrualPeriod {
  const absolute = startMonth - 1 + monthOffset;
  const year = leaveYear + Math.floor(absolute / MONTHS_IN_YEAR);
  const month = (absolute % MONTHS_IN_YEAR) + 1;
  return {
    leaveYear,
    month,
    periodKey: `${String(year)}-${pad(month)}`,
    start: `${String(year)}-${pad(month)}-01`,
    end: lastDayOfMonth(year, month),
  };
}

export interface EmployeeService {
  readonly dateOfJoining: string;
  /** REQ-A-05: the last working date, once one is set. */
  readonly dateOfLeaving: string | null;
}

/**
 * Whether the employee was in service for any part of the period, and for how
 * much of it.
 *
 * Fractional rather than boolean because REQ-G-05 says *pro-rated*: somebody
 * who joins on the 20th of a month has not earned the whole month's accrual,
 * and rounding that up quietly hands out days the policy did not grant.
 */
export function servedFraction(employee: EmployeeService, period: { start: string; end: string }): number {
  const from = employee.dateOfJoining > period.start ? employee.dateOfJoining : period.start;
  const until =
    employee.dateOfLeaving !== null && employee.dateOfLeaving < period.end
      ? employee.dateOfLeaving
      : period.end;
  if (until < from) return 0;

  const totalDays = dayCount(period.start, period.end);
  if (totalDays === 0) return 0;
  return dayCount(from, until) / totalDays;
}

/** Inclusive day count between two calendar dates. */
function dayCount(from: string, to: string): number {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.floor((end - start) / 86_400_000) + 1;
}

export interface AccrualInput {
  readonly accrualMethod: LeaveAccrualMethod;
  readonly annualEntitlement: number;
  readonly employee: EmployeeService;
  readonly period: AccrualPeriod;
  readonly leaveYearStartMonth: number;
}

/**
 * How many days this period accrues, already rounded to the stored scale.
 *
 * Zero is a legitimate answer and the caller must treat it as "post nothing":
 * a zero-day ACCRUAL row is noise in a ledger whose whole purpose is that
 * every row means something.
 */
export function accrualForPeriod(input: AccrualInput): number {
  if (input.annualEntitlement <= 0) return 0;

  switch (input.accrualMethod) {
    case 'NONE':
      // The type grants nothing on a schedule. An opening balance or an
      // adjustment is how such a type gets a balance at all.
      return 0;

    case 'MONTHLY': {
      const share = input.annualEntitlement / MONTHS_IN_YEAR;
      return roundLeaveDays(share * servedFraction(input.employee, input.period));
    }

    case 'YEARLY': {
      // Granted once, in the month the leave year opens.
      if (input.period.month !== input.leaveYearStartMonth) return 0;
      const bounds = leaveYearBounds(input.period.leaveYear, input.leaveYearStartMonth);
      return roundLeaveDays(input.annualEntitlement * servedFraction(input.employee, bounds));
    }

    case 'ON_JOINING': {
      // Granted once, in the month the employee joined, and not pro-rated:
      // a joining grant is the whole grant or it has not happened yet.
      const joinMonth = input.employee.dateOfJoining.slice(0, 7);
      return joinMonth === input.period.periodKey ? roundLeaveDays(input.annualEntitlement) : 0;
    }
  }
}

export interface CarryForwardInput {
  readonly carryForwardAllowed: boolean;
  /** Null with `carryForwardAllowed` means carry the whole closing balance. */
  readonly carryForwardCap: number | null;
  readonly closingBalance: number;
}

export interface CarryForwardOutcome {
  /** Moved into the new year as CARRY_FORWARD. Never negative. */
  readonly carried: number;
  /** Left behind in the closing year as LAPSE. Never negative. */
  readonly lapsed: number;
}

/**
 * REQ-G-01's carry forward, at the year boundary.
 *
 * A negative closing balance is carried in full and never lapses. It is a
 * recovery item at exit (REQ-G-08), and lapsing it would quietly forgive a
 * debt the product exists to report.
 */
export function carryForward(input: CarryForwardInput): CarryForwardOutcome {
  const closing = roundLeaveDays(input.closingBalance);

  if (closing < 0) return { carried: closing, lapsed: 0 };
  if (closing === 0) return { carried: 0, lapsed: 0 };
  if (!input.carryForwardAllowed) return { carried: 0, lapsed: closing };

  const cap = input.carryForwardCap;
  if (cap === null) return { carried: closing, lapsed: 0 };

  const carried = roundLeaveDays(Math.min(closing, Math.max(cap, 0)));
  return { carried, lapsed: roundLeaveDays(closing - carried) };
}
