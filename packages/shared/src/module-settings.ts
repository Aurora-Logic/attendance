import * as z from "zod"

import { creditTermsSchema, DEFAULT_CREDIT_TERMS } from "./credit"

/**
 * The rules the commercial modules run on.
 *
 * These are deliberately separate from the attendance settings rather than
 * added to them. Attendance settings are one company-wide object about shifts
 * and punches; procurement, sales, stock, credit and dispatch each answer to
 * different people, and a single forty-field blob would have meant every
 * change to a picking rule touching the payroll schema.
 *
 * Every default here is the cautious one. A company that wants a control
 * relaxed can turn it off deliberately; nobody discovers a control they never
 * knew they had switched off.
 */

/* -------------------------------------------------------------- procurement */

export const procurementSettingsSchema = z.object({
  /** Value above which a purchase order needs a second signature. 0 = always. */
  poApprovalThresholdPaise: z.number().int().nonnegative().default(50_000_00),
  /** Refuse a goods receipt for more than the order asked for. */
  blockOverReceipt: z.boolean().default(true),
  /**
   * How much over the ordered quantity a receipt may still go, as a
   * percentage. Bulk materials arrive a little over; bolts do not.
   */
  receiptTolerancePct: z.number().min(0).max(100).default(0),
  /** Refuse a vendor bill that does not match the order and the receipt. */
  requireThreeWayMatch: z.boolean().default(true),
  /** How far a bill may differ from the order before the match fails. */
  billTolerancePaise: z.number().int().nonnegative().default(100),
  /** Default payment terms for a new vendor, in days. */
  defaultVendorTermsDays: z.number().int().nonnegative().default(30),
})
export type ProcurementSettings = z.infer<typeof procurementSettingsSchema>

/* --------------------------------------------------------------- sales */

export const salesSettingsSchema = z.object({
  /** Days an estimate stands before it reads as expired. */
  estimateValidityDays: z.number().int().positive().default(15),
  /** Largest discount a salesperson may give without approval. */
  maxDiscountPct: z.number().min(0).max(100).default(10),
  /** Refuse to sell below the item's cost. */
  blockBelowCost: z.boolean().default(true),
  /** Require the customer's own order reference on a sales order. */
  requireCustomerRef: z.boolean().default(false),
  /** Default GST rate for a new item, where nothing more specific applies. */
  defaultGstRatePct: z.number().min(0).max(28).default(18),
  /** Round an invoice total to the nearest rupee, as most Indian books do. */
  roundInvoiceTotals: z.boolean().default(true),
})
export type SalesSettings = z.infer<typeof salesSettingsSchema>

/* ------------------------------------------------------------- inventory */

export const inventorySettingsSchema = z.object({
  /** Refuse an issue that would take a stock item below zero. */
  blockNegativeStock: z.boolean().default(true),
  /** Warn when free stock falls under an item's reorder level. */
  lowStockWarnings: z.boolean().default(true),
  /**
   * Treat stock committed to open sales orders as unavailable. Off means the
   * same carton can be promised twice.
   */
  reserveOnSalesOrder: z.boolean().default(true),
  /** Days before a physical count is considered overdue. */
  stockCountIntervalDays: z.number().int().positive().default(90),
  /** Require a reason on every manual stock adjustment. */
  requireAdjustmentReason: z.boolean().default(true),
})
export type InventorySettings = z.infer<typeof inventorySettingsSchema>

/* ---------------------------------------------------- dispatch & logistics */

export const dispatchSettingsSchema = z.object({
  /** Nothing leaves that a picker has not picked. */
  requirePickList: z.boolean().default(true),
  /** Nothing leaves that has not been packed and counted into cartons. */
  requirePacking: z.boolean().default(true),
  /**
   * Refuse a dispatch on a hired lorry without an LR number. Turning this off
   * means goods leave with nothing to reference in a claim.
   */
  requireLrNumber: z.boolean().default(true),
  /** All three LR copies must be on file before the dispatch is closed. */
  requireAllLrCopies: z.boolean().default(true),
  /** Days after dispatch before a missing proof of delivery is chased. */
  podGraceDays: z.number().int().nonnegative().default(3),
  /** Consignment value above which an e-way bill number is required. */
  ewayBillThresholdPaise: z.number().int().nonnegative().default(50_000_00),
  /** Vehicles the company owns, so the LR rules can relax for them. */
  ownVehicleNumbers: z.array(z.string()).default([]),
  /** Transporters used often enough to offer as a choice. */
  transporters: z.array(z.string()).default([]),
})
export type DispatchSettings = z.infer<typeof dispatchSettingsSchema>

/* --------------------------------------------------------------- credit */

export const creditSettingsSchema = z.object({
  /** The terms a customer gets when nothing specific is set for them. */
  defaultTerms: creditTermsSchema.default(DEFAULT_CREDIT_TERMS),
  /** Below this, an overdue amount is not worth a phone call. */
  chaseMinimumPaise: z.number().int().nonnegative().default(500_00),
  /**
   * Stop a sales order for a customer the rules would hold. Off means the
   * overdue list is advice; on means it is a gate.
   */
  holdOrdersOnBreach: z.boolean().default(true),
})
export type CreditSettings = z.infer<typeof creditSettingsSchema>

/* ------------------------------------------------------------- everything */

export const operationsSettingsSchema = z.object({
  procurement: procurementSettingsSchema.default(procurementSettingsSchema.parse({})),
  sales: salesSettingsSchema.default(salesSettingsSchema.parse({})),
  inventory: inventorySettingsSchema.default(inventorySettingsSchema.parse({})),
  dispatch: dispatchSettingsSchema.default(dispatchSettingsSchema.parse({})),
  credit: creditSettingsSchema.default(creditSettingsSchema.parse({})),
})
export type OperationsSettings = z.infer<typeof operationsSettingsSchema>

export const DEFAULT_OPERATIONS_SETTINGS: OperationsSettings = operationsSettingsSchema.parse({})

export const OPERATIONS_MODULES = [
  "procurement",
  "sales",
  "inventory",
  "dispatch",
  "credit",
] as const
export type OperationsModule = (typeof OPERATIONS_MODULES)[number]

/**
 * Settings that contradict each other, said plainly.
 *
 * A schema can tell you a number is a number. It cannot tell you that
 * requiring packing while not requiring a pick list describes a warehouse
 * where cartons are sealed on goods nobody has picked — a rule that will be
 * quietly ignored by the first person it inconveniences, taking the rest of
 * the controls with it.
 */
export function operationsSettingsWarnings(settings: OperationsSettings): string[] {
  const warnings: string[] = []

  if (settings.dispatch.requirePacking && !settings.dispatch.requirePickList)
    warnings.push(
      "Packing is required but picking is not, so cartons would be sealed on goods nobody picked."
    )

  if (settings.dispatch.requireAllLrCopies && !settings.dispatch.requireLrNumber)
    warnings.push(
      "All three LR copies are required, but an LR number is not — there would be nothing for the copies to belong to."
    )

  if (!settings.procurement.blockOverReceipt && settings.procurement.receiptTolerancePct > 0)
    warnings.push(
      "A receipt tolerance is set but over-receipt is not blocked, so the tolerance governs nothing."
    )

  if (settings.credit.holdOrdersOnBreach && !settings.credit.defaultTerms.allowOverride)
    warnings.push(
      "Orders are held on a credit breach and nobody may override, so a held order can only be freed by changing the customer's terms."
    )

  if (settings.credit.defaultTerms.creditDays === 0 && settings.credit.defaultTerms.creditLimitPaise > 0)
    warnings.push(
      "Customers pay on delivery by default, so a credit limit would never be reached."
    )

  if (settings.inventory.reserveOnSalesOrder && !settings.inventory.blockNegativeStock)
    warnings.push(
      "Stock is reserved against orders but may still go negative, so a reservation guarantees nothing."
    )

  if (settings.sales.maxDiscountPct >= 100)
    warnings.push("A 100% discount ceiling means goods can be given away without approval.")

  return warnings
}
