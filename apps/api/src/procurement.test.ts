import { beforeEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { buildServer } from "./server"

/**
 * Full PO lifecycle over the real server: raise → submit → approve (by a
 * different user) → receive in tranches → analytics. Auth travels via the
 * access_token cookie exactly as the web will send it.
 */

let app: FastifyInstance

const login = async (email: string, password: string): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  })
  expect(response.statusCode).toBe(200)
  const cookie = response.cookies.find((candidate) => candidate.name === "access_token")
  return `access_token=${cookie!.value}`
}

beforeEach(async () => {
  app = buildServer()
  await app.ready()
})

const draftPo = (cookie: string, overrides: object = {}) =>
  app.inject({
    method: "POST",
    url: "/pos",
    headers: { cookie },
    payload: {
      vendorId: "v1",
      orderDate: "2026-08-01",
      lines: [{ itemId: "i1", qty: 100, unitPricePaise: 6_500 }],
      schedules: [
        { lineIndex: 0, dueDate: "2026-08-08", qty: 60 },
        { lineIndex: 0, dueDate: "2026-08-18", qty: 40 },
      ],
      ...overrides,
    },
  })

describe("procurement lifecycle", () => {
  it("ops raises a PO; totals are exact paise; number is sequential", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const response = await draftPo(ops)
    expect(response.statusCode).toBe(201)
    const { po } = response.json()
    expect(po.number).toBe("PO-2026-0001")
    expect(po.status).toBe("DRAFT")
    // 100 KG × ₹65 @18% → 650000 + 117000
    expect(po.totals.totalPaise).toBe(767_000)
    expect(po.totals.taxBreakup).toEqual([{ ratePct: 18, taxablePaise: 650_000, taxPaise: 117_000 }])
  })

  it("creator cannot approve their own PO; a different approver can", async () => {
    const admin = await login("admin@delta.dev", "Admin@123")
    const created = (await draftPo(admin)).json()
    await app.inject({ method: "POST", url: `/pos/${created.po.id}/submit`, headers: { cookie: admin } })

    const own = await app.inject({
      method: "POST",
      url: `/pos/${created.po.id}/decide`,
      headers: { cookie: admin },
      payload: { action: "APPROVE" },
    })
    expect(own.statusCode).toBe(403)
    expect(own.json().error).toBe("CANNOT_DECIDE_OWN")
  })

  it("HR cannot raise POs (procurement.manage NONE); employee cannot view", async () => {
    const hr = await login("hr@delta.dev", "Hr@12345")
    expect((await draftPo(hr)).statusCode).toBe(403)

    const employee = await login("employee@delta.dev", "Emp@1234")
    const list = await app.inject({ method: "GET", url: "/pos", headers: { cookie: employee } })
    expect(list.statusCode).toBe(403)
  })

  it("GRNs need an approved PO, track tranches, and flag over-receipt", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const admin = await login("admin@delta.dev", "Admin@123")
    const { po } = (await draftPo(ops)).json()

    // Receipt against a draft is refused.
    const early = await app.inject({
      method: "POST",
      url: `/pos/${po.id}/grns`,
      headers: { cookie: ops },
      payload: {
        receivedDate: "2026-08-07",
        lines: [{ poLineId: po.lines[0].id, qtyAccepted: 60 }],
      },
    })
    expect(early.statusCode).toBe(422)

    await app.inject({ method: "POST", url: `/pos/${po.id}/submit`, headers: { cookie: ops } })
    const decided = await app.inject({
      method: "POST",
      url: `/pos/${po.id}/decide`,
      headers: { cookie: admin },
      payload: { action: "APPROVE" },
    })
    expect(decided.json().po.status).toBe("APPROVED")

    const first = await app.inject({
      method: "POST",
      url: `/pos/${po.id}/grns`,
      headers: { cookie: ops },
      payload: {
        receivedDate: "2026-08-07",
        invoiceNo: "INV-771",
        lines: [{ poLineId: po.lines[0].id, qtyAccepted: 60, qtyRejected: 2 }],
      },
    })
    expect(first.statusCode).toBe(201)
    expect(first.json().grn.number).toBe("GRN-2026-0001")
    expect(first.json().displayStatus).toBe("PARTIALLY_RECEIVED")

    const second = await app.inject({
      method: "POST",
      url: `/pos/${po.id}/grns`,
      headers: { cookie: ops },
      payload: {
        receivedDate: "2026-08-16",
        lines: [{ poLineId: po.lines[0].id, qtyAccepted: 45 }],
      },
    })
    // 105 accepted against 100 ordered — flagged, not blocked.
    expect(second.statusCode).toBe(201)
    expect(second.json().displayStatus).toBe("RECEIVED")
    expect(second.json().overReceived).toHaveLength(1)
    expect(second.json().overReceived[0].overReceivedQty).toBe(5)

    const detail = await app.inject({ method: "GET", url: `/pos/${po.id}`, headers: { cookie: ops } })
    const { scheduleProgress } = detail.json()
    expect(scheduleProgress[0]).toMatchObject({ status: "FULFILLED", fulfilledOn: "2026-08-07" })
    expect(scheduleProgress[1]).toMatchObject({ status: "FULFILLED", fulfilledOn: "2026-08-16" })
  })

  it("approval updates the item's default price; analytics aggregate per vendor", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const admin = await login("admin@delta.dev", "Admin@123")
    const { po } = (
      await draftPo(ops, { lines: [{ itemId: "i1", qty: 10, unitPricePaise: 7_000 }], schedules: [] })
    ).json()
    await app.inject({ method: "POST", url: `/pos/${po.id}/submit`, headers: { cookie: ops } })
    await app.inject({
      method: "POST",
      url: `/pos/${po.id}/decide`,
      headers: { cookie: admin },
      payload: { action: "APPROVE" },
    })

    const items = (await app.inject({ method: "GET", url: "/items", headers: { cookie: ops } })).json()
    expect(items.items.find((item: { id: string }) => item.id === "i1").lastPricePaise).toBe(7_000)

    const analytics = (
      await app.inject({ method: "GET", url: "/procurement/analytics", headers: { cookie: ops } })
    ).json()
    const vendor = analytics.vendors.find((candidate: { vendorId: string }) => candidate.vendorId === "v1")
    expect(vendor.poCount).toBe(1)
    expect(vendor.totalSpendPaise).toBe(82_600) // 70000 + 18% GST
    expect(analytics.monthlySpend).toEqual([{ month: "2026-08", spendPaise: 82_600 }])
  })

  it("cancel is allowed before approval only; close short-closes an approved PO", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const admin = await login("admin@delta.dev", "Admin@123")
    const { po } = (await draftPo(ops)).json()

    await app.inject({ method: "POST", url: `/pos/${po.id}/submit`, headers: { cookie: ops } })
    await app.inject({
      method: "POST",
      url: `/pos/${po.id}/decide`,
      headers: { cookie: admin },
      payload: { action: "APPROVE" },
    })

    const cancel = await app.inject({ method: "POST", url: `/pos/${po.id}/cancel`, headers: { cookie: ops } })
    expect(cancel.statusCode).toBe(409)

    const close = await app.inject({ method: "POST", url: `/pos/${po.id}/close`, headers: { cookie: ops } })
    expect(close.statusCode).toBe(200)
    expect(close.json().po.status).toBe("CLOSED")
  })

  it("vendor and item masters enforce unique codes", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const duplicate = await app.inject({
      method: "POST",
      url: "/vendors",
      headers: { cookie: ops },
      payload: { code: "VND001", name: "Duplicate Traders" },
    })
    expect(duplicate.statusCode).toBe(409)

    const created = await app.inject({
      method: "POST",
      url: "/vendors",
      headers: { cookie: ops },
      payload: { code: "VND003", name: "New Vendor Ltd", leadTimeDays: 10 },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().vendor.paymentTermsDays).toBe(30)
  })
})
