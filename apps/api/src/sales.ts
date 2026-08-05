import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import * as z from "zod"
import {
  customerSchema,
  estimateDisplayStatus,
  formatDocNumber,
  poTotals,
  salesOrderFromEstimate,
  type Estimate,
  type PoLine,
  type SalesOrder,
} from "@attendance/shared"

import { id, type Store } from "./store"

/**
 * Sales routes: the customer master and estimates. Same shape as the
 * procurement module — thin handlers over shared pure functions, and estimate
 * lines ARE PO lines, so the totals a customer sees here are computed by the
 * identical paise maths a vendor's PO uses.
 */

interface Guards {
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  requirePermission: (
    key: string,
    options?: { write?: boolean }
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
}

const customerBodySchema = customerSchema.omit({ id: true })

const estimateBodySchema = z.object({
  customerId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  lines: z
    .array(
      z.object({
        itemId: z.string(),
        qty: z.number().positive(),
        /** Defaults to the item's sale price, falling back to last purchase price. */
        unitPricePaise: z.number().int().nonnegative().optional(),
        discountPct: z.number().min(0).max(100).default(0),
      })
    )
    .min(1),
  terms: z.string().default(""),
  notes: z.string().default(""),
})

const decideSchema = z.object({
  action: z.enum(["ACCEPT", "REJECT"]),
  note: z.string().default(""),
})

export function registerSalesRoutes(app: FastifyInstance, store: Store, guards: Guards) {
  const { authenticate, requirePermission } = guards

  const read = [authenticate, requirePermission("sales.view")]
  const manage = [authenticate, requirePermission("sales.manage", { write: true })]

  const today = () => new Date().toISOString().slice(0, 10)

  const summary = (estimate: Estimate) => ({
    ...estimate,
    customerName:
      store.customers.find((candidate) => candidate.id === estimate.customerId)?.name ?? "—",
    displayStatus: estimateDisplayStatus(estimate, today()),
    totals: poTotals(estimate.lines),
  })

  // ---- customers ----------------------------------------------------------
  app.get("/customers", { preHandler: read }, async () => ({ customers: store.customers }))

  app.post("/customers", { preHandler: manage }, async (request, reply) => {
    const parsed = customerBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    if (store.customers.some((customer) => customer.code === parsed.data.code)) {
      return reply.code(409).send({ error: "DUPLICATE_CODE" })
    }
    const customer = { id: id(store, "c"), ...parsed.data }
    store.customers.push(customer)
    return reply.code(201).send({ customer })
  })

  app.put("/customers/:id", { preHandler: manage }, async (request, reply) => {
    const { id: customerId } = request.params as { id: string }
    const customer = store.customers.find((candidate) => candidate.id === customerId)
    if (!customer) return reply.code(404).send({ error: "NOT_FOUND" })
    const parsed = customerBodySchema.partial().safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    Object.assign(customer, parsed.data)
    return { customer }
  })

  // ---- estimates ----------------------------------------------------------
  app.get("/estimates", { preHandler: read }, async () => ({
    estimates: store.estimates.map(summary),
  }))

  app.get("/estimates/:id", { preHandler: read }, async (request, reply) => {
    const { id: estimateId } = request.params as { id: string }
    const estimate = store.estimates.find((candidate) => candidate.id === estimateId)
    if (!estimate) return reply.code(404).send({ error: "NOT_FOUND" })
    return { estimate: summary(estimate) }
  })

  app.post("/estimates", { preHandler: manage }, async (request, reply) => {
    const parsed = estimateBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const body = parsed.data

    const customer = store.customers.find((candidate) => candidate.id === body.customerId)
    if (!customer) return reply.code(404).send({ error: "CUSTOMER_NOT_FOUND" })
    if (!customer.active) return reply.code(422).send({ error: "CUSTOMER_INACTIVE" })

    const lines: PoLine[] = []
    for (const lineBody of body.lines) {
      const item = store.items.find((candidate) => candidate.id === lineBody.itemId)
      if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND", itemId: lineBody.itemId })
      lines.push({
        id: id(store, "estl"),
        itemId: item.id,
        qty: lineBody.qty,
        unitPricePaise: lineBody.unitPricePaise ?? (item.salePricePaise || item.lastPricePaise),
        // Copied at quote time — a later slab change must not reprice history.
        gstRatePct: item.gstRatePct,
        discountPct: lineBody.discountPct,
      })
    }

    store.seq.est += 1
    const estimate: Estimate = {
      id: id(store, "est"),
      number: formatDocNumber("EST", Number(body.date.slice(0, 4)), store.seq.est),
      customerId: customer.id,
      date: body.date,
      validUntil: body.validUntil,
      status: "DRAFT",
      lines,
      terms: body.terms,
      notes: body.notes,
      createdBy: request.auth.userId,
      decisionNote: "",
    }
    store.estimates.push(estimate)
    return reply.code(201).send({ estimate: summary(estimate) })
  })

  app.post("/estimates/:id/send", { preHandler: manage }, async (request, reply) => {
    const { id: estimateId } = request.params as { id: string }
    const estimate = store.estimates.find((candidate) => candidate.id === estimateId)
    if (!estimate) return reply.code(404).send({ error: "NOT_FOUND" })
    if (estimate.status !== "DRAFT") {
      return reply.code(409).send({ error: "NOT_DRAFT", status: estimate.status })
    }
    estimate.status = "SENT"
    return { estimate: summary(estimate) }
  })

  /** The customer's answer, recorded by whoever heard it. */
  app.post("/estimates/:id/decide", { preHandler: manage }, async (request, reply) => {
    const { id: estimateId } = request.params as { id: string }
    const parsed = decideSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
    const estimate = store.estimates.find((candidate) => candidate.id === estimateId)
    if (!estimate) return reply.code(404).send({ error: "NOT_FOUND" })
    if (estimate.status !== "SENT") {
      return reply.code(409).send({ error: "NOT_SENT", status: estimate.status })
    }
    estimate.status = parsed.data.action === "ACCEPT" ? "ACCEPTED" : "REJECTED"
    estimate.decisionNote = parsed.data.note
    return { estimate: summary(estimate) }
  })

  app.post("/estimates/:id/close", { preHandler: manage }, async (request, reply) => {
    const { id: estimateId } = request.params as { id: string }
    const estimate = store.estimates.find((candidate) => candidate.id === estimateId)
    if (!estimate) return reply.code(404).send({ error: "NOT_FOUND" })
    if (estimate.status === "ACCEPTED" || estimate.status === "REJECTED") {
      return reply.code(409).send({ error: "ALREADY_DECIDED", status: estimate.status })
    }
    estimate.status = "CLOSED"
    return { estimate: summary(estimate) }
  })

  // ---- sales orders -------------------------------------------------------
  const soSummary = (so: SalesOrder) => ({
    ...so,
    customerName:
      store.customers.find((candidate) => candidate.id === so.customerId)?.name ?? "—",
    totals: poTotals(so.lines),
  })

  app.get("/sales-orders", { preHandler: read }, async () => ({
    salesOrders: store.salesOrders.map(soSummary),
  }))

  app.get("/sales-orders/:id", { preHandler: read }, async (request, reply) => {
    const { id: soId } = request.params as { id: string }
    const so = store.salesOrders.find((candidate) => candidate.id === soId)
    if (!so) return reply.code(404).send({ error: "NOT_FOUND" })
    return { salesOrder: soSummary(so) }
  })

  const convertSchema = z.object({
    orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    customerRef: z.string().default(""),
  })

  /** An accepted estimate becomes an order exactly once — prices untouched. */
  app.post("/estimates/:id/convert", { preHandler: manage }, async (request, reply) => {
    const { id: estimateId } = request.params as { id: string }
    const parsed = convertSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const estimate = store.estimates.find((candidate) => candidate.id === estimateId)
    if (!estimate) return reply.code(404).send({ error: "NOT_FOUND" })
    if (estimate.status !== "ACCEPTED") {
      return reply.code(409).send({ error: "NOT_ACCEPTED", status: estimate.status })
    }
    const existing = store.salesOrders.find(
      (candidate) => candidate.sourceEstimateId === estimate.id
    )
    if (existing) {
      return reply.code(409).send({ error: "ALREADY_CONVERTED", salesOrderId: existing.id })
    }

    store.seq.so += 1
    const so = salesOrderFromEstimate(estimate, {
      id: id(store, "so"),
      number: formatDocNumber("SO", Number(parsed.data.orderDate.slice(0, 4)), store.seq.so),
      orderDate: parsed.data.orderDate,
      customerRef: parsed.data.customerRef,
      createdBy: request.auth.userId,
    })
    store.salesOrders.push(so)
    return reply.code(201).send({ salesOrder: soSummary(so) })
  })

  app.post("/sales-orders/:id/close", { preHandler: manage }, async (request, reply) => {
    const { id: soId } = request.params as { id: string }
    const so = store.salesOrders.find((candidate) => candidate.id === soId)
    if (!so) return reply.code(404).send({ error: "NOT_FOUND" })
    if (so.status !== "OPEN") return reply.code(409).send({ error: "NOT_OPEN", status: so.status })
    so.status = "CLOSED"
    return { salesOrder: soSummary(so) }
  })

  app.post("/sales-orders/:id/cancel", { preHandler: manage }, async (request, reply) => {
    const { id: soId } = request.params as { id: string }
    const so = store.salesOrders.find((candidate) => candidate.id === soId)
    if (!so) return reply.code(404).send({ error: "NOT_FOUND" })
    if (so.status !== "OPEN") return reply.code(409).send({ error: "NOT_OPEN", status: so.status })
    so.status = "CANCELLED"
    return { salesOrder: soSummary(so) }
  })
}
