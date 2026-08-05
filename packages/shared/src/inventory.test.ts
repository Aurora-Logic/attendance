import { describe, expect, it } from "vitest"

import { stockMovements, stockPositions, type StockAdjustment } from "./inventory"
import type { Grn, Item, PurchaseOrder } from "./procurement"
import type { Challan, SalesOrder } from "./sales"

const item = (overrides: Partial<Item>): Item => ({
  id: "i1",
  code: "ITM001",
  name: "MS Sheet 2mm",
  brand: "",
  category: "Raw Material",
  unit: "KG",
  hsn: "",
  gstRatePct: 18,
  lastPricePaise: 6_500,
  salePricePaise: 8_000,
  reorderLevel: 0,
  active: true,
  ...overrides,
})

const po: PurchaseOrder = {
  id: "po1",
  number: "PO-2026-0001",
  vendorId: "v1",
  orderDate: "2026-08-01",
  status: "APPROVED",
  lines: [{ id: "pol1", itemId: "i1", qty: 100, unitPricePaise: 6_000, discountPct: 0, gstRatePct: 18 }],
  schedules: [],
  terms: "",
  notes: "",
  createdBy: "",
  approvedBy: null,
  rejectionReason: null,
}

const grn = (qty: number, date: string, id = "g1"): Grn => ({
  id,
  number: `GRN-${id}`,
  poId: "po1",
  receivedDate: date,
  invoiceNo: "",
  remarks: "",
  recordedBy: "",
  lines: [{ poLineId: "pol1", qtyAccepted: qty, qtyRejected: 0, remarks: "" }],
})

const so: SalesOrder = {
  id: "so1",
  number: "SO-2026-0001",
  customerId: "c1",
  sourceEstimateId: null,
  orderDate: "2026-08-05",
  customerRef: "",
  status: "OPEN",
  lines: [{ id: "sol1", itemId: "i1", qty: 40, unitPricePaise: 8_000, discountPct: 0, gstRatePct: 18 }],
  terms: "",
  notes: "",
  createdBy: "",
}

const challan = (qty: number, date: string): Challan => ({
  id: "ch1",
  number: "CH-2026-0001",
  soId: "so1",
  dispatchDate: date,
  vehicleNo: "",
  remarks: "",
  recordedBy: "",
  lines: [{ soLineId: "sol1", qty }],
})

describe("stock ledger", () => {
  it("derives movements from GRNs (in), challans (out) and adjustments", () => {
    const adjustments: StockAdjustment[] = [
      { id: "adj1", itemId: "i1", qty: -2, date: "2026-08-10", reason: "Damaged in handling", recordedBy: "" },
    ]
    const movements = stockMovements([po], [grn(60, "2026-08-03")], [so], [challan(40, "2026-08-06")], adjustments)
    expect(movements.map((movement) => movement.qty)).toEqual([60, -40, -2])
    // On hand: 60 in − 40 out − 2 shrinkage = 18.
    const [position] = stockPositions([item({})], movements)
    expect(position.onHandQty).toBe(18)
  })

  it("weighted-average cost over inward movements only — outs never reprice stock", () => {
    const po2: PurchaseOrder = {
      ...po,
      id: "po2",
      lines: [{ id: "pol2", itemId: "i1", qty: 50, unitPricePaise: 7_000, discountPct: 0, gstRatePct: 18 }],
    }
    const grn2: Grn = { ...grn(50, "2026-08-08", "g2"), poId: "po2", lines: [{ poLineId: "pol2", qtyAccepted: 50, qtyRejected: 0, remarks: "" }] }
    const movements = stockMovements([po, po2], [grn(100, "2026-08-03"), grn2], [so], [challan(40, "2026-08-09")], [])
    const [position] = stockPositions([item({})], movements)
    // (100×6000 + 50×7000) / 150 = 6333.33… → 6333; on hand 110.
    expect(position.avgCostPaise).toBe(6_333)
    expect(position.onHandQty).toBe(110)
    expect(position.valuePaise).toBe(110 * 6_333)
  })

  it("reorder flag trips at or below the level; 0 disables", () => {
    const movements = stockMovements([po], [grn(10, "2026-08-03")], [], [], [])
    const [flagged] = stockPositions([item({ reorderLevel: 10 })], movements)
    expect(flagged.belowReorder).toBe(true)
    const [unflagged] = stockPositions([item({ reorderLevel: 0 })], movements)
    expect(unflagged.belowReorder).toBe(false)
  })
})
