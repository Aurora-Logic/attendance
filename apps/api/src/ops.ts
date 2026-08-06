import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import * as z from "zod"
import {
  allocateOldestFirst,
  expenseClaimSchema,
  formatDocNumber,
  indentSchema,
  outstandingPaise,
  paymentEntrySchema,
  poTotals,
  stockAdjustmentSchema,
  stockMovements,
  stockPositions,
  threeWayMatch,
  vendorBillSchema,
  type ExpenseClaim,
  type Indent,
  type VendorBill,
} from "@attendance/shared"

import { id, type Store } from "./store"

/**
 * The operational chain around procurement and people: vendor bills with
 * three-way match, vendor payments, purchase indents, expense claims, and the
 * stock projection. Same doctrine throughout — append-only records, derived
 * balances, flags over blocks.
 */

interface Guards {
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  requirePermission: (
    key: string,
    options?: { write?: boolean }
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
}

export function registerOpsRoutes(app: FastifyInstance, store: Store, guards: Guards) {
  const { authenticate, requirePermission } = guards
  const procRead = [authenticate, requirePermission("procurement.view")]
  const procManage = [authenticate, requirePermission("procurement.manage", { write: true })]

  // ---- vendor bills + three-way match -------------------------------------
  const billSummary = (bill: VendorBill) => {
    const po = bill.poId ? store.pos.find((candidate) => candidate.id === bill.poId) : undefined
    return {
      ...bill,
      vendorName: store.vendors.find((candidate) => candidate.id === bill.vendorId)?.name ?? "—",
      totals: poTotals(bill.lines),
      outstandingPaise: outstandingPaise(bill, store.payments),
      match: po ? threeWayMatch(bill, po, store.grns) : null,
    }
  }

  app.get("/vendor-bills", { preHandler: procRead }, async () => ({
    bills: store.vendorBills.map(billSummary),
  }))

  const billBodySchema = vendorBillSchema.omit({ id: true, status: true, recordedBy: true })

  app.post("/vendor-bills", { preHandler: procManage }, async (request, reply) => {
    const parsed = billBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const vendor = store.vendors.find((candidate) => candidate.id === parsed.data.vendorId)
    if (!vendor) return reply.code(404).send({ error: "VENDOR_NOT_FOUND" })
    const bill: VendorBill = {
      id: id(store, "vb"),
      status: "OPEN",
      recordedBy: request.auth.userId,
      ...parsed.data,
    }
    store.vendorBills.push(bill)
    // Mismatches are flags in the response, never blocks (§3 doctrine).
    return reply.code(201).send({ bill: billSummary(bill) })
  })

  /** Refused once any payment is allocated — money history is never orphaned. */
  app.post("/vendor-bills/:id/cancel", { preHandler: procManage }, async (request, reply) => {
    const { id: billId } = request.params as { id: string }
    const bill = store.vendorBills.find((candidate) => candidate.id === billId)
    if (!bill) return reply.code(404).send({ error: "NOT_FOUND" })
    if (bill.status !== "OPEN") return reply.code(409).send({ error: "NOT_OPEN" })
    const allocated = store.payments.some((payment) =>
      payment.allocations.some((allocation) => allocation.docId === billId)
    )
    if (allocated) return reply.code(409).send({ error: "PAYMENTS_ALLOCATED" })
    bill.status = "CANCELLED"
    return { bill: billSummary(bill) }
  })

  // ---- vendor payments (money out) ----------------------------------------
  app.get("/payments", { preHandler: procRead }, async () => ({ payments: store.payments }))

  const paymentBodySchema = paymentEntrySchema
    .omit({ id: true, recordedBy: true, allocations: true })
    .extend({ allocations: paymentEntrySchema.shape.allocations.optional() })

  app.post("/payments", { preHandler: procManage }, async (request, reply) => {
    const parsed = paymentBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const body = parsed.data
    const allocations =
      body.allocations ??
      allocateOldestFirst(
        body.amountPaise,
        store.vendorBills
          .filter((bill) => bill.vendorId === body.partyId && bill.status === "OPEN")
          .map((bill) => ({
            id: bill.id,
            dueDate: bill.dueDate,
            outstandingPaise: outstandingPaise(bill, store.payments),
          }))
      )
    if (allocations.length === 0) return reply.code(422).send({ error: "NOTHING_OUTSTANDING" })
    // Excess money must never vanish into unallocated air — refuse with the max.
    const allocatable = allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0)
    if (body.amountPaise > allocatable) {
      return reply.code(422).send({ error: "EXCEEDS_OUTSTANDING", maxPaise: allocatable })
    }
    const payment = { id: id(store, "pay"), recordedBy: request.auth.userId, ...body, allocations }
    store.payments.push(payment)
    return reply.code(201).send({ payment })
  })

  // ---- indents ------------------------------------------------------------
  app.get("/indents", { preHandler: procRead }, async () => ({ indents: store.indents }))

  const indentBodySchema = indentSchema.omit({
    id: true,
    number: true,
    status: true,
    decisionNote: true,
    poId: true,
  })

  app.post("/indents", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = indentBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    store.seq.ind += 1
    const indent: Indent = {
      id: id(store, "ind"),
      number: formatDocNumber("IND", Number(parsed.data.date.slice(0, 4)), store.seq.ind),
      status: "PENDING",
      decisionNote: "",
      poId: null,
      ...parsed.data,
      requestedBy: request.auth.userId,
    }
    store.indents.push(indent)
    return reply.code(201).send({ indent })
  })

  const indentDecideSchema = z.object({
    action: z.enum(["APPROVE", "REJECT"]),
    note: z.string().default(""),
  })

  app.post("/indents/:id/decide", { preHandler: procManage }, async (request, reply) => {
    const { id: indentId } = request.params as { id: string }
    const parsed = indentDecideSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
    const indent = store.indents.find((candidate) => candidate.id === indentId)
    if (!indent) return reply.code(404).send({ error: "NOT_FOUND" })
    if (indent.status !== "PENDING") return reply.code(409).send({ error: "ALREADY_DECIDED" })
    indent.status = parsed.data.action === "APPROVE" ? "APPROVED" : "REJECTED"
    indent.decisionNote = parsed.data.note
    return { indent }
  })

  /** Stamped when the PO raised from this indent is created. */
  app.post("/indents/:id/mark-ordered", { preHandler: procManage }, async (request, reply) => {
    const { id: indentId } = request.params as { id: string }
    const { poId } = (request.body ?? {}) as { poId?: string }
    const indent = store.indents.find((candidate) => candidate.id === indentId)
    if (!indent) return reply.code(404).send({ error: "NOT_FOUND" })
    if (indent.status !== "APPROVED") return reply.code(409).send({ error: "NOT_APPROVED" })
    indent.status = "ORDERED"
    indent.poId = poId ?? null
    return { indent }
  })

  // ---- stock --------------------------------------------------------------
  app.get("/stock", { preHandler: procRead }, async () => {
    const movements = stockMovements(
      store.pos,
      store.grns,
      store.salesOrders,
      store.challans,
      store.stockAdjustments
    )
    return { positions: stockPositions(store.items, movements), movements }
  })

  const adjustmentBodySchema = stockAdjustmentSchema.omit({ id: true, recordedBy: true })

  app.post("/stock/adjustments", { preHandler: procManage }, async (request, reply) => {
    const parsed = adjustmentBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const adjustment = { id: id(store, "adj"), recordedBy: request.auth.userId, ...parsed.data }
    store.stockAdjustments.push(adjustment)
    return reply.code(201).send({ adjustment })
  })

  // ---- expense claims -----------------------------------------------------
  app.get("/expense-claims", { preHandler: [authenticate] }, async (request) => {
    const scope = store.matrix["expense.approve"]?.[request.auth.role] ?? "NONE"
    const user = store.users.find((candidate) => candidate.id === request.auth.userId)
    const mine = (claim: ExpenseClaim) => claim.employeeEmail === user?.email
    // Approvers see all; everyone always sees their own claims.
    const claims =
      scope === "ALL" ? store.expenseClaims : store.expenseClaims.filter(mine)
    return { claims }
  })

  const claimBodySchema = expenseClaimSchema.omit({
    id: true,
    number: true,
    status: true,
    decidedBy: true,
    decisionNote: true,
    reimbursedOn: true,
    employeeEmail: true,
    employeeName: true,
  })

  app.post(
    "/expense-claims",
    { preHandler: [authenticate, requirePermission("expense.claim", { write: true })] },
    async (request, reply) => {
      const parsed = claimBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const user = store.users.find((candidate) => candidate.id === request.auth.userId)
      store.seq.exp += 1
      const claim: ExpenseClaim = {
        id: id(store, "exp"),
        number: formatDocNumber("EXP", Number(parsed.data.date.slice(0, 4)), store.seq.exp),
        status: "PENDING",
        decidedBy: "",
        decisionNote: "",
        reimbursedOn: null,
        employeeEmail: user?.email ?? "",
        employeeName: user?.name ?? "",
        ...parsed.data,
      }
      store.expenseClaims.push(claim)
      return reply.code(201).send({ claim })
    }
  )

  const claimDecideSchema = z.object({
    action: z.enum(["APPROVE", "REJECT"]),
    note: z.string().default(""),
  })

  app.post(
    "/expense-claims/:id/decide",
    { preHandler: [authenticate, requirePermission("expense.approve", { write: true })] },
    async (request, reply) => {
      const { id: claimId } = request.params as { id: string }
      const parsed = claimDecideSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      const claim = store.expenseClaims.find((candidate) => candidate.id === claimId)
      if (!claim) return reply.code(404).send({ error: "NOT_FOUND" })
      if (claim.status !== "PENDING") return reply.code(409).send({ error: "ALREADY_DECIDED" })
      const user = store.users.find((candidate) => candidate.id === request.auth.userId)
      // Approving your own claim is never allowed, whatever the scope.
      if (claim.employeeEmail === user?.email) {
        return reply.code(403).send({ error: "CANNOT_DECIDE_OWN" })
      }
      claim.status = parsed.data.action === "APPROVE" ? "APPROVED" : "REJECTED"
      claim.decidedBy = request.auth.userId
      claim.decisionNote = parsed.data.note
      return { claim }
    }
  )

  app.post(
    "/expense-claims/:id/reimburse",
    { preHandler: [authenticate, requirePermission("expense.approve", { write: true })] },
    async (request, reply) => {
      const { id: claimId } = request.params as { id: string }
      const claim = store.expenseClaims.find((candidate) => candidate.id === claimId)
      if (!claim) return reply.code(404).send({ error: "NOT_FOUND" })
      if (claim.status !== "APPROVED") return reply.code(409).send({ error: "NOT_APPROVED" })
      claim.status = "REIMBURSED"
      claim.reimbursedOn = new Date().toISOString().slice(0, 10)
      return { claim }
    }
  )
}
