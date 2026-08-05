import { describe, expect, it } from "vitest"

import { poTotals } from "./procurement"
import { customerSchema, estimateDisplayStatus, estimateSchema } from "./sales"

describe("estimateDisplayStatus", () => {
  const base = { status: "SENT" as const, validUntil: "2026-08-10" }

  it("a sent estimate past its validity reads EXPIRED — derived, never stored", () => {
    expect(estimateDisplayStatus(base, "2026-08-11")).toBe("EXPIRED")
    expect(estimateDisplayStatus(base, "2026-08-10")).toBe("SENT")
  })

  it("a customer's answer outlives the validity date", () => {
    expect(estimateDisplayStatus({ status: "ACCEPTED", validUntil: "2026-08-10" }, "2026-09-01")).toBe(
      "ACCEPTED"
    )
    expect(estimateDisplayStatus({ status: "REJECTED", validUntil: "2026-08-10" }, "2026-09-01")).toBe(
      "REJECTED"
    )
  })

  it("no expiry never expires; drafts never expire", () => {
    expect(estimateDisplayStatus({ status: "SENT", validUntil: null }, "2099-01-01")).toBe("SENT")
    expect(estimateDisplayStatus({ status: "DRAFT", validUntil: "2026-01-01" }, "2026-08-11")).toBe(
      "DRAFT"
    )
  })
})

describe("salesOrderFromEstimate", () => {
  it("copies lines verbatim with new ids and keeps the source link", async () => {
    const { salesOrderFromEstimate } = await import("./sales")
    const estimate = estimateSchema.parse({
      id: "est1",
      number: "EST-2026-0001",
      customerId: "c1",
      date: "2026-08-06",
      status: "ACCEPTED",
      terms: "Ex-works Mumbai.",
      lines: [
        { id: "l1", itemId: "i1", qty: 10, unitPricePaise: 25_000, gstRatePct: 18, discountPct: 5 },
      ],
    })
    const so = salesOrderFromEstimate(estimate, {
      id: "so1",
      number: "SO-2026-0001",
      orderDate: "2026-08-07",
      customerRef: "ACME-PO-991",
      createdBy: "ops@delta.dev",
    })
    expect(so.status).toBe("OPEN")
    expect(so.sourceEstimateId).toBe("est1")
    expect(so.terms).toBe("Ex-works Mumbai.")
    expect(so.lines[0]).toMatchObject({ qty: 10, unitPricePaise: 25_000, discountPct: 5 })
    expect(so.lines[0].id).not.toBe("l1")
    // Conversion never reprices: totals match the estimate exactly.
    expect(poTotals(so.lines).totalPaise).toBe(poTotals(estimate.lines).totalPaise)
  })
})

describe("soFulfilment / soDisplayStatus", () => {
  it("dispatch progress mirrors GRN receipt progress; status is derived", async () => {
    const { soFulfilment, soDisplayStatus } = await import("./sales")
    const so = {
      id: "so1",
      status: "OPEN" as const,
      lines: [
        { id: "sol1", itemId: "i1", qty: 100, unitPricePaise: 8_000, gstRatePct: 18, discountPct: 0 },
      ],
    }
    const challan = (qty: number, id: string) => ({
      id,
      number: `CH-${id}`,
      soId: "so1",
      dispatchDate: "2026-08-08",
      vehicleNo: "",
      remarks: "",
      recordedBy: "",
      lines: [{ soLineId: "sol1", qty }],
    })
    expect(soDisplayStatus(so, [])).toBe("OPEN")
    expect(soDisplayStatus(so, [challan(60, "a")])).toBe("PARTIALLY_DISPATCHED")
    expect(soFulfilment(so, [challan(60, "a")])[0]).toMatchObject({ dispatchedQty: 60, pendingQty: 40 })
    expect(soDisplayStatus(so, [challan(60, "a"), challan(40, "b")])).toBe("DISPATCHED")
    // Terminal statuses win over the derived dimension.
    expect(soDisplayStatus({ ...so, status: "CANCELLED" as const }, [challan(60, "a")])).toBe("CANCELLED")
  })
})

describe("schemas", () => {
  it("estimate lines are PO lines — one totals implementation for both sides", () => {
    const estimate = estimateSchema.parse({
      id: "est1",
      number: "EST-2026-0001",
      customerId: "c1",
      date: "2026-08-06",
      status: "DRAFT",
      lines: [{ id: "l1", itemId: "i1", qty: 10, unitPricePaise: 25_000, gstRatePct: 18 }],
    })
    // Worked example: 10 × ₹250 @18% = ₹2,950.00 exactly, same as the PO test.
    expect(poTotals(estimate.lines).totalPaise).toBe(295_000)
  })

  it("customer defaults mirror the vendor master", () => {
    const customer = customerSchema.parse({ id: "c1", code: "CST001", name: "Acme Retail" })
    expect(customer.paymentTermsDays).toBe(30)
    expect(customer.gstin).toBeNull()
    expect(customer.active).toBe(true)
  })
})
