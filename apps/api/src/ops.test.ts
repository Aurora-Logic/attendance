import { beforeEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { buildServer } from "./server"

/**
 * The full commercial chain over the real server:
 * estimate → SO → dispatch → invoice → receipt (sell side)
 * PO → GRN → bill (3-way match) → payment (buy side)
 * plus stock as the projection of both sides, indents, and expense claims.
 */

let app: FastifyInstance

const login = async (email: string, password: string): Promise<string> => {
  const response = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } })
  expect(response.statusCode).toBe(200)
  const cookie = response.cookies.find((candidate) => candidate.name === "access_token")
  return `access_token=${cookie!.value}`
}

beforeEach(async () => {
  app = buildServer()
  await app.ready()
})

describe("commercial chain", () => {
  it("sell side: SO → challan → invoice → receipt, statuses derived throughout", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")

    // Estimate → accept → SO.
    const { estimate } = (
      await app.inject({
        method: "POST",
        url: "/estimates",
        headers: { cookie: ops },
        payload: { customerId: "c1", date: "2026-08-06", lines: [{ itemId: "i1", qty: 100 }] },
      })
    ).json()
    await app.inject({ method: "POST", url: `/estimates/${estimate.id}/send`, headers: { cookie: ops } })
    await app.inject({
      method: "POST",
      url: `/estimates/${estimate.id}/decide`,
      headers: { cookie: ops },
      payload: { action: "ACCEPT" },
    })
    const { salesOrder } = (
      await app.inject({
        method: "POST",
        url: `/estimates/${estimate.id}/convert`,
        headers: { cookie: ops },
        payload: { orderDate: "2026-08-06" },
      })
    ).json()

    // Partial dispatch.
    const dispatched = await app.inject({
      method: "POST",
      url: `/sales-orders/${salesOrder.id}/challans`,
      headers: { cookie: ops },
      payload: {
        dispatchDate: "2026-08-07",
        vehicleNo: "MH01AB1234",
        lines: [{ soLineId: salesOrder.lines[0].id, qty: 60 }],
      },
    })
    expect(dispatched.statusCode).toBe(201)
    expect(dispatched.json().displayStatus).toBe("PARTIALLY_DISPATCHED")

    // A dispatched order can no longer be cancelled.
    const cancel = await app.inject({
      method: "POST",
      url: `/sales-orders/${salesOrder.id}/cancel`,
      headers: { cookie: ops },
    })
    expect(cancel.statusCode).toBe(409)

    // Invoice the order; totals match the SO exactly.
    const invoiced = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: { cookie: ops },
      payload: { soId: salesOrder.id, date: "2026-08-08", dueDate: "2026-09-07" },
    })
    expect(invoiced.statusCode).toBe(201)
    const { invoice } = invoiced.json()
    expect(invoice.number).toBe("INV-2026-0001")
    expect(invoice.totals.totalPaise).toBe(salesOrder.totals.totalPaise)
    expect(invoice.outstandingPaise).toBe(invoice.totals.totalPaise)

    // Receipt auto-allocates oldest-first.
    const received = await app.inject({
      method: "POST",
      url: "/receipts",
      headers: { cookie: ops },
      payload: { partyId: "c1", date: "2026-08-20", amountPaise: 500_000, mode: "BANK" },
    })
    expect(received.statusCode).toBe(201)
    expect(received.json().receipt.allocations).toEqual([
      { docId: invoice.id, amountPaise: 500_000 },
    ])
    const list = (await app.inject({ method: "GET", url: "/invoices", headers: { cookie: ops } })).json()
    expect(list.invoices[0].outstandingPaise).toBe(invoice.totals.totalPaise - 500_000)
  })

  it("buy side: bill against PO+GRN carries 3-way flags; payment allocates; stock reflects both sides", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const admin = await login("admin@delta.dev", "Admin@123")

    // PO → approve → GRN 80 of 100.
    const { po } = (
      await app.inject({
        method: "POST",
        url: "/pos",
        headers: { cookie: ops },
        payload: {
          vendorId: "v1",
          orderDate: "2026-08-01",
          lines: [{ itemId: "i1", qty: 100, unitPricePaise: 6_000 }],
        },
      })
    ).json()
    await app.inject({ method: "POST", url: `/pos/${po.id}/submit`, headers: { cookie: ops } })
    await app.inject({
      method: "POST",
      url: `/pos/${po.id}/decide`,
      headers: { cookie: admin },
      payload: { action: "APPROVE" },
    })
    await app.inject({
      method: "POST",
      url: `/pos/${po.id}/grns`,
      headers: { cookie: ops },
      payload: {
        receivedDate: "2026-08-05",
        lines: [{ poLineId: po.lines[0].id, qtyAccepted: 80, qtyRejected: 0 }],
      },
    })

    // Bill for 100 at a higher rate — flagged, not blocked.
    const billed = await app.inject({
      method: "POST",
      url: "/vendor-bills",
      headers: { cookie: ops },
      payload: {
        billNo: "SST/9981",
        vendorId: "v1",
        poId: po.id,
        date: "2026-08-06",
        dueDate: "2026-09-05",
        lines: [{ id: "bl1", itemId: "i1", qty: 100, unitPricePaise: 6_500, gstRatePct: 18 }],
      },
    })
    expect(billed.statusCode).toBe(201)
    const { bill } = billed.json()
    expect(bill.match[0]).toMatchObject({ overBilledQty: 20, rateDeltaPaise: 500 })

    // Payment auto-allocates against the bill.
    const paid = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { cookie: ops },
      payload: { partyId: "v1", date: "2026-08-25", amountPaise: 100_000 },
    })
    expect(paid.statusCode).toBe(201)
    expect(paid.json().payment.allocations[0].docId).toBe(bill.id)

    // Stock: 80 in from the GRN at cost 6000.
    const stock = (await app.inject({ method: "GET", url: "/stock", headers: { cookie: ops } })).json()
    const position = stock.positions.find((candidate: { itemId: string }) => candidate.itemId === "i1")
    expect(position.onHandQty).toBe(80)
    expect(position.avgCostPaise).toBe(6_000)
  })

  it("drafts edit in place until submitted; money documents cancel only before money moves", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")

    // Draft PO edits in place; after submit the PUT is refused.
    const { po } = (
      await app.inject({
        method: "POST",
        url: "/pos",
        headers: { cookie: ops },
        payload: { vendorId: "v1", orderDate: "2026-08-06", lines: [{ itemId: "i1", qty: 10 }] },
      })
    ).json()
    const edited = await app.inject({
      method: "PUT",
      url: `/pos/${po.id}`,
      headers: { cookie: ops },
      payload: { vendorId: "v2", orderDate: "2026-08-07", lines: [{ itemId: "i2", qty: 50 }] },
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().po.vendorId).toBe("v2")
    // The PO number never changes on edit — identity survives the rewrite.
    expect(edited.json().po.number).toBe(po.number)
    await app.inject({ method: "POST", url: `/pos/${po.id}/submit`, headers: { cookie: ops } })
    const late = await app.inject({
      method: "PUT",
      url: `/pos/${po.id}`,
      headers: { cookie: ops },
      payload: { vendorId: "v1", orderDate: "2026-08-07", lines: [{ itemId: "i1", qty: 1 }] },
    })
    expect(late.statusCode).toBe(409)

    // Estimate → SO → invoice → part-receipt: the invoice can no longer cancel.
    const { estimate } = (
      await app.inject({
        method: "POST",
        url: "/estimates",
        headers: { cookie: ops },
        payload: { customerId: "c1", date: "2026-08-06", lines: [{ itemId: "i1", qty: 10 }] },
      })
    ).json()
    await app.inject({ method: "POST", url: `/estimates/${estimate.id}/send`, headers: { cookie: ops } })
    const sentEdit = await app.inject({
      method: "PUT",
      url: `/estimates/${estimate.id}`,
      headers: { cookie: ops },
      payload: { customerId: "c1", date: "2026-08-06", lines: [{ itemId: "i1", qty: 5 }] },
    })
    expect(sentEdit.statusCode).toBe(409)
    await app.inject({
      method: "POST",
      url: `/estimates/${estimate.id}/decide`,
      headers: { cookie: ops },
      payload: { action: "ACCEPT" },
    })
    const { salesOrder } = (
      await app.inject({
        method: "POST",
        url: `/estimates/${estimate.id}/convert`,
        headers: { cookie: ops },
        payload: { orderDate: "2026-08-06" },
      })
    ).json()
    const { invoice } = (
      await app.inject({
        method: "POST",
        url: "/invoices",
        headers: { cookie: ops },
        payload: { soId: salesOrder.id, date: "2026-08-06", dueDate: "2026-09-05" },
      })
    ).json()
    // Before any receipt: cancellable... but first prove the guard.
    await app.inject({
      method: "POST",
      url: "/receipts",
      headers: { cookie: ops },
      payload: { partyId: "c1", date: "2026-08-10", amountPaise: 10_000 },
    })
    const blocked = await app.inject({
      method: "POST",
      url: `/invoices/${invoice.id}/cancel`,
      headers: { cookie: ops },
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toBe("RECEIPTS_ALLOCATED")
  })

  it("indent: request → approve → mark ordered; expense: claim → approve (not own) → reimburse", async () => {
    const employee = await login("employee@delta.dev", "Emp@1234")
    const ops = await login("ops@delta.dev", "Ops@1234")
    const hr = await login("hr@delta.dev", "Hr@12345")

    const { indent } = (
      await app.inject({
        method: "POST",
        url: "/indents",
        headers: { cookie: employee },
        payload: {
          department: "Operations",
          date: "2026-08-06",
          lines: [{ itemId: "i3", qty: 20 }],
        },
      })
    ).json()
    expect(indent.number).toBe("IND-2026-0001")
    await app.inject({
      method: "POST",
      url: `/indents/${indent.id}/decide`,
      headers: { cookie: ops },
      payload: { action: "APPROVE" },
    })
    const ordered = await app.inject({
      method: "POST",
      url: `/indents/${indent.id}/mark-ordered`,
      headers: { cookie: ops },
      payload: { poId: "po_x" },
    })
    expect(ordered.json().indent.status).toBe("ORDERED")

    const { claim } = (
      await app.inject({
        method: "POST",
        url: "/expense-claims",
        headers: { cookie: employee },
        payload: {
          date: "2026-08-05",
          category: "Travel",
          amountPaise: 45_000,
          description: "Client visit — auto + train",
        },
      })
    ).json()
    expect(claim.number).toBe("EXP-2026-0001")

    const approved = await app.inject({
      method: "POST",
      url: `/expense-claims/${claim.id}/decide`,
      headers: { cookie: hr },
      payload: { action: "APPROVE" },
    })
    expect(approved.json().claim.status).toBe("APPROVED")

    const reimbursed = await app.inject({
      method: "POST",
      url: `/expense-claims/${claim.id}/reimburse`,
      headers: { cookie: hr },
    })
    expect(reimbursed.json().claim.status).toBe("REIMBURSED")
  })
})
