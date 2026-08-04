import * as z from "zod"

import type { Paise } from "./money"

/**
 * Procurement: vendors, items, purchase orders with delivery schedules, and
 * goods receipts (GRNs). Same discipline as attendance — GRNs are append-only
 * (a wrong receipt is corrected by a new entry, never an UPDATE), money is
 * integer paise rounded once per line, and every derived number (receipt
 * progress, schedule status, vendor analytics) is a pure projection so the
 * API, the web preview and any report cannot drift.
 */

/* ------------------------------------------------------------------ vendors */

export const vendorSchema = z.object({
  id: z.string(),
  code: z.string().min(1),
  name: z.string().min(2),
  /** 15-char GSTIN; optional because unregistered vendors exist. */
  gstin: z.string().regex(/^[0-9A-Z]{15}$/, "GSTIN is 15 characters").nullable().default(null),
  contact: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  address: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
  /** Net payment terms, days from invoice. */
  paymentTermsDays: z.number().int().nonnegative().default(30),
  /** Vendor's promised lead time — seeds the default schedule date on a PO. */
  leadTimeDays: z.number().int().nonnegative().default(7),
  active: z.boolean().default(true),
})
export type Vendor = z.infer<typeof vendorSchema>

/* -------------------------------------------------------------------- items */

/** Common purchase units. Free-text is deliberately not allowed — a unit typo
 * makes received-vs-ordered quantities incomparable. */
export const ITEM_UNITS = ["PCS", "KG", "G", "L", "ML", "M", "BOX", "SET", "ROLL", "PKT"] as const
export const itemUnitSchema = z.enum(ITEM_UNITS)
export type ItemUnit = z.infer<typeof itemUnitSchema>

export const itemSchema = z.object({
  id: z.string(),
  code: z.string().min(1),
  name: z.string().min(2),
  /** Free-form master lists maintained by the store: pick or create inline. */
  brand: z.string().default(""),
  category: z.string().default("General"),
  unit: itemUnitSchema.default("PCS"),
  /** HSN/SAC code for the GST invoice line. */
  hsn: z.string().default(""),
  /** GST slab as a percentage (0 / 5 / 12 / 18 / 28). */
  gstRatePct: z.number().min(0).max(28).default(18),
  /** Last agreed price — the default when the item lands on a PO line. */
  lastPricePaise: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
})
export type Item = z.infer<typeof itemSchema>

/* ---------------------------------------------------------- purchase orders */

/**
 * Lifecycle states are stored; receipt states are DERIVED from GRNs and never
 * written back — see `poDisplayStatus`. Storing "PARTIALLY_RECEIVED" would be
 * a second copy of the GRN table that could disagree with it.
 */
export const PO_STATUS = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CLOSED",
  "CANCELLED",
] as const
export const poStatusSchema = z.enum(PO_STATUS)
export type PoStatus = z.infer<typeof poStatusSchema>

/** What the register shows — lifecycle plus the derived receipt dimension. */
export type PoDisplayStatus = PoStatus | "PARTIALLY_RECEIVED" | "RECEIVED"

export const poLineSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  qty: z.number().positive(),
  unitPricePaise: z.number().int().nonnegative(),
  /** Copied from the item at order time; a later item edit must not reprice history. */
  gstRatePct: z.number().min(0).max(28),
  discountPct: z.number().min(0).max(100).default(0),
})
export type PoLine = z.infer<typeof poLineSchema>

/**
 * Delivery schedule: a PO line can arrive in tranches with their own due
 * dates. "Schedules for the order" means these rows — overdue tracking and
 * on-time analytics both key on them.
 */
export const poScheduleSchema = z.object({
  id: z.string(),
  poLineId: z.string(),
  dueDate: z.string(),
  qty: z.number().positive(),
})
export type PoSchedule = z.infer<typeof poScheduleSchema>

export const purchaseOrderSchema = z.object({
  id: z.string(),
  /** Human number, e.g. PO-2026-0042. Sequence is per year. */
  number: z.string(),
  vendorId: z.string(),
  orderDate: z.string(),
  status: poStatusSchema,
  lines: z.array(poLineSchema).min(1),
  schedules: z.array(poScheduleSchema).default([]),
  /** Free-text terms printed on the document. */
  terms: z.string().default(""),
  notes: z.string().default(""),
  createdBy: z.string().default(""),
  approvedBy: z.string().nullable().default(null),
  rejectionReason: z.string().nullable().default(null),
})
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>

export const formatDocNumber = (prefix: string, year: number, seq: number): string =>
  `${prefix}-${year}-${String(seq).padStart(4, "0")}`

/* ---------------------------------------------------------------------- grn */

export const grnLineSchema = z.object({
  poLineId: z.string(),
  qtyAccepted: z.number().nonnegative(),
  qtyRejected: z.number().nonnegative().default(0),
  remarks: z.string().default(""),
})
export type GrnLine = z.infer<typeof grnLineSchema>

export const grnSchema = z.object({
  id: z.string(),
  number: z.string(),
  poId: z.string(),
  receivedDate: z.string(),
  invoiceNo: z.string().default(""),
  remarks: z.string().default(""),
  recordedBy: z.string().default(""),
  lines: z.array(grnLineSchema).min(1),
})
export type Grn = z.infer<typeof grnSchema>

/* ----------------------------------------------------------------- PO maths */

export interface LineAmounts {
  subtotalPaise: Paise
  discountPaise: Paise
  taxablePaise: Paise
  taxPaise: Paise
  totalPaise: Paise
}

/**
 * One rounding per component, at the line — totals are then exact integer
 * sums, which is what makes the §11-style worked-example tests equality
 * assertions.
 */
export function lineAmounts(line: PoLine): LineAmounts {
  const subtotalPaise = Math.round(line.qty * line.unitPricePaise)
  const discountPaise = Math.round((subtotalPaise * line.discountPct) / 100)
  const taxablePaise = subtotalPaise - discountPaise
  const taxPaise = Math.round((taxablePaise * line.gstRatePct) / 100)
  return { subtotalPaise, discountPaise, taxablePaise, taxPaise, totalPaise: taxablePaise + taxPaise }
}

export interface PoTotals extends LineAmounts {
  /** Tax grouped by GST rate, for the invoice-style breakup on the document. */
  taxBreakup: { ratePct: number; taxablePaise: Paise; taxPaise: Paise }[]
}

export function poTotals(lines: PoLine[]): PoTotals {
  const totals: PoTotals = {
    subtotalPaise: 0,
    discountPaise: 0,
    taxablePaise: 0,
    taxPaise: 0,
    totalPaise: 0,
    taxBreakup: [],
  }
  const byRate = new Map<number, { taxablePaise: number; taxPaise: number }>()
  for (const line of lines) {
    const amounts = lineAmounts(line)
    totals.subtotalPaise += amounts.subtotalPaise
    totals.discountPaise += amounts.discountPaise
    totals.taxablePaise += amounts.taxablePaise
    totals.taxPaise += amounts.taxPaise
    totals.totalPaise += amounts.totalPaise
    const bucket = byRate.get(line.gstRatePct) ?? { taxablePaise: 0, taxPaise: 0 }
    bucket.taxablePaise += amounts.taxablePaise
    bucket.taxPaise += amounts.taxPaise
    byRate.set(line.gstRatePct, bucket)
  }
  totals.taxBreakup = [...byRate.entries()]
    .map(([ratePct, bucket]) => ({ ratePct, ...bucket }))
    .sort((a, b) => a.ratePct - b.ratePct)
  return totals
}

/* --------------------------------------------------------- receipt tracking */

export interface LineReceiptProgress {
  poLineId: string
  orderedQty: number
  acceptedQty: number
  rejectedQty: number
  pendingQty: number
  /** Accepted beyond ordered — flagged for review, never blocked (§3 spirit). */
  overReceivedQty: number
}

export function receiptProgress(po: PurchaseOrder, grns: Grn[]): LineReceiptProgress[] {
  const forPo = grns.filter((grn) => grn.poId === po.id)
  return po.lines.map((line) => {
    let acceptedQty = 0
    let rejectedQty = 0
    for (const grn of forPo) {
      for (const grnLine of grn.lines) {
        if (grnLine.poLineId !== line.id) continue
        acceptedQty += grnLine.qtyAccepted
        rejectedQty += grnLine.qtyRejected
      }
    }
    return {
      poLineId: line.id,
      orderedQty: line.qty,
      acceptedQty,
      rejectedQty,
      pendingQty: Math.max(line.qty - acceptedQty, 0),
      overReceivedQty: Math.max(acceptedQty - line.qty, 0),
    }
  })
}

/** Lifecycle status plus the receipt dimension, for registers and badges. */
export function poDisplayStatus(po: PurchaseOrder, grns: Grn[]): PoDisplayStatus {
  if (po.status !== "APPROVED") return po.status
  const progress = receiptProgress(po, grns)
  const anyReceived = progress.some((line) => line.acceptedQty > 0)
  if (!anyReceived) return "APPROVED"
  return progress.every((line) => line.pendingQty === 0) ? "RECEIVED" : "PARTIALLY_RECEIVED"
}

/* -------------------------------------------------------- delivery schedule */

export const SCHEDULE_STATUS = ["FULFILLED", "ON_TRACK", "DUE_SOON", "OVERDUE"] as const
export type ScheduleStatus = (typeof SCHEDULE_STATUS)[number]

export interface ScheduleProgress {
  schedule: PoSchedule
  allocatedQty: number
  status: ScheduleStatus
  /** Date the tranche filled up, when it did — drives the on-time metric. */
  fulfilledOn: string | null
}

/**
 * Received quantity is allocated to a line's schedule tranches oldest-due
 * first, in GRN date order. A tranche is on time when the allocation that
 * completed it happened on or before its due date. This is the single
 * implementation behind the schedule badges AND vendor on-time analytics.
 */
export function scheduleProgress(
  po: PurchaseOrder,
  grns: Grn[],
  todayISO: string,
  dueSoonDays = 3
): ScheduleProgress[] {
  const receipts = grns
    .filter((grn) => grn.poId === po.id)
    .sort((a, b) => a.receivedDate.localeCompare(b.receivedDate))

  const results: ScheduleProgress[] = []
  for (const line of po.lines) {
    const tranches = po.schedules
      .filter((schedule) => schedule.poLineId === line.id)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    if (tranches.length === 0) continue

    // Walk receipts once, pouring accepted qty into tranches in order.
    const fill = tranches.map(() => ({ allocatedQty: 0, fulfilledOn: null as string | null }))
    let trancheIndex = 0
    for (const grn of receipts) {
      let incoming = grn.lines
        .filter((grnLine) => grnLine.poLineId === line.id)
        .reduce((sum, grnLine) => sum + grnLine.qtyAccepted, 0)
      while (incoming > 0 && trancheIndex < tranches.length) {
        const capacity = tranches[trancheIndex].qty - fill[trancheIndex].allocatedQty
        const poured = Math.min(capacity, incoming)
        fill[trancheIndex].allocatedQty += poured
        incoming -= poured
        if (fill[trancheIndex].allocatedQty >= tranches[trancheIndex].qty) {
          fill[trancheIndex].fulfilledOn = grn.receivedDate
          trancheIndex += 1
        } else {
          break
        }
      }
    }

    const soonCutoff = shiftDateISO(todayISO, dueSoonDays)
    for (let index = 0; index < tranches.length; index++) {
      const tranche = tranches[index]
      const { allocatedQty, fulfilledOn } = fill[index]
      let status: ScheduleStatus
      if (fulfilledOn) status = "FULFILLED"
      else if (tranche.dueDate < todayISO) status = "OVERDUE"
      else if (tranche.dueDate <= soonCutoff) status = "DUE_SOON"
      else status = "ON_TRACK"
      results.push({ schedule: tranche, allocatedQty, status, fulfilledOn })
    }
  }
  return results
}

export function shiftDateISO(dateISO: string, deltaDays: number): string {
  const date = new Date(`${dateISO}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

export const daysBetweenISO = (fromISO: string, toISO: string): number =>
  Math.round(
    (new Date(`${toISO}T00:00:00Z`).getTime() - new Date(`${fromISO}T00:00:00Z`).getTime()) /
      86_400_000
  )

/* ---------------------------------------------------------------- analytics */

export interface VendorPerformance {
  vendorId: string
  poCount: number
  /** Committed spend: every PO past DRAFT/REJECTED/CANCELLED. */
  totalSpendPaise: Paise
  /** Order date → date the PO became fully received. Null until one completes. */
  avgLeadDays: number | null
  /** Share of schedule tranches fulfilled on or before their due date. */
  onTimeRate: number | null
  /** Accepted ÷ ordered across finished (fully received or closed) POs. */
  fillRate: number | null
  openPoCount: number
  overdueTrancheCount: number
}

const COMMITTED: readonly PoStatus[] = ["APPROVED", "CLOSED"]

export function vendorPerformance(
  vendorId: string,
  pos: PurchaseOrder[],
  grns: Grn[],
  todayISO: string
): VendorPerformance {
  const vendorPos = pos.filter(
    (po) => po.vendorId === vendorId && COMMITTED.includes(po.status)
  )

  let totalSpendPaise = 0
  let leadDaysSum = 0
  let leadDaysCount = 0
  let tranchesTotal = 0
  let tranchesOnTime = 0
  let overdueTrancheCount = 0
  let orderedFinished = 0
  let acceptedFinished = 0
  let openPoCount = 0

  for (const po of vendorPos) {
    totalSpendPaise += poTotals(po.lines).totalPaise

    const progress = receiptProgress(po, grns)
    const fullyReceived = progress.every((line) => line.pendingQty === 0)
    const finished = fullyReceived || po.status === "CLOSED"
    if (!finished) openPoCount += 1

    if (fullyReceived) {
      const lastReceipt = grns
        .filter((grn) => grn.poId === po.id)
        .reduce<string | null>(
          (latest, grn) => (latest && latest >= grn.receivedDate ? latest : grn.receivedDate),
          null
        )
      if (lastReceipt) {
        leadDaysSum += daysBetweenISO(po.orderDate, lastReceipt)
        leadDaysCount += 1
      }
    }

    if (finished) {
      for (const line of progress) {
        orderedFinished += line.orderedQty
        acceptedFinished += Math.min(line.acceptedQty, line.orderedQty)
      }
    }

    for (const tranche of scheduleProgress(po, grns, todayISO)) {
      tranchesTotal += 1
      if (tranche.fulfilledOn && tranche.fulfilledOn <= tranche.schedule.dueDate) {
        tranchesOnTime += 1
      }
      if (tranche.status === "OVERDUE") overdueTrancheCount += 1
    }
  }

  return {
    vendorId,
    poCount: vendorPos.length,
    totalSpendPaise,
    avgLeadDays: leadDaysCount ? Math.round((leadDaysSum / leadDaysCount) * 10) / 10 : null,
    onTimeRate: tranchesTotal ? Math.round((tranchesOnTime / tranchesTotal) * 1000) / 10 : null,
    fillRate: orderedFinished
      ? Math.round((acceptedFinished / orderedFinished) * 1000) / 10
      : null,
    openPoCount,
    overdueTrancheCount,
  }
}

/** Committed spend per calendar month of order date, for the trend chart. */
export function monthlySpend(pos: PurchaseOrder[]): { month: string; spendPaise: Paise }[] {
  const byMonth = new Map<string, number>()
  for (const po of pos) {
    if (!COMMITTED.includes(po.status)) continue
    const month = po.orderDate.slice(0, 7)
    byMonth.set(month, (byMonth.get(month) ?? 0) + poTotals(po.lines).totalPaise)
  }
  return [...byMonth.entries()]
    .map(([month, spendPaise]) => ({ month, spendPaise }))
    .sort((a, b) => a.month.localeCompare(b.month))
}
