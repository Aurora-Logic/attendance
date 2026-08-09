import { describe, expect, it } from "vitest"

import { netRatePaise, productHistory, type HistoryDoc } from "./product-history"

const TODAY = "2026-08-09"

const doc = (over: Partial<HistoryDoc> = {}): HistoryDoc => ({
  id: "est1",
  number: "EST-2026-0001",
  kind: "ESTIMATE",
  partyId: "c1",
  date: "2026-08-01",
  lines: [{ itemId: "i1", qty: 10, unitPricePaise: 100_00, discountPct: 0 }],
  ...over,
})

const run = (docs: HistoryDoc[], over: Partial<Parameters<typeof productHistory>[0]> = {}) =>
  productHistory({ itemId: "i1", partyId: "c1", docs, asOfISO: TODAY, ...over })

describe("netRatePaise", () => {
  it("applies the discount and lands on a whole paise", () => {
    expect(netRatePaise(100_00, 0)).toBe(100_00)
    expect(netRatePaise(100_00, 10)).toBe(90_00)
    // 12.5% of 999 is 124.875 — a fraction of a paise cannot be charged.
    expect(netRatePaise(999, 12.5)).toBe(874)
  })

  it("a full discount is free, not negative", () => {
    expect(netRatePaise(100_00, 100)).toBe(0)
  })
})

describe("productHistory", () => {
  it("returns this party's own history, most recent first", () => {
    const history = run([
      doc({ id: "a", number: "EST-1", date: "2026-06-01" }),
      doc({ id: "b", number: "EST-2", date: "2026-07-15" }),
      doc({ id: "c", number: "EST-3", date: "2026-05-02" }),
    ])
    expect(history.scope).toBe("PARTY")
    expect(history.rows.map((row) => row.docNumber)).toEqual(["EST-2", "EST-1", "EST-3"])
  })

  it("ignores another party's documents entirely", () => {
    const history = run([
      doc({ id: "a", partyId: "c1", lines: [{ itemId: "i1", qty: 1, unitPricePaise: 100_00, discountPct: 0 }] }),
      doc({ id: "b", partyId: "c2", lines: [{ itemId: "i1", qty: 1, unitPricePaise: 50_00, discountPct: 0 }] }),
    ])
    expect(history.rows).toHaveLength(1)
    expect(history.summary.bestRatePaise).toBe(100_00)
  })

  it("ignores another item on the same document", () => {
    const history = run([
      doc({
        lines: [
          { itemId: "i9", qty: 5, unitPricePaise: 999_00, discountPct: 0 },
          { itemId: "i1", qty: 2, unitPricePaise: 100_00, discountPct: 0 },
        ],
      }),
    ])
    expect(history.rows).toHaveLength(1)
    expect(history.rows[0].qty).toBe(2)
  })

  it("leaves out a cancelled document — a price nobody honoured is not history", () => {
    const history = run([
      doc({ id: "a", date: "2026-07-01", cancelled: true, lines: [{ itemId: "i1", qty: 1, unitPricePaise: 10_00, discountPct: 0 }] }),
      doc({ id: "b", date: "2026-06-01" }),
    ])
    expect(history.rows).toHaveLength(1)
    expect(history.summary.bestRatePaise).toBe(100_00)
  })

  it("falls back to everyone when this party has no history, and says so", () => {
    // A new customer asking for a price is exactly when somebody needs a
    // number, and "no history" is useless when the item has sold forty times.
    const history = run([doc({ partyId: "c2" })], { partyId: "brand-new" })
    expect(history.scope).toBe("ALL")
    expect(history.rows).toHaveLength(1)
  })

  it("prefers the party's own history even when others have more of it", () => {
    const history = run([
      doc({ id: "own", partyId: "c1", lines: [{ itemId: "i1", qty: 1, unitPricePaise: 120_00, discountPct: 0 }] }),
      doc({ id: "x", partyId: "c2" }),
      doc({ id: "y", partyId: "c3" }),
    ])
    expect(history.scope).toBe("PARTY")
    expect(history.rows).toHaveLength(1)
    expect(history.summary.lastRatePaise).toBe(120_00)
  })

  it("reports the last rate, the floor, and how long ago", () => {
    const history = run([
      doc({ id: "a", date: "2026-08-04", lines: [{ itemId: "i1", qty: 1, unitPricePaise: 100_00, discountPct: 5 }] }),
      doc({ id: "b", date: "2026-03-01", lines: [{ itemId: "i1", qty: 1, unitPricePaise: 100_00, discountPct: 20 }] }),
    ])
    expect(history.summary.lastRatePaise).toBe(95_00)
    expect(history.summary.bestRatePaise).toBe(80_00)
    expect(history.summary.daysSinceLast).toBe(5)
    expect(history.summary.documentCount).toBe(2)
  })

  it("weights the average by quantity, not by document", () => {
    // Ten units at 100 and one at 200 averages 109, not 150. Quoting off the
    // wrong one of those is a real mispricing.
    const history = run([
      doc({ id: "a", date: "2026-08-01", lines: [{ itemId: "i1", qty: 10, unitPricePaise: 100_00, discountPct: 0 }] }),
      doc({ id: "b", date: "2026-08-02", lines: [{ itemId: "i1", qty: 1, unitPricePaise: 200_00, discountPct: 0 }] }),
    ])
    expect(history.summary.totalQty).toBe(11)
    expect(history.summary.averageRatePaise).toBe(10_909)
  })

  it("shows margin against the cost at that time", () => {
    const history = run(
      [doc({ lines: [{ itemId: "i1", qty: 1, unitPricePaise: 100_00, discountPct: 0 }] })],
      { costAt: () => 60_00 }
    )
    expect(history.rows[0].costBasisPaise).toBe(60_00)
    expect(history.rows[0].marginPct).toBe(40)
  })

  it("reports a loss honestly rather than clamping at zero", () => {
    const history = run(
      [doc({ lines: [{ itemId: "i1", qty: 1, unitPricePaise: 50_00, discountPct: 0 }] })],
      { costAt: () => 60_00 }
    )
    expect(history.rows[0].marginPct).toBe(-20)
  })

  it("leaves margin null when the cost is unknown — unknown is not free", () => {
    const history = run([doc()])
    expect(history.rows[0].costBasisPaise).toBeNull()
    expect(history.rows[0].marginPct).toBeNull()
  })

  it("does not divide by zero on a fully discounted line", () => {
    const history = run(
      [doc({ lines: [{ itemId: "i1", qty: 1, unitPricePaise: 100_00, discountPct: 100 }] })],
      { costAt: () => 60_00 }
    )
    expect(history.rows[0].netRatePaise).toBe(0)
    expect(history.rows[0].marginPct).toBeNull()
  })

  it("caps the rows but still summarises everything", () => {
    const docs = Array.from({ length: 30 }, (_, index) =>
      doc({
        id: `d${index}`,
        number: `EST-${String(index).padStart(3, "0")}`,
        date: `2026-0${1 + (index % 8)}-01`,
        lines: [{ itemId: "i1", qty: 1, unitPricePaise: (index + 1) * 100, discountPct: 0 }],
      })
    )
    const history = run(docs, { limit: 5 })
    expect(history.rows).toHaveLength(5)
    // The floor comes from all thirty, not from the five shown.
    expect(history.summary.bestRatePaise).toBe(100)
    expect(history.summary.totalQty).toBe(30)
  })

  it("an item with no history anywhere is empty, not NaN", () => {
    const history = run([], { itemId: "never-sold" })
    expect(history.rows).toEqual([])
    expect(history.summary.averageRatePaise).toBeNull()
    expect(history.summary.daysSinceLast).toBeNull()
    expect(history.summary.documentCount).toBe(0)
  })

  it("mixes purchase and sales documents when asked for a vendor's history", () => {
    const history = productHistory({
      itemId: "i1",
      partyId: "v1",
      asOfISO: TODAY,
      docs: [
        doc({ id: "po1", number: "PO-1", kind: "PURCHASE_ORDER", partyId: "v1", date: "2026-07-01" }),
      ],
    })
    expect(history.scope).toBe("PARTY")
    expect(history.rows[0].kind).toBe("PURCHASE_ORDER")
  })

  it("orders two documents on the same date deterministically", () => {
    const a = run([
      doc({ id: "a", number: "EST-A", date: "2026-08-01" }),
      doc({ id: "b", number: "EST-B", date: "2026-08-01" }),
    ])
    const b = run([
      doc({ id: "b", number: "EST-B", date: "2026-08-01" }),
      doc({ id: "a", number: "EST-A", date: "2026-08-01" }),
    ])
    expect(a.rows.map((r) => r.docNumber)).toEqual(b.rows.map((r) => r.docNumber))
  })
})
