import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import * as z from "zod"
import {
  formatDocNumber,
  grnLineSchema,
  itemSchema,
  monthlySpend,
  poDisplayStatus,
  poTotals,
  receiptProgress,
  scheduleProgress,
  vendorPerformance,
  vendorSchema,
  type Grn,
  type PoLine,
  type PoSchedule,
  type PurchaseOrder,
} from "@attendance/shared"

import { id, type Store } from "./store"

/**
 * Procurement routes: vendor/item masters, purchase orders with delivery
 * schedules, goods receipts and vendor analytics. Same shape as the attendance
 * routes in server.ts — thin handlers over the pure functions in
 * `@attendance/shared`, so the web preview and these responses cannot drift.
 *
 * GRNs are append-only (A1's rule applied to material): a wrong receipt is
 * corrected by a new GRN with negative-free quantities and a remark, never by
 * an UPDATE. Over-receipt is flagged in the response, not blocked — the truck
 * at the gate is a fact; whether to accept it is an approval question.
 */

interface Guards {
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  requirePermission: (
    key: string,
    options?: { write?: boolean }
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
}

const vendorBodySchema = vendorSchema.omit({ id: true })
const itemBodySchema = itemSchema.omit({ id: true })

const poLineBodySchema = z.object({
  itemId: z.string(),
  qty: z.number().positive(),
  /** Defaults to the item's last agreed price. */
  unitPricePaise: z.number().int().nonnegative().optional(),
  discountPct: z.number().min(0).max(100).default(0),
})

const poBodySchema = z.object({
  vendorId: z.string(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lines: z.array(poLineBodySchema).min(1),
  /** Tranches reference lines by index because line ids are assigned here. */
  schedules: z
    .array(
      z.object({
        lineIndex: z.number().int().nonnegative(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        qty: z.number().positive(),
      })
    )
    .default([]),
  terms: z.string().default(""),
  notes: z.string().default(""),
})

const decideSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().default(""),
})

const grnBodySchema = z.object({
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invoiceNo: z.string().default(""),
  remarks: z.string().default(""),
  lines: z.array(grnLineSchema).min(1),
})

export function registerProcurementRoutes(app: FastifyInstance, store: Store, guards: Guards) {
  const { authenticate, requirePermission } = guards

  const read = [authenticate, requirePermission("procurement.view")]
  const manage = [authenticate, requirePermission("procurement.manage", { write: true })]

  const today = () => new Date().toISOString().slice(0, 10)

  const poSummary = (po: PurchaseOrder) => {
    const vendor = store.vendors.find((candidate) => candidate.id === po.vendorId)
    const progress = receiptProgress(po, store.grns)
    const orderedQty = progress.reduce((sum, line) => sum + line.orderedQty, 0)
    const acceptedQty = progress.reduce((sum, line) => sum + Math.min(line.acceptedQty, line.orderedQty), 0)
    return {
      ...po,
      vendorName: vendor?.name ?? "—",
      displayStatus: poDisplayStatus(po, store.grns),
      totals: poTotals(po.lines),
      receiptPct: orderedQty ? Math.round((acceptedQty / orderedQty) * 100) : 0,
    }
  }

  // ---- vendors ------------------------------------------------------------
  app.get("/vendors", { preHandler: read }, async () => ({ vendors: store.vendors }))

  app.post("/vendors", { preHandler: manage }, async (request, reply) => {
    const parsed = vendorBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    if (store.vendors.some((vendor) => vendor.code === parsed.data.code)) {
      return reply.code(409).send({ error: "DUPLICATE_CODE" })
    }
    const vendor = { id: id(store, "v"), ...parsed.data }
    store.vendors.push(vendor)
    return reply.code(201).send({ vendor })
  })

  app.put("/vendors/:id", { preHandler: manage }, async (request, reply) => {
    const { id: vendorId } = request.params as { id: string }
    const vendor = store.vendors.find((candidate) => candidate.id === vendorId)
    if (!vendor) return reply.code(404).send({ error: "NOT_FOUND" })
    const parsed = vendorBodySchema.partial().safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    Object.assign(vendor, parsed.data)
    return { vendor }
  })

  // ---- items --------------------------------------------------------------
  app.get("/items", { preHandler: read }, async () => ({
    items: store.items,
    brands: store.brands,
    categories: store.categories,
  }))

  // A brand/category first seen on an item joins its master list.
  const registerMasters = (item: { brand: string; category: string }) => {
    if (item.brand.trim() && !store.brands.includes(item.brand.trim())) {
      store.brands.push(item.brand.trim())
    }
    if (item.category.trim() && !store.categories.includes(item.category.trim())) {
      store.categories.push(item.category.trim())
    }
  }

  app.post("/items", { preHandler: manage }, async (request, reply) => {
    const parsed = itemBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    if (store.items.some((item) => item.code === parsed.data.code)) {
      return reply.code(409).send({ error: "DUPLICATE_CODE" })
    }
    const item = { id: id(store, "i"), ...parsed.data }
    store.items.push(item)
    registerMasters(item)
    return reply.code(201).send({ item })
  })

  app.put("/items/:id", { preHandler: manage }, async (request, reply) => {
    const { id: itemId } = request.params as { id: string }
    const item = store.items.find((candidate) => candidate.id === itemId)
    if (!item) return reply.code(404).send({ error: "NOT_FOUND" })
    const parsed = itemBodySchema.partial().safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    Object.assign(item, parsed.data)
    registerMasters(item)
    return { item }
  })

  // ---- purchase orders ----------------------------------------------------
  app.get("/pos", { preHandler: read }, async () => ({ pos: store.pos.map(poSummary) }))

  app.get("/pos/:id", { preHandler: read }, async (request, reply) => {
    const { id: poId } = request.params as { id: string }
    const po = store.pos.find((candidate) => candidate.id === poId)
    if (!po) return reply.code(404).send({ error: "NOT_FOUND" })
    return {
      po: poSummary(po),
      grns: store.grns.filter((grn) => grn.poId === po.id),
      receiptProgress: receiptProgress(po, store.grns),
      scheduleProgress: scheduleProgress(po, store.grns, today()),
    }
  })

  app.post("/pos", { preHandler: manage }, async (request, reply) => {
    const parsed = poBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const body = parsed.data

    const vendor = store.vendors.find((candidate) => candidate.id === body.vendorId)
    if (!vendor) return reply.code(404).send({ error: "VENDOR_NOT_FOUND" })
    if (!vendor.active) return reply.code(422).send({ error: "VENDOR_INACTIVE" })

    const lines: PoLine[] = []
    for (const lineBody of body.lines) {
      const item = store.items.find((candidate) => candidate.id === lineBody.itemId)
      if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND", itemId: lineBody.itemId })
      lines.push({
        id: id(store, "pol"),
        itemId: item.id,
        qty: lineBody.qty,
        unitPricePaise: lineBody.unitPricePaise ?? item.lastPricePaise,
        // Copied at order time — a later slab change must not reprice history.
        gstRatePct: item.gstRatePct,
        discountPct: lineBody.discountPct,
      })
    }

    const schedules: PoSchedule[] = []
    for (const tranche of body.schedules) {
      const line = lines[tranche.lineIndex]
      if (!line) return reply.code(400).send({ error: "SCHEDULE_LINE_INDEX_INVALID" })
      schedules.push({ id: id(store, "sch"), poLineId: line.id, dueDate: tranche.dueDate, qty: tranche.qty })
    }

    store.seq.po += 1
    const po: PurchaseOrder = {
      id: id(store, "po"),
      number: formatDocNumber("PO", Number(body.orderDate.slice(0, 4)), store.seq.po),
      vendorId: vendor.id,
      orderDate: body.orderDate,
      status: "DRAFT",
      lines,
      schedules,
      terms: body.terms,
      notes: body.notes,
      createdBy: request.auth.userId,
      approvedBy: null,
      rejectionReason: null,
    }
    store.pos.push(po)
    return reply.code(201).send({ po: poSummary(po) })
  })

  app.post("/pos/:id/submit", { preHandler: manage }, async (request, reply) => {
    const { id: poId } = request.params as { id: string }
    const po = store.pos.find((candidate) => candidate.id === poId)
    if (!po) return reply.code(404).send({ error: "NOT_FOUND" })
    if (po.status !== "DRAFT") return reply.code(409).send({ error: "NOT_DRAFT", status: po.status })
    po.status = "PENDING_APPROVAL"
    return { po: poSummary(po) }
  })

  app.post(
    "/pos/:id/decide",
    { preHandler: [authenticate, requirePermission("po.approve", { write: true })] },
    async (request, reply) => {
      const { id: poId } = request.params as { id: string }
      const parsed = decideSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      const po = store.pos.find((candidate) => candidate.id === poId)
      if (!po) return reply.code(404).send({ error: "NOT_FOUND" })
      if (po.status !== "PENDING_APPROVAL") {
        return reply.code(409).send({ error: "NOT_PENDING", status: po.status })
      }
      // Raising and approving the same PO is never one person's job.
      if (po.createdBy === request.auth.userId) {
        return reply.code(403).send({ error: "CANNOT_DECIDE_OWN" })
      }

      if (parsed.data.action === "APPROVE") {
        po.status = "APPROVED"
        po.approvedBy = request.auth.userId
        // The agreed price becomes the item's default for the next PO.
        for (const line of po.lines) {
          const item = store.items.find((candidate) => candidate.id === line.itemId)
          if (item) item.lastPricePaise = line.unitPricePaise
        }
      } else {
        po.status = "REJECTED"
        po.rejectionReason = parsed.data.reason
      }
      return { po: poSummary(po) }
    }
  )

  app.post("/pos/:id/cancel", { preHandler: manage }, async (request, reply) => {
    const { id: poId } = request.params as { id: string }
    const po = store.pos.find((candidate) => candidate.id === poId)
    if (!po) return reply.code(404).send({ error: "NOT_FOUND" })
    if (po.status !== "DRAFT" && po.status !== "PENDING_APPROVAL") {
      return reply.code(409).send({ error: "NOT_CANCELLABLE", status: po.status })
    }
    po.status = "CANCELLED"
    return { po: poSummary(po) }
  })

  /** Short-close: stop expecting the balance without pretending it arrived. */
  app.post("/pos/:id/close", { preHandler: manage }, async (request, reply) => {
    const { id: poId } = request.params as { id: string }
    const po = store.pos.find((candidate) => candidate.id === poId)
    if (!po) return reply.code(404).send({ error: "NOT_FOUND" })
    if (po.status !== "APPROVED") return reply.code(409).send({ error: "NOT_APPROVED", status: po.status })
    po.status = "CLOSED"
    return { po: poSummary(po) }
  })

  // ---- goods receipts -----------------------------------------------------
  app.post(
    "/pos/:id/grns",
    { preHandler: [authenticate, requirePermission("grn.record", { write: true })] },
    async (request, reply) => {
      const { id: poId } = request.params as { id: string }
      const parsed = grnBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const po = store.pos.find((candidate) => candidate.id === poId)
      if (!po) return reply.code(404).send({ error: "NOT_FOUND" })
      if (po.status !== "APPROVED") {
        return reply.code(422).send({ error: "PO_NOT_APPROVED", status: po.status })
      }
      for (const line of parsed.data.lines) {
        if (!po.lines.some((poLine) => poLine.id === line.poLineId)) {
          return reply.code(400).send({ error: "LINE_NOT_ON_PO", poLineId: line.poLineId })
        }
      }

      store.seq.grn += 1
      const grn: Grn = {
        id: id(store, "grn"),
        number: formatDocNumber("GRN", Number(parsed.data.receivedDate.slice(0, 4)), store.seq.grn),
        poId: po.id,
        receivedDate: parsed.data.receivedDate,
        invoiceNo: parsed.data.invoiceNo,
        remarks: parsed.data.remarks,
        recordedBy: request.auth.userId,
        lines: parsed.data.lines,
      }
      store.grns.push(grn)

      const progress = receiptProgress(po, store.grns)
      const overReceived = progress.filter((line) => line.overReceivedQty > 0)
      return reply.code(201).send({
        grn,
        displayStatus: poDisplayStatus(po, store.grns),
        receiptProgress: progress,
        // Flagged, never blocked — same principle as §3's punch windows.
        overReceived,
      })
    }
  )

  // ---- analytics ----------------------------------------------------------
  app.get("/procurement/analytics", { preHandler: read }, async () => {
    const todayISO = today()
    const vendors = store.vendors.map((vendor) => ({
      ...vendorPerformance(vendor.id, store.pos, store.grns, todayISO),
      vendorName: vendor.name,
      vendorCode: vendor.code,
    }))
    const overdue = store.pos
      .filter((po) => po.status === "APPROVED")
      .flatMap((po) =>
        scheduleProgress(po, store.grns, todayISO)
          .filter((tranche) => tranche.status === "OVERDUE")
          .map((tranche) => ({
            poId: po.id,
            poNumber: po.number,
            vendorId: po.vendorId,
            dueDate: tranche.schedule.dueDate,
            qty: tranche.schedule.qty,
            allocatedQty: tranche.allocatedQty,
          }))
      )
    return { vendors, monthlySpend: monthlySpend(store.pos), overdueTranches: overdue }
  })
}
