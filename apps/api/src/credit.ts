import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  creditDecision,
  customerExposure,
  outstandingPaise,
  overdueList,
  type CreditTerms,
  type OpenDoc,
} from "@attendance/shared"

import type { Store } from "./store"

/**
 * Who owes what, and whether the next order should go out.
 *
 * Detection only. The owner has not decided who gets told or how, so nothing
 * in this file sends anything — it produces the list somebody works through
 * and the verdict a counter reads.
 */

interface Guards {
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  requirePermission: (
    key: string,
    options?: { write?: boolean }
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
}

export function registerCreditRoutes(app: FastifyInstance, store: Store, guards: Guards) {
  const { authenticate, requirePermission } = guards
  const canView = [authenticate, requirePermission("sales.view")]

  const today = () => new Date().toISOString().slice(0, 10)

  /** Every unpaid invoice, in the shape the credit rules read. */
  const openDocs = (): OpenDoc[] =>
    store.invoices
      .filter((invoice) => invoice.status !== "CANCELLED")
      .map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        customerId: invoice.customerId,
        dueDate: invoice.dueDate,
        outstandingPaise: outstandingPaise(invoice, store.receipts),
      }))
      .filter((doc) => doc.outstandingPaise > 0)

  /**
   * A customer's own terms where they have them, the company default where
   * they do not. The customer master carries a payment period but no limit, so
   * the limit comes from settings until per-customer limits are entered.
   */
  const termsFor = (customerId: string): CreditTerms => {
    const defaults = store.operations.credit.defaultTerms
    const customer = store.customers.find((row) => row.id === customerId)
    return {
      ...defaults,
      creditDays: customer?.paymentTermsDays ?? defaults.creditDays,
    }
  }

  app.get("/credit/overdue", { preHandler: canView }, async () => {
    const docs = openDocs()
    const rows = overdueList({
      docs,
      customers: store.customers.map((customer) => ({ id: customer.id, name: customer.name })),
      todayISO: today(),
      minimumPaise: store.operations.credit.chaseMinimumPaise,
    })

    return {
      rows,
      asOf: today(),
      totalOverduePaise: rows.reduce((sum, row) => sum + row.overduePaise, 0),
      /**
       * What the company has decided to do about it — surfaced with the list so
       * a screen never has to guess whether this is advice or a gate.
       */
      holdOrdersOnBreach: store.operations.credit.holdOrdersOnBreach,
      chaseMinimumPaise: store.operations.credit.chaseMinimumPaise,
    }
  })

  app.get("/credit/customers/:id", { preHandler: canView }, async (request, reply) => {
    const customerId = (request.params as { id: string }).id
    if (!store.customers.some((customer) => customer.id === customerId))
      return reply.code(404).send({ error: "NOT_FOUND" })

    const terms = termsFor(customerId)
    const exposure = customerExposure({ customerId, docs: openDocs(), todayISO: today() })
    const orderValue = Number((request.query as { orderValuePaise?: string }).orderValuePaise ?? 0)

    return {
      exposure,
      terms,
      decision: creditDecision({
        exposure,
        terms,
        orderValuePaise: Number.isFinite(orderValue) ? orderValue : 0,
      }),
    }
  })
}
