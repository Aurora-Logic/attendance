import * as z from "zod"

import type { Paise } from "./money"
import { poLineSchema, poTotals, receiptProgress, type Grn, type PurchaseOrder } from "./procurement"

/**
 * Billing, both directions: invoices we RAISE on customers (receivables) and
 * bills vendors RAISE on us (payables). Lines stay PO lines — one paise/GST
 * implementation for every money document in the system. Payments are
 * append-only entries allocated against documents; "outstanding" and "ageing"
 * are projections, never stored.
 */

/* ----------------------------------------------------------------- invoices */

export const INVOICE_STATUS = ["OPEN", "CANCELLED"] as const
export const invoiceSchema = z.object({
  id: z.string(),
  /** INV-2026-0001. */
  number: z.string(),
  customerId: z.string(),
  /** The sales order it bills, when there is one. */
  soId: z.string().nullable().default(null),
  date: z.string(),
  dueDate: z.string(),
  status: z.enum(INVOICE_STATUS),
  lines: z.array(poLineSchema).min(1),
  terms: z.string().default(""),
  createdBy: z.string().default(""),
})
export type Invoice = z.infer<typeof invoiceSchema>

/* ------------------------------------------------------------- vendor bills */

export const vendorBillSchema = z.object({
  id: z.string(),
  /** The VENDOR's invoice number — their document, our record. */
  billNo: z.string().min(1),
  vendorId: z.string(),
  poId: z.string().nullable().default(null),
  date: z.string(),
  dueDate: z.string(),
  status: z.enum(INVOICE_STATUS),
  lines: z.array(poLineSchema).min(1),
  remarks: z.string().default(""),
  recordedBy: z.string().default(""),
})
export type VendorBill = z.infer<typeof vendorBillSchema>

/**
 * Three-way match: PO (what we ordered) ↔ GRN (what arrived) ↔ bill (what
 * they charge). Mismatches are FLAGS, not blocks — §3's doctrine; the bill is
 * a fact, whether to pay it is a judgement made with the flags in view.
 */
export interface ThreeWayLineMatch {
  itemId: string
  billedQty: number
  orderedQty: number
  receivedQty: number
  /** Charged for more than accepted delivery. */
  overBilledQty: number
  /** Billed rate − PO rate, per unit. Positive = charged above agreement. */
  rateDeltaPaise: Paise
}

export function threeWayMatch(
  bill: Pick<VendorBill, "lines">,
  po: PurchaseOrder,
  grns: Grn[]
): ThreeWayLineMatch[] {
  const received = receiptProgress(po, grns)
  return bill.lines.map((billLine) => {
    const poLine = po.lines.find((candidate) => candidate.itemId === billLine.itemId)
    const receivedQty = poLine
      ? (received.find((line) => line.poLineId === poLine.id)?.acceptedQty ?? 0)
      : 0
    return {
      itemId: billLine.itemId,
      billedQty: billLine.qty,
      orderedQty: poLine?.qty ?? 0,
      receivedQty,
      overBilledQty: Math.max(billLine.qty - receivedQty, 0),
      rateDeltaPaise: poLine ? billLine.unitPricePaise - poLine.unitPricePaise : 0,
    }
  })
}

/* ----------------------------------------------------------------- payments */

export const PAYMENT_MODES = ["BANK", "UPI", "CHEQUE", "CASH"] as const

/** One money event, allocated across documents. Works for both directions. */
export const paymentEntrySchema = z.object({
  id: z.string(),
  /** Customer (receipts) or vendor (payments). */
  partyId: z.string(),
  date: z.string(),
  amountPaise: z.number().int().positive(),
  mode: z.enum(PAYMENT_MODES).default("BANK"),
  reference: z.string().default(""),
  remarks: z.string().default(""),
  recordedBy: z.string().default(""),
  /** docId = invoice id (receipts) or bill id (payments). */
  allocations: z
    .array(z.object({ docId: z.string(), amountPaise: z.number().int().positive() }))
    .min(1),
})
export type PaymentEntry = z.infer<typeof paymentEntrySchema>

export function allocatedToDoc(docId: string, payments: PaymentEntry[]): Paise {
  return payments.reduce(
    (sum, payment) =>
      sum +
      payment.allocations
        .filter((allocation) => allocation.docId === docId)
        .reduce((allocationSum, allocation) => allocationSum + allocation.amountPaise, 0),
    0
  )
}

export function outstandingPaise(
  doc: { id: string; lines: z.infer<typeof poLineSchema>[]; status: string },
  payments: PaymentEntry[]
): Paise {
  if (doc.status === "CANCELLED") return 0
  return Math.max(poTotals(doc.lines).totalPaise - allocatedToDoc(doc.id, payments), 0)
}

/**
 * Allocate a lump amount across open documents oldest-due-first — how a
 * cheque "against outstanding" is booked when the party names no invoice.
 */
export function allocateOldestFirst(
  amountPaise: Paise,
  docs: Array<{ id: string; dueDate: string; outstandingPaise: Paise }>
): Array<{ docId: string; amountPaise: Paise }> {
  const allocations: Array<{ docId: string; amountPaise: Paise }> = []
  let remaining = amountPaise
  for (const doc of [...docs].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    if (remaining <= 0) break
    if (doc.outstandingPaise <= 0) continue
    const applied = Math.min(doc.outstandingPaise, remaining)
    allocations.push({ docId: doc.id, amountPaise: applied })
    remaining -= applied
  }
  return allocations
}

/* ------------------------------------------------------------------- ageing */

export const AGEING_BUCKETS = ["CURRENT", "1-30", "31-60", "61-90", "90+"] as const
export type AgeingBucket = (typeof AGEING_BUCKETS)[number]

export function ageingBucket(dueDateISO: string, todayISO: string): AgeingBucket {
  if (dueDateISO >= todayISO) return "CURRENT"
  const days = Math.round(
    (new Date(`${todayISO}T00:00:00Z`).getTime() - new Date(`${dueDateISO}T00:00:00Z`).getTime()) /
      86_400_000
  )
  if (days <= 30) return "1-30"
  if (days <= 60) return "31-60"
  if (days <= 90) return "61-90"
  return "90+"
}
