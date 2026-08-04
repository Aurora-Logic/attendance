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
