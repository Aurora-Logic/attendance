import { describe, expect, it } from "vitest"

import {
  daysBetweenISO,
  formatDocNumber,
  lineAmounts,
  monthlySpend,
  poDisplayStatus,
  poTotals,
  receiptProgress,
  scheduleProgress,
  vendorPerformance,
  type Grn,
  type PoLine,
  type PurchaseOrder,
} from "./procurement"

/** 10 PCS × ₹250 @ 18% GST, no discount. */
const plainLine: PoLine = {
  id: "pl1",
  itemId: "i1",
  qty: 10,
  unitPricePaise: 25_000,
  gstRatePct: 18,
  discountPct: 0,
}

const po = (overrides: Partial<PurchaseOrder>): PurchaseOrder => ({
  id: "po1",
  number: "PO-2026-0001",
  vendorId: "v1",
  orderDate: "2026-08-01",
  status: "APPROVED",
  lines: [plainLine],
  schedules: [],
  terms: "",
  notes: "",
  createdBy: "u1",
  approvedBy: "u1",
  rejectionReason: null,
  ...overrides,
})

const grn = (overrides: Partial<Grn>): Grn => ({
  id: "g1",
  number: "GRN-2026-0001",
  poId: "po1",
  receivedDate: "2026-08-05",
  invoiceNo: "",
  remarks: "",
  recordedBy: "u1",
  lines: [{ poLineId: "pl1", qtyAccepted: 10, qtyRejected: 0, remarks: "" }],
  ...overrides,
})

describe("lineAmounts", () => {
  it("worked example: 10 × ₹250 @ 18% = ₹2,950.00 exactly", () => {
    expect(lineAmounts(plainLine)).toEqual({
      subtotalPaise: 250_000,
      discountPaise: 0,
      taxablePaise: 250_000,
      taxPaise: 45_000,
      totalPaise: 295_000,
    })
  })

  it("worked example: 3 × ₹33.33, 10% discount, 5% GST — each component rounded once", () => {
    // subtotal 9999, discount round(999.9)=1000, taxable 8999, tax round(449.95)=450
    expect(
      lineAmounts({ id: "l", itemId: "i", qty: 3, unitPricePaise: 3_333, gstRatePct: 5, discountPct: 10 })
    ).toEqual({
      subtotalPaise: 9_999,
      discountPaise: 1_000,
      taxablePaise: 8_999,
      taxPaise: 450,
      totalPaise: 9_449,
    })
  })

  it("fractional quantity (2.5 KG) rounds the subtotal once", () => {
    const amounts = lineAmounts({
      id: "l",
      itemId: "i",
      qty: 2.5,
      unitPricePaise: 10_101,
      gstRatePct: 18,
      discountPct: 0,
    })
    expect(amounts.subtotalPaise).toBe(25_253) // round(25252.5)
    expect(amounts.taxPaise).toBe(4_546) // round(4545.54)
    expect(amounts.totalPaise).toBe(29_799)
  })
})

describe("poTotals", () => {
  it("sums lines exactly and groups the tax breakup by rate", () => {
    const lines: PoLine[] = [
      plainLine,
      { id: "pl2", itemId: "i2", qty: 4, unitPricePaise: 50_000, gstRatePct: 5, discountPct: 0 },
      { id: "pl3", itemId: "i3", qty: 1, unitPricePaise: 100_000, gstRatePct: 18, discountPct: 0 },
    ]
    const totals = poTotals(lines)
    expect(totals.subtotalPaise).toBe(250_000 + 200_000 + 100_000)
    expect(totals.taxPaise).toBe(45_000 + 10_000 + 18_000)
    expect(totals.totalPaise).toBe(623_000)
    expect(totals.taxBreakup).toEqual([
      { ratePct: 5, taxablePaise: 200_000, taxPaise: 10_000 },
      { ratePct: 18, taxablePaise: 350_000, taxPaise: 63_000 },
    ])
  })
})

describe("receiptProgress / poDisplayStatus", () => {
  it("no GRNs → APPROVED with full pending qty", () => {
    const order = po({})
    expect(poDisplayStatus(order, [])).toBe("APPROVED")
    expect(receiptProgress(order, [])[0]).toMatchObject({ pendingQty: 10, acceptedQty: 0 })
  })

  it("partial receipt → PARTIALLY_RECEIVED, pending tracks accepted only", () => {
    const order = po({})
    const receipts = [grn({ lines: [{ poLineId: "pl1", qtyAccepted: 6, qtyRejected: 1, remarks: "" }] })]
    expect(poDisplayStatus(order, receipts)).toBe("PARTIALLY_RECEIVED")
    expect(receiptProgress(order, receipts)[0]).toMatchObject({
      acceptedQty: 6,
      rejectedQty: 1,
      pendingQty: 4,
      overReceivedQty: 0,
    })
  })

  it("full receipt across two GRNs → RECEIVED", () => {
    const order = po({})
    const receipts = [
      grn({ id: "g1", lines: [{ poLineId: "pl1", qtyAccepted: 6, qtyRejected: 0, remarks: "" }] }),
      grn({ id: "g2", receivedDate: "2026-08-09", lines: [{ poLineId: "pl1", qtyAccepted: 4, qtyRejected: 0, remarks: "" }] }),
    ]
    expect(poDisplayStatus(order, receipts)).toBe("RECEIVED")
  })

  it("over-receipt is flagged, not blocked", () => {
    const order = po({})
    const receipts = [grn({ lines: [{ poLineId: "pl1", qtyAccepted: 12, qtyRejected: 0, remarks: "" }] })]
    expect(receiptProgress(order, receipts)[0].overReceivedQty).toBe(2)
    expect(poDisplayStatus(order, receipts)).toBe("RECEIVED")
  })

  it("draft and cancelled orders keep their lifecycle status regardless of GRNs", () => {
    expect(poDisplayStatus(po({ status: "DRAFT" }), [])).toBe("DRAFT")
    expect(poDisplayStatus(po({ status: "CANCELLED" }), [grn({})])).toBe("CANCELLED")
  })
})

describe("scheduleProgress", () => {
  const scheduled = po({
    schedules: [
      { id: "s1", poLineId: "pl1", dueDate: "2026-08-05", qty: 6 },
      { id: "s2", poLineId: "pl1", dueDate: "2026-08-15", qty: 4 },
    ],
  })

  it("allocates receipts oldest-due first and records the fulfilling date", () => {
    const receipts = [
      grn({ receivedDate: "2026-08-04", lines: [{ poLineId: "pl1", qtyAccepted: 6, qtyRejected: 0, remarks: "" }] }),
    ]
    const progress = scheduleProgress(scheduled, receipts, "2026-08-10")
    expect(progress[0]).toMatchObject({ status: "FULFILLED", fulfilledOn: "2026-08-04", allocatedQty: 6 })
    expect(progress[1]).toMatchObject({ status: "ON_TRACK", allocatedQty: 0 })
  })

  it("a partially filled tranche past its due date is OVERDUE", () => {
    const receipts = [
      grn({ receivedDate: "2026-08-04", lines: [{ poLineId: "pl1", qtyAccepted: 3, qtyRejected: 0, remarks: "" }] }),
    ]
    const progress = scheduleProgress(scheduled, receipts, "2026-08-10")
    expect(progress[0]).toMatchObject({ status: "OVERDUE", allocatedQty: 3, fulfilledOn: null })
  })

  it("a tranche due within the window is DUE_SOON", () => {
    const progress = scheduleProgress(scheduled, [], "2026-08-13")
    expect(progress[1].status).toBe("DUE_SOON")
  })

  it("spill-over from one GRN fills the next tranche", () => {
    const receipts = [
      grn({ receivedDate: "2026-08-05", lines: [{ poLineId: "pl1", qtyAccepted: 10, qtyRejected: 0, remarks: "" }] }),
    ]
    const progress = scheduleProgress(scheduled, receipts, "2026-08-20")
    expect(progress[0]).toMatchObject({ status: "FULFILLED", fulfilledOn: "2026-08-05" })
    expect(progress[1]).toMatchObject({ status: "FULFILLED", fulfilledOn: "2026-08-05" })
  })
})

describe("vendorPerformance", () => {
  const scheduled = po({
    schedules: [
      { id: "s1", poLineId: "pl1", dueDate: "2026-08-05", qty: 6 },
      { id: "s2", poLineId: "pl1", dueDate: "2026-08-15", qty: 4 },
    ],
  })

  it("fully received PO: lead time, on-time rate and fill rate from one place", () => {
    const receipts = [
      grn({ receivedDate: "2026-08-04", lines: [{ poLineId: "pl1", qtyAccepted: 6, qtyRejected: 0, remarks: "" }] }),
      grn({ id: "g2", number: "GRN-2026-0002", receivedDate: "2026-08-20", lines: [{ poLineId: "pl1", qtyAccepted: 4, qtyRejected: 0, remarks: "" }] }),
    ]
    const perf = vendorPerformance("v1", [scheduled], receipts, "2026-08-25")
    expect(perf.poCount).toBe(1)
    expect(perf.totalSpendPaise).toBe(295_000)
    expect(perf.avgLeadDays).toBe(19) // 1 Aug → 20 Aug
    expect(perf.onTimeRate).toBe(50) // tranche 1 on time, tranche 2 fulfilled 5 days late
    expect(perf.fillRate).toBe(100)
    expect(perf.openPoCount).toBe(0)
  })

  it("draft POs are excluded; unreceived approved POs count as open", () => {
    const perf = vendorPerformance("v1", [po({ status: "DRAFT" }), po({ id: "po2" })], [], "2026-08-25")
    expect(perf.poCount).toBe(1)
    expect(perf.openPoCount).toBe(1)
    expect(perf.avgLeadDays).toBeNull()
    expect(perf.fillRate).toBeNull()
  })

  it("closed-short PO contributes its shortfall to the fill rate", () => {
    const closedShort = po({ status: "CLOSED" })
    const receipts = [grn({ lines: [{ poLineId: "pl1", qtyAccepted: 8, qtyRejected: 0, remarks: "" }] })]
    const perf = vendorPerformance("v1", [closedShort], receipts, "2026-08-25")
    expect(perf.fillRate).toBe(80)
  })
})

describe("GST split", () => {
  it("extracts the state code from a GSTIN", async () => {
    const { gstStateCode } = await import("./procurement")
    expect(gstStateCode("27AABCS1429B1ZP")).toBe("27")
    expect(gstStateCode("07AAACD1234E1ZP")).toBe("07")
    expect(gstStateCode(null)).toBeNull()
    expect(gstStateCode("INVALID")).toBeNull()
  })

  it("CGST + SGST always sum exactly to the single-GST figure", async () => {
    const { splitGst } = await import("./procurement")
    // ₹89.99 taxable @ 5%: total 450, halves 225/225.
    expect(splitGst(8_999, 5)).toEqual({ cgstPaise: 225, sgstPaise: 225 })
    // Odd total: ₹0.99 @ 5% → 5 paise total, splits 2 + 3 with no drift.
    const odd = splitGst(99, 5)
    expect(odd.cgstPaise + odd.sgstPaise).toBe(Math.round((99 * 5) / 100))
    // The §11-style worked example: 650000 @ 18% → 117000 = 58500 + 58500.
    expect(splitGst(650_000, 18)).toEqual({ cgstPaise: 58_500, sgstPaise: 58_500 })
  })
})

describe("helpers", () => {
  it("formats document numbers with a per-year sequence", () => {
    expect(formatDocNumber("PO", 2026, 42)).toBe("PO-2026-0042")
  })

  it("counts calendar days between ISO dates", () => {
    expect(daysBetweenISO("2026-08-01", "2026-08-20")).toBe(19)
  })

  it("monthly spend groups committed POs by order month", () => {
    const pos = [
      po({}),
      po({ id: "po2", orderDate: "2026-07-10" }),
      po({ id: "po3", orderDate: "2026-07-20", status: "DRAFT" }),
    ]
    expect(monthlySpend(pos)).toEqual([
      { month: "2026-07", spendPaise: 295_000 },
      { month: "2026-08", spendPaise: 295_000 },
    ])
  })
})
