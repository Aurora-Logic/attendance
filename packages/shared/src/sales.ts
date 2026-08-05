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

/* ------------------------------------------------------------- sales orders */

/**
 * A sales order is a customer's confirmed commitment — usually born from an
 * accepted estimate. OPEN until dispatched (fulfilment tracking arrives with
 * the inventory wave), CLOSED when done or short-closed, CANCELLED before any
 * dispatch. Lines stay PO lines; delivery schedules reuse the PO tranche shape.
 */
export const SALES_ORDER_STATUS = ["OPEN", "CLOSED", "CANCELLED"] as const
export const salesOrderStatusSchema = z.enum(SALES_ORDER_STATUS)
export type SalesOrderStatus = z.infer<typeof salesOrderStatusSchema>

export const salesOrderSchema = z.object({
  id: z.string(),
  /** SO-2026-0001; sequence per year. */
  number: z.string(),
  customerId: z.string(),
  /** The estimate this order was won from, when there was one. */
  sourceEstimateId: z.string().nullable().default(null),
  orderDate: z.string(),
  /** Customer's own PO/order reference, printed on the document. */
  customerRef: z.string().default(""),
  status: salesOrderStatusSchema,
  lines: z.array(poLineSchema).min(1),
  terms: z.string().default(""),
  notes: z.string().default(""),
  createdBy: z.string().default(""),
})
export type SalesOrder = z.infer<typeof salesOrderSchema>

/**
 * Convert an accepted estimate into a sales order: lines are copied verbatim
 * (prices were agreed — conversion must never reprice), terms carry over, and
 * the source link is kept so the estimate can never be converted twice.
 */
/* ---------------------------------------------------------------- dispatch */

/**
 * Delivery challan — goods OUT against a sales order, the mirror of a GRN.
 * Append-only: a wrong dispatch is corrected by a return adjustment in stock,
 * never by editing the challan.
 */
export const challanSchema = z.object({
  id: z.string(),
  /** CH-2026-0001. */
  number: z.string(),
  soId: z.string(),
  dispatchDate: z.string(),
  vehicleNo: z.string().default(""),
  remarks: z.string().default(""),
  recordedBy: z.string().default(""),
  lines: z.array(z.object({ soLineId: z.string(), qty: z.number().positive() })).min(1),
})
export type Challan = z.infer<typeof challanSchema>

export interface SoLineFulfilment {
  soLineId: string
  orderedQty: number
  dispatchedQty: number
  pendingQty: number
}

export function soFulfilment(
  so: Pick<SalesOrder, "id" | "lines">,
  challans: Challan[]
): SoLineFulfilment[] {
  const own = challans.filter((challan) => challan.soId === so.id)
  return so.lines.map((line) => {
    const dispatchedQty = own.reduce(
      (sum, challan) =>
        sum +
        challan.lines
          .filter((challanLine) => challanLine.soLineId === line.id)
          .reduce((lineSum, challanLine) => lineSum + challanLine.qty, 0),
      0
    )
    return {
      soLineId: line.id,
      orderedQty: line.qty,
      dispatchedQty,
      pendingQty: Math.max(line.qty - dispatchedQty, 0),
    }
  })
}

/** OPEN plus the derived dispatch dimension — never stored (D2 doctrine). */
export type SoDisplayStatus = SalesOrderStatus | "PARTIALLY_DISPATCHED" | "DISPATCHED"

export function soDisplayStatus(
  so: Pick<SalesOrder, "id" | "lines" | "status">,
  challans: Challan[]
): SoDisplayStatus {
  if (so.status !== "OPEN") return so.status
  const fulfilment = soFulfilment(so, challans)
  const any = fulfilment.some((line) => line.dispatchedQty > 0)
  if (!any) return "OPEN"
  return fulfilment.every((line) => line.pendingQty === 0) ? "DISPATCHED" : "PARTIALLY_DISPATCHED"
}

export function salesOrderFromEstimate(
  estimate: Estimate,
  input: { id: string; number: string; orderDate: string; customerRef?: string; createdBy: string }
): SalesOrder {
  return {
    id: input.id,
    number: input.number,
    customerId: estimate.customerId,
    sourceEstimateId: estimate.id,
    orderDate: input.orderDate,
    customerRef: input.customerRef ?? "",
    status: "OPEN",
    lines: estimate.lines.map((line, index) => ({ ...line, id: `${input.id}_l${index}` })),
    terms: estimate.terms,
    notes: estimate.notes,
    createdBy: input.createdBy,
  }
}
