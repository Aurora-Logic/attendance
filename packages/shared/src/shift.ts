import * as z from "zod"

import type { PunchFlag } from "./attendance"
import type { AttendanceSettings } from "./settings"

/**
 * Times are minutes since midnight. `endMin <= startMin` means the shift
 * crosses midnight (22:00–06:00 → 1320/360).
 */
export const shiftSpecSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  short: z.string().min(1).max(2),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(0).max(1439),
  breakMin: z.number().int().min(0).max(240).default(0),
})
export type ShiftSpec = z.infer<typeof shiftSpecSchema>

export const crossesMidnight = (shift: ShiftSpec): boolean =>
  shift.endMin <= shift.startMin

export const shiftLengthMin = (shift: ShiftSpec): number =>
  crossesMidnight(shift) ? shift.endMin + 1440 - shift.startMin : shift.endMin - shift.startMin

export const minutesToClock = (minutes: number): string =>
  `${String(Math.floor(((minutes % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

const shiftDate = (dateISO: string, deltaDays: number): string => {
  const date = new Date(`${dateISO}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

/**
 * The business date a punch belongs to — the single thing that makes night
 * shifts correct. A 01:00 punch on the 5th, on a 22:00–06:00 shift, belongs to
 * the 4th. The cutoff is shift end + the punch-out window; anything later the
 * same day is treated as belonging to the upcoming night, and true overtime
 * beyond the window travels via an OT claim, not by stretching this rule.
 */
export function resolveBusinessDate(
  dateISO: string,
  minutesOfDay: number,
  shift: ShiftSpec,
  settings: AttendanceSettings
): string {
  if (!crossesMidnight(shift)) return dateISO
  if (minutesOfDay <= shift.endMin + settings.punchOutWindowAfterMin) {
    return shiftDate(dateISO, -1)
  }
  return dateISO
}

/** Minutes since *this shift's* start, correcting for the midnight wrap. */
export function offsetFromShiftStart(
  minutesOfDay: number,
  shift: ShiftSpec,
  settings: AttendanceSettings
): number {
  if (crossesMidnight(shift) && minutesOfDay <= shift.endMin + settings.punchOutWindowAfterMin) {
    return minutesOfDay + 1440 - shift.startMin
  }
  return minutesOfDay - shift.startMin
}

/**
 * Window verdict for a single punch (§3). Distinct from the late-mark grace:
 * the window decides whether the punch needs approval; the grace decides
 * whether the day takes a late mark. A punch can be outside the 10-minute
 * window yet inside the 15-minute grace — flagged for approval, no mark.
 *
 * An OUT beyond the after-window is NOT a violation — that is overtime, and it
 * travels through the OT claim path.
 */
export function punchWindowFlag(
  type: "IN" | "OUT",
  offsetMin: number,
  shift: ShiftSpec,
  settings: AttendanceSettings
): PunchFlag {
  if (type === "IN") {
    if (offsetMin < -settings.punchInWindowBeforeMin) return "EARLY"
    if (offsetMin <= settings.punchInWindowAfterMin) return "ON_TIME"
    return "LATE"
  }
  const relativeToEnd = offsetMin - shiftLengthMin(shift)
  if (relativeToEnd < -settings.punchOutWindowBeforeMin) return "EARLY_EXIT"
  return "ON_TIME"
}

/**
 * Today's date as the company sees it. `toISOString()` is UTC, so in
 * Asia/Kolkata (UTC+5:30) anything before 05:30 local still reports the
 * previous day — which silently shifts every "yesterday" job by one.
 */
export function companyToday(timezone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape used everywhere.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

/** N days back from the company's today, oldest first. */
export function recentCompanyDates(timezone: string, days: number, now: Date = new Date()): string[] {
  const dates: string[] = []
  for (let back = days; back >= 1; back--) {
    dates.push(companyToday(timezone, new Date(now.getTime() - back * 86_400_000)))
  }
  return dates
}

/**
 * Does this string name a date that actually exists? `\d{4}-\d{2}-\d{2}` is a
 * shape check, not a validity check: it accepts 2026-02-31, which JavaScript
 * silently rolls forward to 3 March, and 2026-13-45, which becomes an Invalid
 * Date whose arithmetic yields NaN. Both reach money and attendance maths and
 * surface as a wrong number rather than an error.
 */
export function isRealISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  // Day 0 of the next month is the last day of this one — handles leap years
  // without a table.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The one date schema every route should use. Message included because a bare
 * "Invalid input" on a date field sends people hunting through a form.
 */
export const isoDateSchema = z
  .string()
  .refine(isRealISODate, "Use a real calendar date in YYYY-MM-DD form.")

/** YYYY-MM naming a month that exists. `\d{4}-\d{2}` accepts month 13. */
export function isRealISOMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false
  const month = Number(value.slice(5, 7))
  return month >= 1 && month <= 12
}

export const isoMonthSchema = z
  .string()
  .refine(isRealISOMonth, "Use a real month in YYYY-MM form.")
