import { describe, expect, it } from "vitest"

import {
  DEFAULT_ATTENDANCE_SETTINGS,
  attendanceSettingsSchema,
  estimateSelfieStorage,
  evaluateLate,
} from "./settings"

const s = (over: Partial<typeof DEFAULT_ATTENDANCE_SETTINGS> = {}) => ({
  ...DEFAULT_ATTENDANCE_SETTINGS,
  ...over,
})

describe("evaluateLate — the configurable late policy", () => {
  it("exactly at the grace boundary is not late", () => {
    const r = evaluateLate(15, 0, s({ lateGraceMinutes: 15 }))
    expect(r.isLate).toBe(false)
    expect(r.penalty).toBe("NONE")
  })

  it("one minute past grace is a late mark", () => {
    const r = evaluateLate(16, 0, s({ lateGraceMinutes: 15 }))
    expect(r.isLate).toBe(true)
    expect(r.markNumber).toBe(1)
    expect(r.penalty).toBe("NONE")
  })

  it("marks within the allowance carry no penalty and count down", () => {
    const first = evaluateLate(20, 0, s({ lateMarksAllowed: 2 }))
    expect(first.remainingAllowance).toBe(1)
    const second = evaluateLate(20, 1, s({ lateMarksAllowed: 2 }))
    expect(second.remainingAllowance).toBe(0)
    expect(second.penalty).toBe("NONE")
    expect(second.explanation).toMatch(/next late/i)
  })

  it("the (allowance+1)-th late applies the configured penalty — user rule: 2 forgiven, then absent", () => {
    const r = evaluateLate(20, 2, s({ lateMarksAllowed: 2, latePenalty: "ABSENT" }))
    expect(r.penalty).toBe("ABSENT")
    expect(r.markNumber).toBe(3)
  })

  it("penalty variants are all reachable", () => {
    for (const penalty of ["HALF_DAY", "ABSENT", "LOP"] as const) {
      expect(evaluateLate(30, 5, s({ latePenalty: penalty })).penalty).toBe(penalty)
    }
  })

  it("latePenaltyRepeats=false penalises only the first breach", () => {
    const cfg = s({ lateMarksAllowed: 2, latePenaltyRepeats: false })
    expect(evaluateLate(20, 2, cfg).penalty).toBe("ABSENT") // breach
    expect(evaluateLate(20, 3, cfg).penalty).toBe("NONE") // later lates
  })

  it("allowance of 0 penalises the first late", () => {
    const r = evaluateLate(16, 0, s({ lateMarksAllowed: 0 }))
    expect(r.penalty).toBe("ABSENT")
  })

  it("period wording follows latePeriod", () => {
    expect(evaluateLate(20, 0, s({ latePeriod: "WEEK" })).explanation).toMatch(/week/)
    expect(evaluateLate(20, 0, s({ latePeriod: "MONTH" })).explanation).toMatch(/month/)
  })
})

describe("settings schema", () => {
  it("defaults match the documented policy (15m grace, 2 forgiven, then absent)", () => {
    expect(DEFAULT_ATTENDANCE_SETTINGS.lateGraceMinutes).toBe(15)
    expect(DEFAULT_ATTENDANCE_SETTINGS.lateMarksAllowed).toBe(2)
    expect(DEFAULT_ATTENDANCE_SETTINGS.latePenalty).toBe("ABSENT")
    expect(DEFAULT_ATTENDANCE_SETTINGS.hardBlockOutsideWindow).toBe(false)
    expect(DEFAULT_ATTENDANCE_SETTINGS.selfieKeepOriginal).toBe(false)
  })

  it("rejects a negative grace", () => {
    expect(() => attendanceSettingsSchema.parse({ lateGraceMinutes: -1 })).toThrow()
  })
})

describe("estimateSelfieStorage", () => {
  it("derivatives are tiny and the monthly figure scales with headcount", () => {
    const e100 = estimateSelfieStorage(s(), 100)
    const e500 = estimateSelfieStorage(s(), 500)
    expect(e100.thumbKb).toBeLessThan(10)
    expect(e100.viewKb).toBeLessThan(80)
    expect(e500.monthlyGb).toBeCloseTo(e100.monthlyGb * 5, 1)
  })

  it("retained = monthly × retention months", () => {
    const e = estimateSelfieStorage(s({ selfieRetentionMonths: 6 }), 200)
    expect(e.retainedGb).toBeCloseTo(e.monthlyGb * 6, 1)
  })

  it("keeping originals multiplies storage by an order of magnitude", () => {
    const off = estimateSelfieStorage(s(), 500)
    const on = estimateSelfieStorage(s({ selfieKeepOriginal: true }), 500)
    expect(on.monthlyGb / off.monthlyGb).toBeGreaterThan(10)
  })
})
