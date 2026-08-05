import * as z from "zod"

import { poLineSchema } from "./procurement"

/**
 * Sales: customers and estimates (quotations) — the sell-side mirror of
 * procurement. Estimate lines reuse the PO line shape, so every paise of
 * totals, discount and GST maths is the same single implementation in
 * procurement.ts; sales adds only the lifecycle and the validity clock.
 */

export const customerSchema = z.object({
  id: z.string(),
  code: z.string().min(1),
  name: z.string().min(2),
  gstin: z.string().regex(/^[0-9A-Z]{15}$/, "GSTIN is 15 characters").nullable().default(null),
  contact: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  address: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
  paymentTermsDays: z.number().int().nonnegative().default(30),
  active: z.boolean().default(true),
})
export type Customer = z.infer<typeof customerSchema>

/**
 * Lifecycle is stored; EXPIRED is DERIVED from the validity date and never
 * written back — the same doctrine as PO receipt states (D2). An accepted or
 * rejected estimate keeps that status even past validity, because the
 * customer's answer is a fact that a date cannot undo.
 */
export const ESTIMATE_STATUS = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CLOSED"] as const
export const estimateStatusSchema = z.enum(ESTIMATE_STATUS)
export type EstimateStatus = z.infer<typeof estimateStatusSchema>

export type EstimateDisplayStatus = EstimateStatus | "EXPIRED"

export const estimateSchema = z.object({
  id: z.string(),
  /** EST-2026-0001; sequence per year, like POs. */
  number: z.string(),
  customerId: z.string(),
  date: z.string(),
  /** Null = no expiry. */
  validUntil: z.string().nullable().default(null),
  status: estimateStatusSchema,
  lines: z.array(poLineSchema).min(1),
  terms: z.string().default(""),
  notes: z.string().default(""),
  createdBy: z.string().default(""),
  /** Why it was rejected / any decision remark. */
  decisionNote: z.string().default(""),
})
export type Estimate = z.infer<typeof estimateSchema>

export function estimateDisplayStatus(
  estimate: Pick<Estimate, "status" | "validUntil">,
  todayISO: string
): EstimateDisplayStatus {
  if (estimate.status === "SENT" && estimate.validUntil && estimate.validUntil < todayISO) {
    return "EXPIRED"
  }
  return estimate.status
}
