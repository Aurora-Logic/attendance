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
