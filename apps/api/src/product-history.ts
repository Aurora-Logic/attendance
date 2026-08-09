import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import * as z from "zod"
import {
  netRatePaise,
  productHistory,
  type HistoryDoc,
  type Paise,
} from "@attendance/shared"

import type { Store } from "./store"

/**
 * "What did we charge them for this last time?"
 *
 * The question a person asks mid-quotation, which today they answer by opening
 * three screens or guessing. One request, and the answer must arrive before
 * they have given up on it — so the documents are indexed by item on the way
 * in rather than scanned per request.
 */

interface Guards {
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
  requirePermission: (
    key: string,
    options?: { write?: boolean }
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
}

const querySchema = z.object({
  itemId: z.string().min(1),
  partyId: z.string().min(1),
  /** sales: customers and their estimates/orders/invoices. purchase: vendors. */
  side: z.enum(["sales", "purchase"]).default("sales"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export function registerProductHistoryRoutes(app: FastifyInstance, store: Store, guards: Guards) {
  const { authenticate, requirePermission } = guards

  /**
   * Every document flattened once per request, keyed by item.
   *
   * The alternative — walking estimates, orders, invoices and POs for each
   * lookup — is O(documents x lines) on a popover that opens on every line of
   * every quotation. This is the index the work order asks for; when these
   * move to Postgres it becomes an index on (item_id, party_id, date).
   */
  const indexByItem = (): Map<string, HistoryDoc[]> => {
    const index = new Map<string, HistoryDoc[]>()
    const add = (doc: HistoryDoc) => {
      for (const itemId of new Set(doc.lines.map((line) => line.itemId))) {
        const bucket = index.get(itemId)
        if (bucket) bucket.push(doc)
        else index.set(itemId, [doc])
      }
    }

    for (const estimate of store.estimates) {
      add({
        id: estimate.id,
        number: estimate.number,
        kind: "ESTIMATE",
        partyId: estimate.customerId,
        date: estimate.date,
        cancelled: estimate.status === "REJECTED",
        lines: estimate.lines,
      })
    }
    for (const order of store.salesOrders) {
      add({
        id: order.id,
        number: order.number,
        kind: "SALES_ORDER",
        partyId: order.customerId,
        date: order.orderDate,
        cancelled: order.status === "CANCELLED",
        lines: order.lines,
      })
    }
    for (const invoice of store.invoices) {
      add({
        id: invoice.id,
        number: invoice.number,
        kind: "INVOICE",
        partyId: invoice.customerId,
        date: invoice.date,
        cancelled: invoice.status === "CANCELLED",
        lines: invoice.lines,
      })
    }
    for (const po of store.pos) {
      add({
        id: po.id,
        number: po.number,
        kind: "PURCHASE_ORDER",
        partyId: po.vendorId,
        date: po.orderDate,
        cancelled: po.status === "CANCELLED" || po.status === "REJECTED",
        lines: po.lines,
      })
    }
    return index
  }

  /**
   * What this item cost around a given date, from the purchase side.
   *
   * The latest purchase on or before the document's date, so margin is measured
   * against what we were actually paying then — not against today's cost, which
   * would rewrite the margin on every historical quote each time a price moves.
   */
  const costBasisFor = (itemId: string) => {
    const purchases = store.pos
      .filter((po) => po.status !== "CANCELLED" && po.status !== "REJECTED")
      .flatMap((po) =>
        po.lines
          .filter((line) => line.itemId === itemId)
          .map((line) => ({
            date: po.orderDate,
            rate: netRatePaise(line.unitPricePaise, line.discountPct),
          }))
      )
      .sort((a, b) => a.date.localeCompare(b.date))

    return (dateISO: string): Paise | null => {
      let cost: Paise | null = null
      for (const purchase of purchases) {
        if (purchase.date > dateISO) break
        cost = purchase.rate
      }
      // Nothing bought before that date: unknown, which is not the same as free.
      return cost
    }
  }

  app.get(
    "/product-history",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query)
      if (!parsed.success)
        return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const { itemId, partyId, side, limit } = parsed.data

      /**
       * Rates are commercial information, so the two sides are gated
       * separately: somebody who may see purchase prices has no business
       * reading what a customer was quoted.
       */
      const capability = side === "purchase" ? "procurement.view" : "sales.view"
      const scope = store.matrix[capability]?.[request.auth.role] ?? "NONE"
      if (scope === "NONE")
        return reply.code(403).send({ error: "FORBIDDEN", permission: capability })

      const docs = indexByItem().get(itemId) ?? []
      const relevant =
        side === "purchase"
          ? docs.filter((doc) => doc.kind === "PURCHASE_ORDER")
          : docs.filter((doc) => doc.kind !== "PURCHASE_ORDER")

      const history = productHistory({
        itemId,
        partyId,
        docs: relevant,
        costAt: side === "purchase" ? undefined : costBasisFor(itemId),
        asOfISO: new Date().toISOString().slice(0, 10),
        limit,
      })

      const item = store.items.find((candidate) => candidate.id === itemId)
      return { ...history, itemName: item?.name ?? itemId, side }
    }
  )

  // `requirePermission` is unused here on purpose: the capability depends on
  // `side`, which is only known once the query is parsed.
  void requirePermission
}
