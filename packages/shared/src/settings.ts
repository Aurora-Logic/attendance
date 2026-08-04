import * as z from "zod"

/** What happens to a day once an employee exhausts their late allowance. */
export const LATE_PENALTY = ["NONE", "HALF_DAY", "ABSENT", "LOP"] as const
export const latePenaltySchema = z.enum(LATE_PENALTY)
export type LatePenalty = z.infer<typeof latePenaltySchema>

export const LATE_PERIOD = ["WEEK", "MONTH"] as const
export const latePeriodSchema = z.enum(LATE_PERIOD)
export type LatePeriod = z.infer<typeof latePeriodSchema>

/**
 * Every number in brief §3 lives here as a *default only*. At runtime these are
 * overridden by the `settings` table, resolved employee → shift → branch →
 * company → this file. Nothing downstream may read a literal.
 */
export const attendanceSettingsSchema = z.object({
  // --- punch windows -------------------------------------------------------
  punchInWindowBeforeMin: z.number().int().nonnegative().default(10),
  punchInWindowAfterMin: z.number().int().nonnegative().default(10),
  punchOutWindowBeforeMin: z.number().int().nonnegative().default(10),
  punchOutWindowAfterMin: z.number().int().nonnegative().default(10),
  /** Off by default — §3 is explicit that flagging beats rejecting. */
  hardBlockOutsideWindow: z.boolean().default(false),

  // --- late policy ---------------------------------------------------------
  /** Minutes past shift start before a punch counts as late. */
  lateGraceMinutes: z.number().int().nonnegative().default(15),
  /** Late marks forgiven per period before any penalty applies. */
  lateMarksAllowed: z.number().int().nonnegative().default(2),
  /** Window the allowance resets over. */
  latePeriod: latePeriodSchema.default("MONTH"),
  /** What the (allowance + 1)-th late mark converts the day into. */
  latePenalty: latePenaltySchema.default("ABSENT"),
  /** Apply the penalty to every subsequent late, or only the first breach. */
  latePenaltyRepeats: z.boolean().default(true),

  // --- early exit ----------------------------------------------------------
  earlyExitGraceMinutes: z.number().int().nonnegative().default(15),
  earlyExitMarksAllowed: z.number().int().nonnegative().default(2),
  earlyExitPenalty: latePenaltySchema.default("HALF_DAY"),

  // --- day computation -----------------------------------------------------
  halfDayMinHours: z.number().nonnegative().default(4),
  fullDayMinHours: z.number().nonnegative().default(8),

  // --- geofence & duplicates ----------------------------------------------
  geofenceRadiusM: z.number().int().positive().default(200),
  minPunchGapMinutes: z.number().int().positive().default(2),

  // --- selfie --------------------------------------------------------------
  selfieRetentionMonths: z.number().int().positive().default(12),
  selfieMaxBytes: z.number().int().positive().default(200_000),
  requireFaceDetection: z.boolean().default(true),

  // --- approvals -----------------------------------------------------------
  approvalEscalateAfterDays: z.number().int().positive().default(2),
  autoApproveOnEscalation: z.boolean().default(false),

  // --- overtime ------------------------------------------------------------
  otEnabled: z.boolean().default(true),
  otMinMinutes: z.number().int().nonnegative().default(30),
  otMultiplier: z.number().positive().default(1.5),

  timezone: z.string().default("Asia/Kolkata"),
})

export type AttendanceSettings = z.infer<typeof attendanceSettingsSchema>
export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings =
  attendanceSettingsSchema.parse({})

export const SETTINGS_SCOPES = ["EMPLOYEE", "SHIFT", "BRANCH", "COMPANY"] as const
export type SettingsScope = (typeof SETTINGS_SCOPES)[number]

/* ------------------------------------------------------------ late policy */

export interface LateEvaluation {
  /** Is this punch late at all? */
  isLate: boolean
  minutesLate: number
  /** 1-based position of this late mark within the period. */
  markNumber: number
  /** Marks still forgiven after this one. */
  remainingAllowance: number
  /** Penalty this day incurs, if any. */
  penalty: LatePenalty
  /** Plain-English reason, shown to the employee per §3. */
  explanation: string
}

/**
 * Single source of truth for the late rule. The nightly `attendance_days`
 * computation, the punch screen preview and the settings page all call this —
 * there is no second implementation to drift.
 *
 * @param minutesAfterShiftStart Positive when the punch is after shift start.
 * @param priorLateMarks Late marks already recorded in the current period.
 */
export function evaluateLate(
  minutesAfterShiftStart: number,
  priorLateMarks: number,
  settings: AttendanceSettings = DEFAULT_ATTENDANCE_SETTINGS
): LateEvaluation {
  const { lateGraceMinutes, lateMarksAllowed, latePenalty, latePenaltyRepeats, latePeriod } =
    settings

  if (minutesAfterShiftStart <= lateGraceMinutes) {
    return {
      isLate: false,
      minutesLate: 0,
      markNumber: priorLateMarks,
      remainingAllowance: Math.max(lateMarksAllowed - priorLateMarks, 0),
      penalty: "NONE",
      explanation: `Within the ${lateGraceMinutes}-minute grace.`,
    }
  }

  const markNumber = priorLateMarks + 1
  const withinAllowance = markNumber <= lateMarksAllowed
  const isFirstBreach = markNumber === lateMarksAllowed + 1
  const period = latePeriod.toLowerCase()

  if (withinAllowance) {
    const remaining = lateMarksAllowed - markNumber
    return {
      isLate: true,
      minutesLate: minutesAfterShiftStart,
      markNumber,
      remainingAllowance: remaining,
      penalty: "NONE",
      explanation:
        remaining > 0
          ? `Late mark ${markNumber} of ${lateMarksAllowed} allowed this ${period}. ${remaining} left before the day is marked ${latePenalty.replace("_", " ").toLowerCase()}.`
          : `Late mark ${markNumber} of ${lateMarksAllowed} allowed this ${period}. The next late will be marked ${latePenalty.replace("_", " ").toLowerCase()}.`,
    }
  }

  const penalty = latePenaltyRepeats || isFirstBreach ? latePenalty : "NONE"
  return {
    isLate: true,
    minutesLate: minutesAfterShiftStart,
    markNumber,
    remainingAllowance: 0,
    penalty,
    explanation:
      penalty === "NONE"
        ? `Late mark ${markNumber} this ${period}; the penalty applied on mark ${lateMarksAllowed + 1} only.`
        : `Late mark ${markNumber} this ${period}, past the ${lateMarksAllowed} allowed — day marked ${penalty.replace("_", " ").toLowerCase()}.`,
  }
}
