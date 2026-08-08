import { describe, expect, it } from "vitest"

import { formatPaise, paiseToRupees, rupeesToPaise } from "./money"
import { earnedPaise, otPaise, perDayPaise } from "./payroll"
import { DEFAULT_MATRIX, PERMISSIONS, allowedScopes } from "./rbac"

const ctx = { calendarDays: 31, workingDays: 26 }

describe("money — integer paise, exact assertions (§11)", () => {
  it("round-trips rupees to paise", () => {
    expect(rupeesToPaise(26_000)).toBe(2_600_000)
    expect(paiseToRupees(2_600_000)).toBe(26_000)
  })

  it("rounds sub-paise amounts instead of truncating", () => {
    expect(rupeesToPaise(0.005)).toBe(1)
  })

  it("formats with the Indian grouping and the rupee sign", () => {
    expect(formatPaise(123_45_67_890)).toContain("₹")
    expect(formatPaise(2_600_000)).toMatch(/26,000/)
  })

  it("summing many paise amounts never drifts", () => {
    const total = Array.from({ length: 1000 }, () => 3333).reduce((a, b) => a + b, 0)
    expect(total).toBe(3_333_000) // exactly — no float epsilon
  })
})

describe("per-day rate bases (§6)", () => {
  const gross = rupeesToPaise(26_000)

  it("FIXED_26: ₹26,000 → ₹1,000/day exactly", () => {
    expect(perDayPaise(gross, "FIXED_26", ctx)).toBe(100_000)
  })

  it("CALENDAR_DAYS divides by the month length", () => {
    expect(perDayPaise(gross, "CALENDAR_DAYS", ctx)).toBe(Math.round(2_600_000 / 31))
  })

  it("WORKING_DAYS divides by rostered working days", () => {
    expect(perDayPaise(gross, "WORKING_DAYS", ctx)).toBe(100_000)
  })
})

describe("earned + overtime — the §11 worked example", () => {
  const gross = rupeesToPaise(26_000)

  it("₹26,000 gross, FIXED_26, 2 unpaid days → ₹24,000.00 exactly", () => {
    expect(earnedPaise(gross, "FIXED_26", ctx, 2)).toBe(rupeesToPaise(24_000))
  })

  it("half days deduct cleanly: 0.5 unpaid → ₹25,500.00", () => {
    expect(earnedPaise(gross, "FIXED_26", ctx, 0.5)).toBe(rupeesToPaise(25_500))
  })

  it("full attendance is exactly the contracted salary on every basis", () => {
    // The invariant the multiply-up model broke: nothing lost, nothing
    // deducted, whatever the month's length or the divisor. Summing payable
    // units instead paid a 31-day month as 31 days against a 26-day divisor.
    for (const basis of ["FIXED_26", "WORKING_DAYS", "CALENDAR_DAYS"] as const) {
      expect(earnedPaise(gross, basis, ctx, 0)).toBe(gross)
    }
  })

  it("losing every expected day cannot pay a negative salary", () => {
    expect(earnedPaise(gross, "FIXED_26", ctx, 40)).toBe(0)
  })

  it("90 min OT at 1.5× on an 8h day of ₹1,000 → ₹281.25 exactly", () => {
    expect(otPaise(gross, "FIXED_26", ctx, 90, 1.5, 8)).toBe(28_125)
  })

  it("zero OT minutes pays zero", () => {
    expect(otPaise(gross, "FIXED_26", ctx, 0, 1.5, 8)).toBe(0)
  })
})

describe("RBAC matrix — the §2 table is data and matches the brief", () => {
  it("every permission has a grant for every role", () => {
    for (const permission of PERMISSIONS) {
      for (const role of ["ADMIN", "HR", "OPERATIONS", "EMPLOYEE"] as const) {
        expect(DEFAULT_MATRIX[permission.key][role]).toBeDefined()
      }
    }
  })

  it("spot checks against §2", () => {
    expect(DEFAULT_MATRIX["config.manage"].ADMIN).toBe("ALL")
    expect(DEFAULT_MATRIX["config.manage"].HR).toBe("VIEW")
    expect(DEFAULT_MATRIX["config.manage"].EMPLOYEE).toBe("NONE")
    expect(DEFAULT_MATRIX["leave.approve"].OPERATIONS).toBe("OWN_TEAM")
    expect(DEFAULT_MATRIX["audit.view"].OPERATIONS).toBe("NONE")
    expect(DEFAULT_MATRIX["punch.self"].EMPLOYEE).toBe("SELF")
    expect(DEFAULT_MATRIX["selfie.view"].EMPLOYEE).toBe("SELF")
  })

  it("punch.self can only ever be NONE or SELF", () => {
    expect(allowedScopes("punch.self")).toEqual(["NONE", "SELF"])
  })
})
