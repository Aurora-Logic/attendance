import type { Paise } from "./money"

/**
 * What this product has done with this party before.
 *
 * Quoting from memory is how a customer gets a worse price than last time and
 * notices, or a better one than we can afford and we do not. The point of this
 * is one keystroke: see the last rate, see the floor, apply it.
 *
 * Pure on purpose — the arithmetic here decides what somebody charges, so it is
 * testable without a database or a browser.
 */

export const HISTORY_DOC_KINDS = [
  "ESTIMATE",
  "SALES_ORDER",
  "INVOICE",
  "PURCHASE_ORDER",
] as const
export type HistoryDocKind = (typeof HISTORY_DOC_KINDS)[number]

export const HISTORY_DOC_LABEL: Record<HistoryDocKind, string> = {
  ESTIMATE: "Estimate",
  SALES_ORDER: "Order",
  INVOICE: "Invoice",
  PURCHASE_ORDER: "Purchase order",
}

/** A document reduced to what history needs. */
export interface HistoryDoc {
  id: string
  number: string
  kind: HistoryDocKind
  /** Customer for a sales document, vendor for a purchase one. */
  partyId: string
  date: string
  /** Cancelled documents are excluded: a price nobody honoured is not history. */
  cancelled?: boolean
  lines: Array<{
    itemId: string
    qty: number
    unitPricePaise: Paise
    discountPct: number
  }>
}

export interface ProductHistoryRow {
  docId: string
  docNumber: string
  kind: HistoryDocKind
  date: string
  qty: number
  /** Before discount — what was on the price list that day. */
  listRatePaise: Paise
  discountPct: number
  /** After discount — what was actually charged. */
  netRatePaise: Paise
  /** Cost at that time, when known. Null rather than 0: unknown is not free. */
  costBasisPaise: Paise | null
  /** Margin on the net rate, to one decimal. Null when cost is unknown. */
  marginPct: number | null
}

export interface ProductHistorySummary {
  /** Net rate on the most recent document. */
  lastRatePaise: Paise | null
  /**
   * The keenest net rate ever recorded — the lowest. On a sales document that
   * is the best the customer has been given; on a purchase, the best we bought
   * at. Either way it is the floor somebody will be asked to match.
   */
  bestRatePaise: Paise | null
  /** Quantity-weighted, not a mean of rates: ten units at 100 and one at 200
   *  averages 109, not 150. */
  averageRatePaise: Paise | null
  totalQty: number
  /** Whole days since the most recent document. Null when there is none. */
  daysSinceLast: number | null
  documentCount: number
}

export interface ProductHistory {
  /** PARTY: this party's own history. ALL: nothing with them, so everyone's. */
  scope: "PARTY" | "ALL"
  summary: ProductHistorySummary
  rows: ProductHistoryRow[]
}

export const netRatePaise = (unitPricePaise: Paise, discountPct: number): Paise =>
  Math.round(unitPricePaise * (1 - discountPct / 100))

const EMPTY_SUMMARY: ProductHistorySummary = {
  lastRatePaise: null,
  bestRatePaise: null,
  averageRatePaise: null,
  totalQty: 0,
  daysSinceLast: null,
  documentCount: 0,
}

function rowsFor(
  itemId: string,
  docs: HistoryDoc[],
  costAt: (dateISO: string) => Paise | null
): ProductHistoryRow[] {
  const rows: ProductHistoryRow[] = []
  for (const doc of docs) {
    if (doc.cancelled) continue
    for (const line of doc.lines) {
      if (line.itemId !== itemId) continue
      const net = netRatePaise(line.unitPricePaise, line.discountPct)
      const cost = costAt(doc.date)
      rows.push({
        docId: doc.id,
        docNumber: doc.number,
        kind: doc.kind,
        date: doc.date,
        qty: line.qty,
        listRatePaise: line.unitPricePaise,
        discountPct: line.discountPct,
        netRatePaise: net,
        costBasisPaise: cost,
        // Margin on the selling price, which is how a trader reads it.
        marginPct:
          cost === null || net === 0 ? null : Math.round(((net - cost) / net) * 1000) / 10,
      })
    }
  }
  // Most recent first; a stable tiebreak so the same data always reads the same.
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.docNumber.localeCompare(a.docNumber))
}

function summarise(rows: ProductHistoryRow[], asOfISO: string): ProductHistorySummary {
  if (rows.length === 0) return { ...EMPTY_SUMMARY }

  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0)
  const weighted = rows.reduce((sum, row) => sum + row.netRatePaise * row.qty, 0)
  const asOf = Date.parse(`${asOfISO}T00:00:00Z`)
  const latest = Date.parse(`${rows[0].date}T00:00:00Z`)

  return {
    lastRatePaise: rows[0].netRatePaise,
    bestRatePaise: Math.min(...rows.map((row) => row.netRatePaise)),
    averageRatePaise: totalQty > 0 ? Math.round(weighted / totalQty) : null,
    totalQty,
    daysSinceLast:
      Number.isFinite(asOf) && Number.isFinite(latest)
        ? Math.max(0, Math.round((asOf - latest) / 86_400_000))
        : null,
    documentCount: new Set(rows.map((row) => row.docId)).size,
  }
}

/**
 * This item's history with this party, falling back to everyone.
 *
 * The fallback matters: a new customer asking for a price is exactly when
 * somebody needs a number, and "no history" is a useless answer when the item
 * has been sold forty times to other people. The caller is told which it got,
 * because quoting another customer's price as if it were this one's is a
 * different mistake.
 */
export function productHistory(input: {
  itemId: string
  partyId: string
  docs: HistoryDoc[]
  /** Cost basis on a given date, when the caller can supply one. */
  costAt?: (dateISO: string) => Paise | null
  /** Today, for "days since". */
  asOfISO: string
  /** Cap, newest first — a popover nobody scrolls past twenty rows in. */
  limit?: number
}): ProductHistory {
  const { itemId, partyId, docs, asOfISO } = input
  const costAt = input.costAt ?? (() => null)
  const limit = input.limit ?? 20

  const own = rowsFor(itemId, docs.filter((doc) => doc.partyId === partyId), costAt)
  if (own.length > 0) {
    return { scope: "PARTY", summary: summarise(own, asOfISO), rows: own.slice(0, limit) }
  }

  const everyone = rowsFor(itemId, docs, costAt)
  return {
    scope: "ALL",
    summary: summarise(everyone, asOfISO),
    rows: everyone.slice(0, limit),
  }
}
