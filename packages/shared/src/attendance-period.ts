import type { DayStatus } from "./attendance"

/**
 * The handover to whoever runs payroll.
 *
 * Payroll is not run in this product (work order Section 2). What this system
 * owes the people who do run it is one honest row per employee per period:
 * how many days they were present, absent, half, on paid leave, on unpaid
 * leave, and how much overtime they worked.
 *
 * Kept as a pure function, apart from the Excel writer, because the arithmetic
 * is the part that must be right. A spreadsheet can be re-generated; a wrong
 * absent count becomes a wrong salary.
 */

/** One computed day, in the shape the register already produces. */
export interface PeriodDay {
  dateISO: string
  status: DayStatus
  /** 0 | 0.5 | 1 — what the day is worth. */
  payableUnits: number
  otMinutes: number
  lateMinutes: number
  /** Paid leave counts toward salary; unpaid (LOP) does not. */
  leaveIsPaid?: boolean
}

export interface PeriodTotals {
  /** Days the employee attended in full. */
  presentDays: number
  /** Days attended as a half day, whatever the reason. */
  halfDays: number
  /** Working days with nothing recorded and no leave. */
  absentDays: number
  /** Approved leave that still pays. */
  paidLeaveDays: number
  /** Approved leave that does not pay — the figure that reduces salary. */
  unpaidLeaveDays: number
  weeklyOffDays: number
  holidayDays: number
  /** Days still waiting on an approval. Not payable until decided. */
  pendingDays: number
  /** Sum of payableUnits — the single number payroll multiplies. */
  payableDays: number
  overtimeMinutes: number
  overtimeHours: number
  lateMinutes: number
  /** Every day in the period, so the parts can be checked against the whole. */
  totalDays: number
}

const EMPTY: PeriodTotals = {
  presentDays: 0,
  halfDays: 0,
  absentDays: 0,
  paidLeaveDays: 0,
  unpaidLeaveDays: 0,
  weeklyOffDays: 0,
  holidayDays: 0,
  pendingDays: 0,
  payableDays: 0,
  overtimeMinutes: 0,
  overtimeHours: 0,
  lateMinutes: 0,
  totalDays: 0,
}

/**
 * Roll a period's days into one row.
 *
 * Every status lands in exactly one bucket. A status that is not handled would
 * silently vanish from the count, so the default case counts the day as
 * absent — the conservative reading, and one that keeps the buckets summing to
 * the total. `assertPeriodBalances` below is what proves it.
 */
export function summarisePeriod(days: PeriodDay[]): PeriodTotals {
  const totals: PeriodTotals = { ...EMPTY }

  for (const day of days) {
    totals.totalDays += 1
    totals.payableDays += day.payableUnits
    totals.overtimeMinutes += day.otMinutes
    totals.lateMinutes += day.lateMinutes

    switch (day.status) {
      case "PRESENT":
      case "WFH":
      case "ON_DUTY":
        totals.presentDays += 1
        break
      case "HALF_DAY":
        totals.halfDays += 1
        break
      case "WEEKLY_OFF":
        totals.weeklyOffDays += 1
        break
      case "HOLIDAY":
        totals.holidayDays += 1
        break
      case "ON_LEAVE":
        if (day.leaveIsPaid === false) totals.unpaidLeaveDays += 1
        else totals.paidLeaveDays += 1
        break
      case "ON_LEAVE_HALF":
        // Half on leave, half worked: it counts in both columns, at 0.5 each,
        // or the two would not reconcile against the day.
        totals.halfDays += 0.5
        if (day.leaveIsPaid === false) totals.unpaidLeaveDays += 0.5
        else totals.paidLeaveDays += 0.5
        break
      case "PENDING_APPROVAL":
        totals.pendingDays += 1
        break
      case "ABSENT":
      default:
        totals.absentDays += 1
        break
    }
  }

  // Two decimal places: half days and half leaves make thirds of a rupee
  // otherwise, and payroll reconciles these by eye.
  totals.overtimeHours = Math.round((totals.overtimeMinutes / 60) * 100) / 100
  totals.payableDays = Math.round(totals.payableDays * 100) / 100
  totals.paidLeaveDays = Math.round(totals.paidLeaveDays * 100) / 100
  totals.unpaidLeaveDays = Math.round(totals.unpaidLeaveDays * 100) / 100
  totals.halfDays = Math.round(totals.halfDays * 100) / 100

  return totals
}

/**
 * Do the buckets account for every day in the period?
 *
 * A row that does not reconcile is worse than no row: somebody pays against it.
 * The half-leave case is counted in two buckets by design, so it is subtracted
 * once here.
 */
export function periodBalances(totals: PeriodTotals): boolean {
  const counted =
    totals.presentDays +
    totals.halfDays +
    totals.absentDays +
    totals.paidLeaveDays +
    totals.unpaidLeaveDays +
    totals.weeklyOffDays +
    totals.holidayDays +
    totals.pendingDays
  // ON_LEAVE_HALF contributes 0.5 to halfDays and 0.5 to a leave bucket, so a
  // period of N days counts to N either way. Allow a paise-sized rounding gap.
  return Math.abs(counted - totals.totalDays) < 0.001
}

/** Every date from `from` to `to` inclusive, as ISO days. */
export function datesInPeriod(fromISO: string, toISO: string): string[] {
  const from = new Date(`${fromISO}T00:00:00Z`)
  const to = new Date(`${toISO}T00:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return []
  if (from > to) return []

  const dates: string[] = []
  for (let day = new Date(from); day <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10))
  }
  return dates
}

/** The months a period touches, as `YYYY-MM` — what a period lock is keyed by. */
export function monthsInPeriod(fromISO: string, toISO: string): string[] {
  return [...new Set(datesInPeriod(fromISO, toISO).map((date) => date.slice(0, 7)))]
}
