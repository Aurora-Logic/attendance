import { describe, expect, it } from "vitest"

import {
  ageingBucket,
  allocateOldestFirst,
  allocatedToDoc,
  outstandingPaise,
  threeWayMatch,
  type PaymentEntry,
  type VendorBill,
} from "./billing"
import type { Grn, PoLine, PurchaseOrder } from "./procurement"

const lines: PoLine[] = [
  { id: "l1", itemId: "i1", qty: 10, unitPricePaise: 25_000, gstRatePct: 18, discountPct: 0 },
]
// Total: 250000 + 45000 = 295000.

const payment = (amount: number, docId = "inv1"): PaymentEntry => ({
  id: "pay1",
  partyId: "c1",
  date: "2026-08-10",
  amountPaise: amount,
  mode: "BANK",
  reference: "",
  remarks: "",
  recordedBy: "",
  allocations: [{ docId, amountPaise: amount }],
})

describe("outstanding & allocation", () => {
  it("outstanding = total − allocations, floored at zero; cancelled owes nothing", () => {
    const doc = { id: "inv1", lines, status: "OPEN" }
    expect(outstandingPaise(doc, [])).toBe(295_000)
    expect(outstandingPaise(doc, [payment(200_000)])).toBe(95_000)
    expect(outstandingPaise(doc, [payment(300_000)])).toBe(0)
    expect(outstandingPaise({ ...doc, status: "CANCELLED" }, [])).toBe(0)
    expect(allocatedToDoc("inv1", [payment(200_000)])).toBe(200_000)
  })

  it("a lump amount books oldest-due-first and stops when spent", () => {
    const allocations = allocateOldestFirst(120_000, [
      { id: "b", dueDate: "2026-08-20", outstandingPaise: 100_000 },
      { id: "a", dueDate: "2026-08-10", outstandingPaise: 50_000 },
      { id: "c", dueDate: "2026-09-01", outstandingPaise: 80_000 },
    ])
    expect(allocations).toEqual([
      { docId: "a", amountPaise: 50_000 },
      { docId: "b", amountPaise: 70_000 },
    ])
  })
})

describe("ageing", () => {
  it("buckets by days past due", () => {
    expect(ageingBucket("2026-08-10", "2026-08-06")).toBe("CURRENT")
    expect(ageingBucket("2026-08-01", "2026-08-06")).toBe("1-30")
    expect(ageingBucket("2026-07-01", "2026-08-06")).toBe("31-60")
    expect(ageingBucket("2026-06-01", "2026-08-06")).toBe("61-90")
    expect(ageingBucket("2026-01-01", "2026-08-06")).toBe("90+")
  })
})

describe("three-way match", () => {
  const po: PurchaseOrder = {
    id: "po1",
    number: "PO-2026-0001",
    vendorId: "v1",
    orderDate: "2026-08-01",
    status: "APPROVED",
    lines: [{ id: "pol1", itemId: "i1", qty: 100, unitPricePaise: 6_000, gstRatePct: 18, discountPct: 0 }],
    schedules: [],
    terms: "",
    notes: "",
    createdBy: "",
    approvedBy: null,
    rejectionReason: null,
  }
  const grns: Grn[] = [
    {
      id: "g1",
      number: "GRN-2026-0001",
      poId: "po1",
      receivedDate: "2026-08-05",
      invoiceNo: "",
      remarks: "",
      recordedBy: "",
      lines: [{ poLineId: "pol1", qtyAccepted: 80, qtyRejected: 5, remarks: "" }],
    },
  ]
  const bill = (qty: number, rate: number): Pick<VendorBill, "lines"> => ({
    lines: [{ id: "bl1", itemId: "i1", qty, unitPricePaise: rate, gstRatePct: 18, discountPct: 0 }],
  })

  it("flags billing beyond accepted receipt and rate above the PO", () => {
    const [match] = threeWayMatch(bill(100, 6_500), po, grns)
    expect(match).toMatchObject({
      billedQty: 100,
      orderedQty: 100,
      receivedQty: 80,
      overBilledQty: 20, // billed the rejected 5 and the undelivered 15
      rateDeltaPaise: 500,
    })
  })

  it("a clean bill matches with zero flags", () => {
    const [match] = threeWayMatch(bill(80, 6_000), po, grns)
    expect(match.overBilledQty).toBe(0)
    expect(match.rateDeltaPaise).toBe(0)
  })

  it("aggregates duplicate item lines on the PO — a clean bill must not flag", () => {
    const split: PurchaseOrder = {
      ...po,
      lines: [
        { id: "pol1", itemId: "i1", qty: 60, unitPricePaise: 6_000, gstRatePct: 18, discountPct: 0 },
        { id: "pol2", itemId: "i1", qty: 40, unitPricePaise: 6_200, gstRatePct: 18, discountPct: 0 },
      ],
    }
    const splitGrns: Grn[] = [
      {
        ...grns[0],
        lines: [
          { poLineId: "pol1", qtyAccepted: 60, qtyRejected: 0, remarks: "" },
          { poLineId: "pol2", qtyAccepted: 40, qtyRejected: 0, remarks: "" },
        ],
      },
    ]
    const [match] = threeWayMatch(bill(100, 6_000), split, splitGrns)
    expect(match.orderedQty).toBe(100)
    expect(match.receivedQty).toBe(100)
    expect(match.overBilledQty).toBe(0)
  })

  it("an item never on the PO is fully over-billed", () => {
    const rogue = {
      lines: [
        { id: "bl1", itemId: "i9", qty: 5, unitPricePaise: 1_000, gstRatePct: 18, discountPct: 0 },
      ],
    }
    const [match] = threeWayMatch(rogue, po, grns)
    expect(match.orderedQty).toBe(0)
    expect(match.overBilledQty).toBe(5)
  })
})

describe("edges", () => {
  it("100% discount yields zero taxable, zero tax, zero total", async () => {
    const { lineAmounts } = await import("./procurement")
    const amounts = lineAmounts({
      id: "l",
      itemId: "i",
      qty: 10,
      unitPricePaise: 25_000,
      gstRatePct: 18,
      discountPct: 100,
    })
    expect(amounts).toMatchObject({ taxablePaise: 0, taxPaise: 0, totalPaise: 0 })
  })

  it("rate-0 GST splits to zero without dividing by anything", async () => {
    const { splitGst } = await import("./procurement")
    expect(splitGst(100_000, 0)).toEqual({ cgstPaise: 0, sgstPaise: 0 })
  })
})
