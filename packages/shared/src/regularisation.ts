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
  .refine(
    (value) =>
      value.inTime === undefined ||
      value.outTime === undefined ||
      value.outTime > value.inTime,
    { message: "Out time must be after in time.", path: ["outTime"] }
  )
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
export function regularisationPunches(
  request: RegularisationRequest,
  shiftStartMin: number
): RegularisationPunch[] {
  const punches: RegularisationPunch[] = []
  if (request.inTime) {
    punches.push({
      type: "IN",
      offsetMin: clockToMinutes(request.inTime) - shiftStartMin,
      clock: request.inTime,
    })
  }
  if (request.outTime) {
    punches.push({
      type: "OUT",
      offsetMin: clockToMinutes(request.outTime) - shiftStartMin,
      clock: request.outTime,
    })
  }
  return punches
}
