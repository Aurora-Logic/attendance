import * as z from "zod"

import type { Paise } from "./money"
import type { Grn, Item, PurchaseOrder } from "./procurement"
import type { Challan, SalesOrder } from "./sales"

/**
 * Inventory: the stock ledger is a PROJECTION, not a table. Goods in already
 * exist as GRNs and goods out as challans — deriving movements from those
 * documents means stock can never disagree with the paperwork that moved it.
 * Only counted corrections need their own record: `StockAdjustment`,
 * append-only with a reason, the A1 doctrine applied to material.
 */

export const stockAdjustmentSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  /** Positive = found/returned, negative = shrinkage/damage. */
  qty: z.number().refine((value) => value !== 0, "Zero adjusts nothing"),
  date: z.string(),
  reason: z.string().min(2),
  recordedBy: z.string().default(""),
})
export type StockAdjustment = z.infer<typeof stockAdjustmentSchema>

export interface StockMovement {
  itemId: string
  date: string
  /** Positive in, negative out. */
  qty: number
  kind: "GRN_IN" | "DISPATCH_OUT" | "ADJUSTMENT"
  /** GRN / challan / adjustment document number for the audit trail. */
  ref: string
  /** Purchase cost per unit, known only on inward movements. */
  unitCostPaise: Paise | null
}

/** Every stock movement in the system, oldest first — one derivation, no drift. */
export function stockMovements(
  pos: PurchaseOrder[],
  grns: Grn[],
  salesOrders: SalesOrder[],
  challans: Challan[],
  adjustments: StockAdjustment[]
): StockMovement[] {
  const movements: StockMovement[] = []

  for (const grn of grns) {
    const po = pos.find((candidate) => candidate.id === grn.poId)
    for (const grnLine of grn.lines) {
      if (grnLine.qtyAccepted <= 0) continue
      const poLine = po?.lines.find((candidate) => candidate.id === grnLine.poLineId)
      if (!poLine) continue
      movements.push({
        itemId: poLine.itemId,
        date: grn.receivedDate,
        qty: grnLine.qtyAccepted,
        kind: "GRN_IN",
        ref: grn.number,
        unitCostPaise: poLine.unitPricePaise,
      })
    }
  }

  for (const challan of challans) {
    const so = salesOrders.find((candidate) => candidate.id === challan.soId)
    for (const challanLine of challan.lines) {
      const soLine = so?.lines.find((candidate) => candidate.id === challanLine.soLineId)
      if (!soLine) continue
      movements.push({
        itemId: soLine.itemId,
        date: challan.dispatchDate,
        qty: -challanLine.qty,
        kind: "DISPATCH_OUT",
        ref: challan.number,
        unitCostPaise: null,
      })
    }
  }

  for (const adjustment of adjustments) {
    movements.push({
      itemId: adjustment.itemId,
      date: adjustment.date,
      qty: adjustment.qty,
      kind: "ADJUSTMENT",
      ref: adjustment.reason,
      unitCostPaise: null,
    })
  }

  return movements.sort((a, b) => a.date.localeCompare(b.date))
}

export interface StockPosition {
  itemId: string
  onHandQty: number
  /** Weighted-average purchase cost of what came in; null before any inward. */
  avgCostPaise: Paise | null
  /** onHand × avgCost — the stock valuation figure. */
  valuePaise: Paise
  belowReorder: boolean
}

/**
 * Position per item. Valuation is weighted-average over inward movements —
 * the standard small-company method, and the only one derivable without lot
 * tracking. Rounded once per item.
 */
export function stockPositions(items: Item[], movements: StockMovement[]): StockPosition[] {
  return items.map((item) => {
    const own = movements.filter((movement) => movement.itemId === item.id)
    const onHandQty = own.reduce((sum, movement) => sum + movement.qty, 0)

    let inQty = 0
    let inValue = 0
    for (const movement of own) {
      if (movement.qty > 0 && movement.unitCostPaise !== null) {
        inQty += movement.qty
        inValue += movement.qty * movement.unitCostPaise
      }
    }
    const avgCostPaise = inQty > 0 ? Math.round(inValue / inQty) : null

    return {
      itemId: item.id,
      onHandQty,
      avgCostPaise,
      valuePaise: avgCostPaise !== null ? Math.round(Math.max(onHandQty, 0) * avgCostPaise) : 0,
      belowReorder: item.reorderLevel > 0 && onHandQty <= item.reorderLevel,
    }
  })
}
