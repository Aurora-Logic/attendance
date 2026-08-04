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
 * Payable days per §6: total − LOP − unapproved absents. Paid leave and
 * holidays are already inside `total` as paid, so they are not subtracted.
 */
export function payableDays(input: {
  totalDays: number
  lopDays: number
  unapprovedAbsentDays: number
}): number {
  return Math.max(input.totalDays - input.lopDays - input.unapprovedAbsentDays, 0)
}

/** Earned pay = per-day rate × payable days (halves allowed), rounded once. */
export function earnedPaise(
  grossMonthlyPaise: Paise,
  basis: RateBasis,
  ctx: RateContext,
  days: number
): Paise {
  return Math.round(perDayPaise(grossMonthlyPaise, basis, ctx) * days)
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
