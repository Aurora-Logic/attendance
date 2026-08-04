import type { DayStatus, HalfDayReason, PunchFlag, PunchType } from "./attendance"
import { evaluateLate, type AttendanceSettings, type LatePenalty } from "./settings"
import { punchWindowFlag, shiftLengthMin, type ShiftSpec } from "./shift"

/**
 * The `attendance_days` engine. `punches` is the raw append-only log; this
 * function is the computed truth derived from it. It is pure and idempotent —
 * the nightly job, the on-demand recompute and the API's live view all call
 * exactly this, so a recompute can never disagree with the original run.
 */

export type DayKind = "WORKING" | "WEEKLY_OFF" | "HOLIDAY"
export type DayPart = "FULL" | "FIRST_HALF" | "SECOND_HALF"

export interface NormalizedPunch {
  type: PunchType
  /** Minutes from shift start (offsetFromShiftStart). */
  offsetMin: number
}

export interface DayComputationInput {
  shift: ShiftSpec
  dayKind: DayKind
  /** Approved leave overlapping this date, if any. */
  leave?: { part: DayPart; isPaid: boolean } | null
  punches: NormalizedPunch[]
  /** Explicit choice on the punch screen — wins over the worked-hours rule. */
  explicitDayPart?: DayPart
  /** Late marks already recorded in the current period. */
  priorLateMarks: number
  settings: AttendanceSettings
}

export interface DayComputationResult {
  status: DayStatus
  /** 0 | 0.5 | 1 — the single number payroll multiplies. */
  payableUnits: number
  halfDayReason: HalfDayReason | null
  workedMinutes: number
  lateMinutes: number
  otMinutes: number
  flags: PunchFlag[]
  penaltyApplied: LatePenalty
  needsApproval: boolean
  /** Plain-English reason, shown to the employee (§3). */
  explanation: string
}

const HALF = 0.5

function workedFromPunches(punches: NormalizedPunch[]): {
  firstIn: number | null
  lastOut: number | null
  breakMinutes: number
  missingOut: boolean
} {
  const sorted = [...punches].sort((a, b) => a.offsetMin - b.offsetMin)
  let firstIn: number | null = null
  let lastOut: number | null = null
  let breakMinutes = 0
  let breakStart: number | null = null

  for (const punch of sorted) {
    if (punch.type === "IN" && firstIn === null) firstIn = punch.offsetMin
    if (punch.type === "OUT") lastOut = punch.offsetMin
    if (punch.type === "BREAK_OUT") breakStart = punch.offsetMin
    if (punch.type === "BREAK_IN" && breakStart !== null) {
      breakMinutes += punch.offsetMin - breakStart
      breakStart = null
    }
  }

  return {
    firstIn,
    lastOut,
    breakMinutes,
    missingOut: firstIn !== null && (lastOut === null || lastOut < firstIn),
  }
}

export function computeAttendanceDay(input: DayComputationInput): DayComputationResult {
  const { shift, dayKind, leave, punches, explicitDayPart, priorLateMarks, settings } = input
  const { firstIn, lastOut, breakMinutes, missingOut } = workedFromPunches(punches)
  const attended = firstIn !== null

  const base: DayComputationResult = {
    status: "PRESENT",
    payableUnits: 0,
    halfDayReason: null,
    workedMinutes: 0,
    lateMinutes: 0,
    otMinutes: 0,
    flags: [],
    penaltyApplied: "NONE",
    needsApproval: false,
    explanation: "",
  }

  // Non-working days are paid (§6) and punching on them is a comp-off claim,
  // never an error.
  if (dayKind !== "WORKING") {
    base.status = dayKind === "HOLIDAY" ? "HOLIDAY" : "WEEKLY_OFF"
    base.payableUnits = 1
    if (attended) {
      base.workedMinutes = Math.max(
        (lastOut ?? firstIn!) - firstIn! - breakMinutes,
        0
      )
      base.needsApproval = true
      base.explanation = "Worked on a non-working day — routed as a comp-off claim."
    }
    return base
  }

  if (leave?.part === "FULL") {
    base.status = "ON_LEAVE"
    base.payableUnits = leave.isPaid ? 1 : 0
    base.explanation = leave.isPaid ? "Approved paid leave." : "Approved unpaid leave (LOP)."
    return base
  }

  if (!attended) {
    if (leave) {
      base.status = "ON_LEAVE_HALF"
      base.payableUnits = leave.isPaid ? HALF : 0
      base.explanation = "Half-day leave; the other half was not worked."
      return base
    }
    base.status = "ABSENT"
    base.explanation = "No punches, no approved leave."
    return base
  }

  // ---- attended -----------------------------------------------------------
  const inFlag = punchWindowFlag("IN", firstIn!, shift, settings)
  if (inFlag !== "ON_TIME") base.flags.push(inFlag)

  if (missingOut) {
    // Auto-closed by the nightly job; a regularisation request goes to the
    // employee. Not payable until someone confirms the day actually happened.
    base.flags.push("MISSING_PUNCH_OUT")
    base.status = "PENDING_APPROVAL"
    base.needsApproval = true
    base.lateMinutes = Math.max(firstIn!, 0)
    base.explanation = "Punch-out missing — day auto-closed, regularisation raised."
    return base
  }

  const outFlag = punchWindowFlag("OUT", lastOut!, shift, settings)
  if (outFlag !== "ON_TIME") base.flags.push(outFlag)

  base.workedMinutes = Math.max(lastOut! - firstIn! - breakMinutes, 0)
  base.lateMinutes = Math.max(firstIn!, 0)

  const rawOt = lastOut! - shiftLengthMin(shift)
  if (settings.otEnabled && rawOt >= settings.otMinMinutes) base.otMinutes = rawOt

  const halfMin = settings.halfDayMinHours * 60
  const fullMin = settings.fullDayMinHours * 60

  if (leave) {
    // Half leave + the other half worked.
    base.status = "ON_LEAVE_HALF"
    base.halfDayReason = "LEAVE"
    const workedHalf = base.workedMinutes >= halfMin ? HALF : 0
    base.payableUnits = (leave.isPaid ? HALF : 0) + workedHalf
    base.explanation = "Half-day leave plus worked half."
  } else if (explicitDayPart && explicitDayPart !== "FULL") {
    // An explicit choice at punch time wins over the worked-hours rule (§3).
    base.status = "HALF_DAY"
    base.halfDayReason = "EMPLOYEE_SELECTED"
    base.payableUnits = HALF
    base.explanation = "Half day — selected at punch time."
  } else if (base.workedMinutes >= fullMin) {
    base.status = "PRESENT"
    base.payableUnits = 1
    base.explanation = "Full day by worked hours."
  } else if (base.workedMinutes >= halfMin) {
    base.status = "HALF_DAY"
    base.halfDayReason = "WORKED_HOURS"
    base.payableUnits = HALF
    base.explanation = `Half day — worked ${Math.round(base.workedMinutes / 6) / 10}h, below the ${settings.fullDayMinHours}h full-day threshold.`
  } else {
    // Attended but below even the half-day floor. Payroll treats it as absent;
    // the punches survive and the dispute goes through approval.
    base.status = "ABSENT"
    base.payableUnits = 0
    base.needsApproval = true
    base.explanation = `Worked under the ${settings.halfDayMinHours}h half-day minimum.`
  }

  // ---- late-mark policy ---------------------------------------------------
  const late = evaluateLate(base.lateMinutes, priorLateMarks, settings)
  if (late.penalty !== "NONE") {
    base.penaltyApplied = late.penalty
    base.explanation = late.explanation
    if (late.penalty === "HALF_DAY" && base.payableUnits > HALF) {
      base.status = "HALF_DAY"
      base.halfDayReason = "LATE_MARK_CONVERSION"
      base.payableUnits = HALF
    } else if (late.penalty === "ABSENT") {
      base.status = "ABSENT"
      base.payableUnits = 0
    } else if (late.penalty === "LOP") {
      base.payableUnits = 0
    }
  } else if (late.isLate && base.explanation) {
    base.explanation += ` ${late.explanation}`
  }

  base.needsApproval = base.needsApproval || base.flags.some((flag) => flag !== "ON_TIME")
  return base
}
