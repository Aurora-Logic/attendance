import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import * as z from "zod"
import {
  allocateOldestFirst,
  challanSchema,
  customerSchema,
  estimateDisplayStatus,
  formatDocNumber,
  outstandingPaise,
  paymentEntrySchema,
  poTotals,
  salesOrderFromEstimate,
  soDisplayStatus,
  soFulfilment,
  type Challan,
  type Estimate,
  type Invoice,
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

  /** Rewrite a DRAFT in place — the one lifecycle stage where editing is honest. */
  app.put("/estimates/:id", { preHandler: manage }, async (request, reply) => {
    const { id: estimateId } = request.params as { id: string }
    const parsed = estimateBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const estimate = store.estimates.find((candidate) => candidate.id === estimateId)
    if (!estimate) return reply.code(404).send({ error: "NOT_FOUND" })
    if (estimate.status !== "DRAFT") {
      return reply.code(409).send({ error: "NOT_DRAFT", status: estimate.status })
    }
    const body = parsed.data
    const lines: PoLine[] = []
    for (const lineBody of body.lines) {
      const item = store.items.find((candidate) => candidate.id === lineBody.itemId)
      if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND", itemId: lineBody.itemId })
      lines.push({
        id: id(store, "estl"),
        itemId: item.id,
        qty: lineBody.qty,
        unitPricePaise: lineBody.unitPricePaise ?? (item.salePricePaise || item.lastPricePaise),
        gstRatePct: item.gstRatePct,
        discountPct: lineBody.discountPct,
      })
    }
    Object.assign(estimate, {
      customerId: body.customerId,
      date: body.date,
      validUntil: body.validUntil,
      terms: body.terms,
      notes: body.notes,
      lines,
    })
    return { estimate: summary(estimate) }
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

  /** Pull a sent estimate back to DRAFT — the path to editing before a decision. */
  app.post("/estimates/:id/recall", { preHandler: manage }, async (request, reply) => {
    const { id: estimateId } = request.params as { id: string }
    const estimate = store.estimates.find((candidate) => candidate.id === estimateId)
    if (!estimate) return reply.code(404).send({ error: "NOT_FOUND" })
    if (estimate.status !== "SENT") {
      return reply.code(409).send({ error: "NOT_SENT", status: estimate.status })
    }
    estimate.status = "DRAFT"
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

  /** Meta only, while OPEN — lines are the estimate's agreement and never reprice. */
  app.put("/sales-orders/:id", { preHandler: manage }, async (request, reply) => {
    const { id: soId } = request.params as { id: string }
    const metaSchema = z.object({
      customerRef: z.string().default(""),
      orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      terms: z.string().default(""),
    })
    const parsed = metaSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const so = store.salesOrders.find((candidate) => candidate.id === soId)
    if (!so) return reply.code(404).send({ error: "NOT_FOUND" })
    if (so.status !== "OPEN") return reply.code(409).send({ error: "NOT_OPEN", status: so.status })
    Object.assign(so, parsed.data)
    return { salesOrder: soSummary(so) }
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
    if (store.challans.some((challan) => challan.soId === so.id)) {
      return reply.code(409).send({ error: "ALREADY_DISPATCHED" })
    }
    so.status = "CANCELLED"
    return { salesOrder: soSummary(so) }
  })

  // ---- dispatch (delivery challans) ---------------------------------------
  const challanBodySchema = challanSchema.omit({ id: true, number: true, soId: true, recordedBy: true })

  app.post("/sales-orders/:id/challans", { preHandler: manage }, async (request, reply) => {
    const { id: soId } = request.params as { id: string }
    const parsed = challanBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const so = store.salesOrders.find((candidate) => candidate.id === soId)
    if (!so) return reply.code(404).send({ error: "NOT_FOUND" })
    if (so.status !== "OPEN") return reply.code(422).send({ error: "SO_NOT_OPEN", status: so.status })
    for (const line of parsed.data.lines) {
      if (!so.lines.some((soLine) => soLine.id === line.soLineId)) {
        return reply.code(400).send({ error: "LINE_NOT_ON_SO", soLineId: line.soLineId })
      }
    }

    store.seq.ch += 1
    const challan: Challan = {
      id: id(store, "ch"),
      number: formatDocNumber("CH", Number(parsed.data.dispatchDate.slice(0, 4)), store.seq.ch),
      soId: so.id,
      recordedBy: request.auth.userId,
      ...parsed.data,
    }
    store.challans.push(challan)
    return reply.code(201).send({
      challan,
      displayStatus: soDisplayStatus(so, store.challans),
      fulfilment: soFulfilment(so, store.challans),
    })
  })

  // ---- invoices -----------------------------------------------------------
  const invoiceSummary = (invoice: Invoice) => ({
    ...invoice,
    customerName:
      store.customers.find((candidate) => candidate.id === invoice.customerId)?.name ?? "—",
    totals: poTotals(invoice.lines),
    outstandingPaise: outstandingPaise(invoice, store.receipts),
  })

  app.get("/invoices", { preHandler: read }, async () => ({
    invoices: store.invoices.map(invoiceSummary),
  }))

  const invoiceBodySchema = z.object({
    soId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })

  /** Invoice a sales order — lines copy verbatim; billing never reprices. */
  app.post("/invoices", { preHandler: manage }, async (request, reply) => {
    const parsed = invoiceBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const so = store.salesOrders.find((candidate) => candidate.id === parsed.data.soId)
    if (!so) return reply.code(404).send({ error: "SO_NOT_FOUND" })

    store.seq.inv += 1
    const invoiceId = id(store, "inv")
    const invoice: Invoice = {
      id: invoiceId,
      number: formatDocNumber("INV", Number(parsed.data.date.slice(0, 4)), store.seq.inv),
      customerId: so.customerId,
      soId: so.id,
      date: parsed.data.date,
      dueDate: parsed.data.dueDate,
      status: "OPEN",
      lines: so.lines.map((line, index): PoLine => ({ ...line, id: `${invoiceId}_l${index}` })),
      terms: so.terms,
      createdBy: request.auth.userId,
    }
    store.invoices.push(invoice)
    return reply.code(201).send({ invoice: invoiceSummary(invoice) })
  })

  /** Dates only, while OPEN and before any receipt lands. */
  app.put("/invoices/:id", { preHandler: manage }, async (request, reply) => {
    const { id: invoiceId } = request.params as { id: string }
    const metaSchema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    const parsed = metaSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const invoice = store.invoices.find((candidate) => candidate.id === invoiceId)
    if (!invoice) return reply.code(404).send({ error: "NOT_FOUND" })
    if (invoice.status !== "OPEN") return reply.code(409).send({ error: "NOT_OPEN" })
    const allocated = store.receipts.some((receipt) =>
      receipt.allocations.some((allocation) => allocation.docId === invoiceId)
    )
    if (allocated) return reply.code(409).send({ error: "RECEIPTS_ALLOCATED" })
    Object.assign(invoice, parsed.data)
    return { invoice: invoiceSummary(invoice) }
  })

  /** Refused once any receipt is allocated — money history is never orphaned. */
  app.post("/invoices/:id/cancel", { preHandler: manage }, async (request, reply) => {
    const { id: invoiceId } = request.params as { id: string }
    const invoice = store.invoices.find((candidate) => candidate.id === invoiceId)
    if (!invoice) return reply.code(404).send({ error: "NOT_FOUND" })
    if (invoice.status !== "OPEN") return reply.code(409).send({ error: "NOT_OPEN" })
    const allocated = store.receipts.some((receipt) =>
      receipt.allocations.some((allocation) => allocation.docId === invoiceId)
    )
    if (allocated) return reply.code(409).send({ error: "RECEIPTS_ALLOCATED" })
    invoice.status = "CANCELLED"
    return { invoice: invoiceSummary(invoice) }
  })

  // ---- receipts (money in) ------------------------------------------------
  app.get("/receipts", { preHandler: read }, async () => ({ receipts: store.receipts }))

  const receiptBodySchema = paymentEntrySchema
    .omit({ id: true, recordedBy: true, allocations: true })
    .extend({
      /** Omit to auto-allocate oldest-due-first across open invoices. */
      allocations: paymentEntrySchema.shape.allocations.optional(),
    })

  app.post("/receipts", { preHandler: manage }, async (request, reply) => {
    const parsed = receiptBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const body = parsed.data

    // What this party actually owes, per open invoice. Every allocation is
    // measured against this — never against numbers the client sent.
    const openInvoices = store.invoices
      .filter((invoice) => invoice.customerId === body.partyId && invoice.status === "OPEN")
      .map((invoice) => ({
        id: invoice.id,
        dueDate: invoice.dueDate,
        outstandingPaise: outstandingPaise(invoice, store.receipts),
      }))
      .filter((invoice) => invoice.outstandingPaise > 0)

    const totalOutstanding = openInvoices.reduce(
      (sum, invoice) => sum + invoice.outstandingPaise,
      0
    )
    if (totalOutstanding === 0) {
      return reply.code(422).send({ error: "NOTHING_OUTSTANDING" })
    }
    if (body.amountPaise > totalOutstanding) {
      return reply.code(422).send({ error: "EXCEEDS_OUTSTANDING", maxPaise: totalOutstanding })
    }

    let allocations
    if (body.allocations) {
      // Manual allocation is a real need (a customer paying a specific bill),
      // but the figures are untrusted input. Validating them against the
      // ledger is what stops a crafted request from writing off a debt that
      // was never paid.
      for (const allocation of body.allocations) {
        const invoice = openInvoices.find((candidate) => candidate.id === allocation.docId)
        if (!invoice)
          return reply
            .code(422)
            .send({ error: "UNKNOWN_ALLOCATION", docId: allocation.docId })
        if (allocation.amountPaise <= 0)
          return reply.code(422).send({ error: "BAD_ALLOCATION", docId: allocation.docId })
        if (allocation.amountPaise > invoice.outstandingPaise)
          return reply.code(422).send({
            error: "ALLOCATION_EXCEEDS_INVOICE",
            docId: allocation.docId,
            maxPaise: invoice.outstandingPaise,
          })
      }
      const uniqueDocs = new Set(body.allocations.map((allocation) => allocation.docId))
      if (uniqueDocs.size !== body.allocations.length)
        return reply.code(422).send({ error: "DUPLICATE_ALLOCATION" })
      // The receipt must be fully accounted for: money that lands nowhere is
      // money the books cannot explain.
      const allocated = body.allocations.reduce(
        (sum, allocation) => sum + allocation.amountPaise,
        0
      )
      if (allocated !== body.amountPaise)
        return reply.code(422).send({
          error: "ALLOCATION_MISMATCH",
          detail: `Allocations total ${allocated} paise but the receipt is ${body.amountPaise}.`,
        })
      allocations = body.allocations
    } else {
      allocations = allocateOldestFirst(body.amountPaise, openInvoices)
    }

    if (allocations.length === 0) {
      return reply.code(422).send({ error: "NOTHING_OUTSTANDING" })
    }

    const receipt = {
      id: id(store, "rcpt"),
      recordedBy: request.auth.userId,
      ...body,
      allocations,
    }
    store.receipts.push(receipt)
    return reply.code(201).send({ receipt })
  })
}
