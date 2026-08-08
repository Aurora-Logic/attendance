import type { Paise } from "./money"

/**
 * Payroll maths, integer paise throughout (§11 requires every money
 * calculation to have a worked-example test — exact equality, no tolerance).
 */

export type RateBasis = "CALENDAR_DAYS" | "WORKING_DAYS" | "FIXED_26"

export interface RateContext {
  calendarDays: number
  workingDays: number
}

/** Per-day rate under the configured basis (§6). Rounded once, here. */
export function perDayPaise(grossMonthlyPaise: Paise, basis: RateBasis, ctx: RateContext): Paise {
  const divisor =
    basis === "CALENDAR_DAYS" ? ctx.calendarDays : basis === "WORKING_DAYS" ? ctx.workingDays : 26
  return Math.round(grossMonthlyPaise / divisor)
}

/**
 * Earned pay is the **salary minus what was not earned**, never a per-day rate
 * multiplied up.
 *
 * Multiplying overpaid every single employee. A weekly off and a holiday each
 * accrue a payable unit — correctly, they are paid days — so a fully present
 * employee in a 31-day month accrues 31 units. Priced at gross/26 under
 * FIXED_26 that is 1.19 × salary, and gross/25 under WORKING_DAYS is 1.24 ×.
 * A ₹26,000 contract paid ₹31,000. Only CALENDAR_DAYS happened to be
 * self-consistent.
 *
 * Deducting instead is both the standard Indian payroll model and
 * self-correcting: full attendance is exactly the contracted salary on every
 * basis, whatever the month's length, because nothing was lost.
 *
 * @param unpaidUnits Units lost on days the employee was expected to work —
 *   the sum of (1 − payableUnits) over working and declared-half days. Weekly
 *   offs and holidays contribute nothing: the divisor already assumes they are
 *   paid without being worked.
 */
export function earnedPaise(
  grossMonthlyPaise: Paise,
  basis: RateBasis,
  ctx: RateContext,
  unpaidUnits: number
): Paise {
  const deduction = Math.round(perDayPaise(grossMonthlyPaise, basis, ctx) * unpaidUnits)
  return Math.max(grossMonthlyPaise - deduction, 0)
}

/**
 * Overtime pay: per-minute rate derived from the per-day rate over the
 * configured full-day hours, times approved minutes, times the multiplier.
 * One rounding, at the end.
 */
export function otPaise(
  grossMonthlyPaise: Paise,
  basis: RateBasis,
  ctx: RateContext,
  approvedOtMinutes: number,
  multiplier: number,
  fullDayHours: number
): Paise {
  const perDay = perDayPaise(grossMonthlyPaise, basis, ctx)
  return Math.round((perDay / (fullDayHours * 60)) * approvedOtMinutes * multiplier)
}
