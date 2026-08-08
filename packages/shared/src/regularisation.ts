import * as z from "zod"

import { isoDateSchema } from "./shift"

/**
 * Attendance regularisation: the employee's route to fix a day the machine got
 * wrong — a phone that died before punch-out, a gate reader that missed the
 * tap, a client visit with no geofence.
 *
 * The design rule that shapes everything here: an approved regularisation
 * **adds punches**, it never edits or deletes them. The register recomputes
 * from punches, so a correction is a new append-only row carrying the
 * REGULARISED flag, and the original record of what the device actually saw
 * survives beside it. That is what makes the audit trail worth anything in a
 * payroll dispute.
 */

export const REGULARISATION_REASONS = [
  "MISSED_IN",
  "MISSED_OUT",
  "WRONG_TIME",
  "FIELD_DUTY",
  "DEVICE_FAILURE",
] as const
export const regularisationReasonSchema = z.enum(REGULARISATION_REASONS)
export type RegularisationReason = z.infer<typeof regularisationReasonSchema>

export const REGULARISATION_REASON_LABEL: Record<RegularisationReason, string> = {
  MISSED_IN: "Missed punch-in",
  MISSED_OUT: "Missed punch-out",
  WRONG_TIME: "Recorded time is wrong",
  FIELD_DUTY: "On field duty / client site",
  DEVICE_FAILURE: "Device or reader failure",
}

/** HH:MM, 24-hour. */
const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 09:05.")

export const regularisationRequestSchema = z
  .object({
    date: isoDateSchema,
    reason: regularisationReasonSchema,
    /** What the employee says the in-punch should have been. */
    inTime: timeString.optional(),
    outTime: timeString.optional(),
    /** Required — a regularisation with no explanation cannot be judged. */
    note: z.string().min(5, "Say what happened, in a few words.").max(400),
  })
  .refine((value) => value.inTime !== undefined || value.outTime !== undefined, {
    message: "Give at least one time to correct.",
    path: ["inTime"],
  })
  /**
   * Note there is deliberately no "out after in" check here. On a night shift
   * 06:00 legitimately follows 22:00, and a string comparison would refuse
   * every night-shift correction outright. Ordering is validated by the route,
   * which knows the employee's shift — see `regularisationOrderingError`.
   */
export type RegularisationRequest = z.infer<typeof regularisationRequestSchema>

export const clockToMinutes = (clock: string): number => {
  const [hours, minutes] = clock.split(":").map(Number)
  return hours * 60 + minutes
}

/** A one-line subject for the approvals inbox, so a manager can scan it. */
export function regularisationSubject(request: RegularisationRequest): string {
  const parts: string[] = []
  if (request.inTime) parts.push(`in ${request.inTime}`)
  if (request.outTime) parts.push(`out ${request.outTime}`)
  return `${REGULARISATION_REASON_LABEL[request.reason]} — ${parts.join(", ")}`
}

export interface RegularisationPunch {
  type: "IN" | "OUT"
  /** Minutes relative to shift start; negative means before it. */
  offsetMin: number
  clock: string
}

/**
 * The punches an approval will append. Offsets are relative to shift start
 * because that is the only thing the day engine reads — the same convention
 * every device punch uses, so a regularised day computes identically to one
 * that went right the first time.
 */
/**
 * Offset of a wall-clock time from shift start.
 *
 * On a shift that crosses midnight, a clock time earlier than the start
 * belongs to the *next* calendar day: 06:00 on a 22:00 shift is +480, not
 * −960. Subtracting plainly put the out-punch sixteen hours before the
 * in-punch, so an approved night-shift correction produced a day with negative
 * worked time — the employee's day stayed unpaid and the correction appeared
 * to have done nothing.
 */
export function offsetForShift(
  clock: string,
  shiftStartMin: number,
  crossesMidnight: boolean
): number {
  const raw = clockToMinutes(clock) - shiftStartMin
  return crossesMidnight && raw < 0 ? raw + 1440 : raw
}

/**
 * Is this correction the wrong way round for the employee's shift? Returns a
 * message, or null when the pair is coherent.
 */
export function regularisationOrderingError(
  request: RegularisationRequest,
  shiftStartMin: number,
  crossesMidnight: boolean
): string | null {
  if (request.inTime === undefined || request.outTime === undefined) return null
  const inOffset = offsetForShift(request.inTime, shiftStartMin, crossesMidnight)
  const outOffset = offsetForShift(request.outTime, shiftStartMin, crossesMidnight)
  if (outOffset <= inOffset) return "Out time must be after in time for this shift."
  return null
}

export function regularisationPunches(
  request: RegularisationRequest,
  shiftStartMin: number,
  crossesMidnight = false
): RegularisationPunch[] {
  const punches: RegularisationPunch[] = []
  if (request.inTime) {
    punches.push({
      type: "IN",
      offsetMin: offsetForShift(request.inTime, shiftStartMin, crossesMidnight),
      clock: request.inTime,
    })
  }
  if (request.outTime) {
    punches.push({
      type: "OUT",
      offsetMin: offsetForShift(request.outTime, shiftStartMin, crossesMidnight),
      clock: request.outTime,
    })
  }
  return punches
}
