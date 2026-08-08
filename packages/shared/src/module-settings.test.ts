import { describe, expect, it } from "vitest"

import {
  DEFAULT_OPERATIONS_SETTINGS,
  operationsSettingsSchema,
  operationsSettingsWarnings,
  type OperationsSettings,
} from "./module-settings"

const withSettings = (patch: (draft: OperationsSettings) => void): OperationsSettings => {
  const draft = structuredClone(DEFAULT_OPERATIONS_SETTINGS)
  patch(draft)
  return draft
}

describe("operationsSettingsSchema", () => {
  it("fills in every module from an empty object, so a fresh company is governed", () => {
    const parsed = operationsSettingsSchema.parse({})
    expect(parsed.dispatch.requireLrNumber).toBe(true)
    expect(parsed.credit.defaultTerms.creditDays).toBe(30)
    expect(parsed.inventory.blockNegativeStock).toBe(true)
  })

  it("defaults to the cautious setting on every control", () => {
    // Nobody should discover a control they never knew they had switched off.
    const { procurement, inventory, dispatch, credit } = DEFAULT_OPERATIONS_SETTINGS
    expect(procurement.blockOverReceipt).toBe(true)
    expect(procurement.requireThreeWayMatch).toBe(true)
    expect(inventory.blockNegativeStock).toBe(true)
    expect(dispatch.requirePickList).toBe(true)
    expect(dispatch.requireAllLrCopies).toBe(true)
    expect(credit.holdOrdersOnBreach).toBe(true)
  })

  it("keeps a partial update and defaults the rest of that module", () => {
    const parsed = operationsSettingsSchema.parse({ dispatch: { podGraceDays: 7 } })
    expect(parsed.dispatch.podGraceDays).toBe(7)
    expect(parsed.dispatch.requireLrNumber).toBe(true)
  })

  it("refuses a discount ceiling that is not a percentage", () => {
    expect(operationsSettingsSchema.safeParse({ sales: { maxDiscountPct: 140 } }).success).toBe(false)
    expect(operationsSettingsSchema.safeParse({ sales: { maxDiscountPct: -1 } }).success).toBe(false)
  })

  it("refuses a negative threshold, which would make every order need approval by accident", () => {
    expect(
      operationsSettingsSchema.safeParse({ procurement: { poApprovalThresholdPaise: -1 } }).success
    ).toBe(false)
  })
})

describe("operationsSettingsWarnings", () => {
  it("says nothing about a coherent set of rules", () => {
    expect(operationsSettingsWarnings(DEFAULT_OPERATIONS_SETTINGS)).toEqual([])
  })

  it("catches packing required without picking", () => {
    // Otherwise cartons are sealed on goods nobody picked, and the first person
    // it inconveniences quietly ignores the rule, taking the rest with it.
    const warnings = operationsSettingsWarnings(
      withSettings((draft) => {
        draft.dispatch.requirePickList = false
      })
    )
    expect(warnings.join(" ")).toMatch(/cartons would be sealed on goods nobody picked/)
  })

  it("catches LR copies required with no LR number", () => {
    const warnings = operationsSettingsWarnings(
      withSettings((draft) => {
        draft.dispatch.requireLrNumber = false
      })
    )
    expect(warnings.join(" ")).toMatch(/nothing for the copies to belong to/)
  })

  it("catches a tolerance that governs nothing", () => {
    const warnings = operationsSettingsWarnings(
      withSettings((draft) => {
        draft.procurement.blockOverReceipt = false
        draft.procurement.receiptTolerancePct = 5
      })
    )
    expect(warnings.join(" ")).toMatch(/tolerance governs nothing/)
  })

  it("catches a hold nobody can release", () => {
    const warnings = operationsSettingsWarnings(
      withSettings((draft) => {
        draft.credit.defaultTerms.allowOverride = false
      })
    )
    expect(warnings.join(" ")).toMatch(/can only be freed by changing the customer's terms/)
  })

  it("catches a credit limit on cash-on-delivery terms", () => {
    const warnings = operationsSettingsWarnings(
      withSettings((draft) => {
        draft.credit.defaultTerms.creditDays = 0
        draft.credit.defaultTerms.creditLimitPaise = 100_000_00
      })
    )
    expect(warnings.join(" ")).toMatch(/would never be reached/)
  })

  it("catches a reservation that guarantees nothing", () => {
    const warnings = operationsSettingsWarnings(
      withSettings((draft) => {
        draft.inventory.blockNegativeStock = false
      })
    )
    expect(warnings.join(" ")).toMatch(/reservation guarantees nothing/)
  })

  it("catches a discount ceiling that gives goods away", () => {
    const warnings = operationsSettingsWarnings(
      withSettings((draft) => {
        draft.sales.maxDiscountPct = 100
      })
    )
    expect(warnings.join(" ")).toMatch(/given away without approval/)
  })

  it("reports every contradiction at once", () => {
    const warnings = operationsSettingsWarnings(
      withSettings((draft) => {
        draft.dispatch.requirePickList = false
        draft.dispatch.requireLrNumber = false
        draft.inventory.blockNegativeStock = false
      })
    )
    expect(warnings.length).toBe(3)
  })
})
