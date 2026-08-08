import * as z from "zod"

/**
 * Day statuses, per brief §3. `attendance_days.status` is the computed truth —
 * `punches` is the append-only log it is derived from.
 */
export const DAY_STATUS = [
  "PRESENT",
  "HALF_DAY",
  "ABSENT",
  "WEEKLY_OFF",
  "HOLIDAY",
  "ON_LEAVE",
  "ON_LEAVE_HALF",
  "WFH",
  "ON_DUTY",
  "PENDING_APPROVAL",
] as const
export const dayStatusSchema = z.enum(DAY_STATUS)
export type DayStatus = z.infer<typeof dayStatusSchema>

export const PUNCH_TYPE = ["IN", "OUT", "BREAK_OUT", "BREAK_IN"] as const
export const punchTypeSchema = z.enum(PUNCH_TYPE)
export type PunchType = z.infer<typeof punchTypeSchema>

/**
 * Flags never block a punch (§3) — they route it to approval. A blocked punch
 * turns a present employee into an absent one, which is the payroll dispute
 * the whole design is built to avoid.
 */
export const PUNCH_FLAG = [
  "ON_TIME",
  "EARLY",
  "LATE",
  "EARLY_EXIT",
  "OUT_OF_GEOFENCE",
  "OFFLINE_SYNCED",
  "MISSING_PUNCH_OUT",
  "NO_FACE",
  "DUPLICATE_IMAGE",
  /** Written by an approved regularisation, never by a device. */
  "REGULARISED",
] as const
export const punchFlagSchema = z.enum(PUNCH_FLAG)
export type PunchFlag = z.infer<typeof punchFlagSchema>

export const APPROVAL_STATUS = [
  "NOT_REQUIRED",
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const
export const approvalStatusSchema = z.enum(APPROVAL_STATUS)
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>

/** Which rule produced a half day — §3 requires showing this to the employee. */
export const HALF_DAY_REASON = [
  "EMPLOYEE_SELECTED",
  "WORKED_HOURS",
  "LATE_MARK_CONVERSION",
  "LEAVE",
] as const
export const halfDayReasonSchema = z.enum(HALF_DAY_REASON)
export type HalfDayReason = z.infer<typeof halfDayReasonSchema>

/**
 * One row per employee per day. `payableUnits` is the single number payroll
 * reads — payroll multiplies, it never re-derives attendance logic.
 */
export const attendanceDaySchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeCode: z.string(),
  employeeName: z.string(),
  department: z.string(),
  /** Business date (YYYY-MM-DD), not the calendar date of the timestamp. */
  date: z.string(),
  shiftName: z.string().nullable(),
  status: dayStatusSchema,
  firstInAt: z.string().nullable(),
  lastOutAt: z.string().nullable(),
  workedMinutes: z.number().int().nonnegative(),
  lateMinutes: z.number().int().nonnegative(),
  otMinutes: z.number().int().nonnegative(),
  flags: z.array(punchFlagSchema),
  approvalStatus: approvalStatusSchema,
  halfDayReason: halfDayReasonSchema.nullable(),
  /** 1.0 | 0.5 | 0 — what payroll multiplies by. */
  payableUnits: z.number().min(0).max(1),
  isLocked: z.boolean(),
  /** Stamped WebP derivatives from the first IN punch, when captured. */
  selfieThumb: z.string().nullish(),
  selfieView: z.string().nullish(),
  syncDeltaSec: z.number().nullish(),
})
export type AttendanceDay = z.infer<typeof attendanceDaySchema>

export type StatusTone =
  | "success"
  | "warning"
  | "info"
  | "destructive"
  | "secondary"
  | "outline"

/**
 * Maps a day status to a badge variant. Four outcomes carry colour — attended,
 * needs attention, informational, and bad — everything else stays neutral so
 * the register reads as data rather than decoration. Components never name a
 * colour; they call this.
 */
export function dayStatusTone(status: DayStatus): StatusTone {
  switch (status) {
    case "PRESENT":
      return "success"
    case "WFH":
    case "ON_DUTY":
      return "info"
    case "HALF_DAY":
    case "PENDING_APPROVAL":
      return "warning"
    case "ABSENT":
      return "destructive"
    case "ON_LEAVE":
    case "ON_LEAVE_HALF":
      return "secondary"
    case "WEEKLY_OFF":
    case "HOLIDAY":
      return "outline"
    default:
      return "outline"
  }
}

/** Same idea for punch flags. `ON_TIME` is the only good outcome. */
export function punchFlagTone(flag: string): StatusTone {
  switch (flag) {
    case "ON_TIME":
      return "success"
    case "LATE":
    case "EARLY_EXIT":
    case "MISSING_PUNCH_OUT":
      return "warning"
    case "NO_FACE":
    case "DUPLICATE_IMAGE":
      return "destructive"
    case "OUT_OF_GEOFENCE":
    case "OFFLINE_SYNCED":
      return "info"
    default:
      return "outline"
  }
}
