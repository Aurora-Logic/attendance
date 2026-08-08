import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import * as z from "zod"
import {
  allocateOldestFirst,
  expenseClaimSchema,
  formatDocNumber,
  indentSchema,
  isoDateSchema,
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

  /** Meta only, while OPEN and before any payment lands. */
  app.put("/vendor-bills/:id", { preHandler: procManage }, async (request, reply) => {
    const { id: billId } = request.params as { id: string }
    const metaSchema = z.object({
      billNo: z.string().min(1),
      date: isoDateSchema,
      dueDate: isoDateSchema,
    })
    const parsed = metaSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const bill = store.vendorBills.find((candidate) => candidate.id === billId)
    if (!bill) return reply.code(404).send({ error: "NOT_FOUND" })
    if (bill.status !== "OPEN") return reply.code(409).send({ error: "NOT_OPEN" })
    const allocated = store.payments.some((payment) =>
      payment.allocations.some((allocation) => allocation.docId === billId)
    )
    if (allocated) return reply.code(409).send({ error: "PAYMENTS_ALLOCATED" })
    Object.assign(bill, parsed.data)
    return { bill: billSummary(bill) }
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

  /** PENDING only — the requester (or procurement) can still reshape the ask. */
  app.put("/indents/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const { id: indentId } = request.params as { id: string }
    const patchSchema = z.object({
      department: z.string().min(1),
      lines: indentSchema.shape.lines,
    })
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
    const indent = store.indents.find((candidate) => candidate.id === indentId)
    if (!indent) return reply.code(404).send({ error: "NOT_FOUND" })
    if (indent.status !== "PENDING") return reply.code(409).send({ error: "ALREADY_DECIDED" })
    const scope = store.matrix["procurement.manage"]?.[request.auth.role] ?? "NONE"
    if (indent.requestedBy !== request.auth.userId && (scope === "NONE" || scope === "VIEW")) {
      return reply.code(403).send({ error: "NOT_YOURS" })
    }
    Object.assign(indent, parsed.data)
    return { indent }
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
    // This was the one write path with no schema at all: the body was cast,
    // so any shape passed and a typo'd poId linked an indent to nothing.
    const parsed = z
      .object({ poId: z.string().min(1).nullable().default(null) })
      .safeParse(request.body ?? {})
    if (!parsed.success)
      return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })

    const indent = store.indents.find((candidate) => candidate.id === indentId)
    if (!indent) return reply.code(404).send({ error: "NOT_FOUND" })
    if (indent.status !== "APPROVED") return reply.code(409).send({ error: "NOT_APPROVED" })

    const { poId } = parsed.data
    // A reference to a purchase order that does not exist is worse than none:
    // the indent reads as fulfilled and points nowhere.
    if (poId && !store.pos.some((po) => po.id === poId))
      return reply.code(422).send({ error: "PO_NOT_FOUND", poId })

    indent.status = "ORDERED"
    indent.poId = poId
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
  const employeeOfUser = (userId: string) => {
    const user = store.users.find((candidate) => candidate.id === userId)
    return store.employees.find((candidate) => candidate.id === user?.employeeId)
  }
  const employeeOfEmail = (email: string) => {
    const user = store.users.find((candidate) => candidate.email === email)
    return store.employees.find((candidate) => candidate.id === user?.employeeId)
  }
  /** True when `email`'s employee sits anywhere under `managerId`'s chain. */
  const inTeamOf = (managerId: string | undefined, email: string): boolean => {
    if (!managerId) return false
    let current = employeeOfEmail(email)
    for (let hops = 0; current && hops < 10; hops++) {
      if (current.managerId === managerId) return true
      current = store.employees.find((candidate) => candidate.id === current?.managerId)
    }
    return false
  }
  /** ALL reaches everyone; OWN_TEAM reaches the reporting chain; nothing else decides. */
  const approverReaches = (
    userId: string,
    role: "ADMIN" | "HR" | "OPERATIONS" | "EMPLOYEE",
    claimantEmail: string
  ): boolean => {
    const scope = store.matrix["expense.approve"]?.[role] ?? "NONE"
    if (scope === "ALL") return true
    if (scope === "OWN_TEAM") return inTeamOf(employeeOfUser(userId)?.id, claimantEmail)
    return false
  }
  app.get("/expense-claims", { preHandler: [authenticate] }, async (request) => {
    const scope = store.matrix["expense.approve"]?.[request.auth.role] ?? "NONE"
    const user = store.users.find((candidate) => candidate.id === request.auth.userId)
    const mine = (claim: ExpenseClaim) => claim.employeeEmail === user?.email
    // ALL sees everything; OWN_TEAM sees own + the reporting chain; else own.
    const claims =
      scope === "ALL"
        ? store.expenseClaims
        : scope === "OWN_TEAM"
          ? store.expenseClaims.filter(
              (claim) =>
                mine(claim) ||
                inTeamOf(employeeOfUser(request.auth.userId)?.id, claim.employeeEmail)
            )
          : store.expenseClaims.filter(mine)
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

  /** Own PENDING claims only — a decided claim is history. */
  app.put(
    "/expense-claims/:id",
    { preHandler: [authenticate, requirePermission("expense.claim", { write: true })] },
    async (request, reply) => {
      const { id: claimId } = request.params as { id: string }
      const patchSchema = expenseClaimSchema.pick({
        category: true,
        amountPaise: true,
        description: true,
      })
      const parsed = patchSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const claim = store.expenseClaims.find((candidate) => candidate.id === claimId)
      if (!claim) return reply.code(404).send({ error: "NOT_FOUND" })
      if (claim.status !== "PENDING") return reply.code(409).send({ error: "ALREADY_DECIDED" })
      const user = store.users.find((candidate) => candidate.id === request.auth.userId)
      if (claim.employeeEmail !== user?.email) return reply.code(403).send({ error: "NOT_YOURS" })
      Object.assign(claim, parsed.data)
      return { claim }
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
      // The grant's REACH is enforced, not just its existence: OWN_TEAM only
      // decides for the reporting chain — the hole the audit found.
      if (!approverReaches(request.auth.userId, request.auth.role, claim.employeeEmail)) {
        return reply.code(403).send({ error: "OUT_OF_REACH", scope: "OWN_TEAM" })
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
      if (!approverReaches(request.auth.userId, request.auth.role, claim.employeeEmail)) {
        return reply.code(403).send({ error: "OUT_OF_REACH", scope: "OWN_TEAM" })
      }
      claim.status = "REIMBURSED"
      claim.reimbursedOn = new Date().toISOString().slice(0, 10)
      return { claim }
    }
  )
}
