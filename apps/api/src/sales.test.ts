import { beforeEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { buildServer } from "./server"

/** Estimate lifecycle over the real server: raise → send → decide. */

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

const draftEstimate = (cookie: string, overrides: object = {}) =>
  app.inject({
    method: "POST",
    url: "/estimates",
    headers: { cookie },
    payload: {
      customerId: "c1",
      date: "2026-08-06",
      validUntil: "2026-08-20",
      lines: [{ itemId: "i1", qty: 100 }],
      ...overrides,
    },
  })

describe("sales", () => {
  it("raises an estimate with sale-price defaults and exact totals", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const response = await draftEstimate(ops)
    expect(response.statusCode).toBe(201)
    const { estimate } = response.json()
    expect(estimate.number).toBe("EST-2026-0001")
    expect(estimate.status).toBe("DRAFT")
    // Item i1 sale price 6500 paise × 100 KG @18% → 650000 + 117000.
    expect(estimate.totals.totalPaise).toBe(767_000)
    expect(estimate.customerName).toBe("Acme Retail Pvt Ltd")
  })

  it("send → accept records the customer's answer; deciding twice conflicts", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const { estimate } = (await draftEstimate(ops)).json()

    // Deciding a draft is refused — it was never sent.
    const early = await app.inject({
      method: "POST",
      url: `/estimates/${estimate.id}/decide`,
      headers: { cookie: ops },
      payload: { action: "ACCEPT" },
    })
    expect(early.statusCode).toBe(409)

    await app.inject({ method: "POST", url: `/estimates/${estimate.id}/send`, headers: { cookie: ops } })
    const decided = await app.inject({
      method: "POST",
      url: `/estimates/${estimate.id}/decide`,
      headers: { cookie: ops },
      payload: { action: "ACCEPT", note: "PO to follow" },
    })
    expect(decided.json().estimate.status).toBe("ACCEPTED")
    expect(decided.json().estimate.decisionNote).toBe("PO to follow")

    const again = await app.inject({
      method: "POST",
      url: `/estimates/${estimate.id}/decide`,
      headers: { cookie: ops },
      payload: { action: "REJECT" },
    })
    expect(again.statusCode).toBe(409)
  })

  it("a sent estimate past validity reads EXPIRED without being written back", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const { estimate } = (await draftEstimate(ops, { validUntil: "2026-01-01" })).json()
    await app.inject({ method: "POST", url: `/estimates/${estimate.id}/send`, headers: { cookie: ops } })

    const list = await app.inject({ method: "GET", url: "/estimates", headers: { cookie: ops } })
    const row = list.json().estimates.find((candidate: { id: string }) => candidate.id === estimate.id)
    expect(row.displayStatus).toBe("EXPIRED")
    expect(row.status).toBe("SENT")
  })

  it("HR is read-only; employees see nothing", async () => {
    const hr = await login("hr@delta.dev", "Hr@12345")
    expect((await draftEstimate(hr)).statusCode).toBe(403)
    expect(
      (await app.inject({ method: "GET", url: "/customers", headers: { cookie: hr } })).statusCode
    ).toBe(200)

    const employee = await login("employee@delta.dev", "Emp@1234")
    expect(
      (await app.inject({ method: "GET", url: "/estimates", headers: { cookie: employee } }))
        .statusCode
    ).toBe(403)
  })

  it("accepted estimate converts to a sales order exactly once, prices untouched", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const { estimate } = (await draftEstimate(ops)).json()
    await app.inject({ method: "POST", url: `/estimates/${estimate.id}/send`, headers: { cookie: ops } })

    // Converting before acceptance is refused.
    const early = await app.inject({
      method: "POST",
      url: `/estimates/${estimate.id}/convert`,
      headers: { cookie: ops },
      payload: { orderDate: "2026-08-07" },
    })
    expect(early.statusCode).toBe(409)

    await app.inject({
      method: "POST",
      url: `/estimates/${estimate.id}/decide`,
      headers: { cookie: ops },
      payload: { action: "ACCEPT" },
    })
    const converted = await app.inject({
      method: "POST",
      url: `/estimates/${estimate.id}/convert`,
      headers: { cookie: ops },
      payload: { orderDate: "2026-08-07", customerRef: "ACME-PO-991" },
    })
    expect(converted.statusCode).toBe(201)
    const { salesOrder } = converted.json()
    expect(salesOrder.number).toBe("SO-2026-0001")
    expect(salesOrder.status).toBe("OPEN")
    expect(salesOrder.sourceEstimateId).toBe(estimate.id)
    // Conversion never reprices.
    expect(salesOrder.totals.totalPaise).toBe(767_000)

    const twice = await app.inject({
      method: "POST",
      url: `/estimates/${estimate.id}/convert`,
      headers: { cookie: ops },
      payload: { orderDate: "2026-08-07" },
    })
    expect(twice.statusCode).toBe(409)
    expect(twice.json().error).toBe("ALREADY_CONVERTED")
  })

  it("customer master enforces unique codes", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const duplicate = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { cookie: ops },
      payload: { code: "CST001", name: "Duplicate Retail" },
    })
    expect(duplicate.statusCode).toBe(409)
  })
})
