import { describe, expect, it } from "vitest"

import { compOffCredit, compOffExpiries, compOffUsable, countLeaveUnits, prorateAnnualQuota, reduceLedger } from "./leave"

describe("reduceLedger — balances are a projection of the ledger", () => {
  it("sums credits and debits per type", () => {
    const balances = reduceLedger([
      { type: "EL", units: 6 },
      { type: "EL", units: 1.5 },
      { type: "EL", units: -2 },
      { type: "CL", units: 12 },
    ])
    expect(balances.EL).toBe(5.5)
    expect(balances.CL).toBe(12)
  })

  it("refuses a debit that would go negative", () => {
    expect(() =>
      reduceLedger([
        { type: "CL", units: 1 },
        { type: "CL", units: -2 },
      ])
    ).toThrow(/negative/i)
  })

  it("LOP is allowed to run negative — it is unpaid by definition", () => {
    const balances = reduceLedger([{ type: "LOP", units: -3 }])
    expect(balances.LOP).toBe(-3)
  })
})

// Aug 2026: 15th is a holiday (Saturday), Sundays are weekly off.
const calendar = {
  isHoliday: (d: string) => d === "2026-08-15",
  isWeeklyOff: (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0,
}

describe("countLeaveUnits — sandwich rule", () => {
  it("plain working span counts every day", () => {
    expect(countLeaveUnits("2026-08-03", "2026-08-05", "FULL", calendar, false)).toBe(3)
  })

  it("half-day application on one working day is 0.5", () => {
    expect(countLeaveUnits("2026-08-04", "2026-08-04", "FIRST_HALF", calendar, false)).toBe(0.5)
  })

  it("sandwich OFF: the Sunday inside Fri→Mon is free", () => {
    expect(countLeaveUnits("2026-08-07", "2026-08-10", "FULL", calendar, false)).toBe(3)
  })

  it("sandwich ON: the Sunday inside Fri→Mon is charged", () => {
    expect(countLeaveUnits("2026-08-07", "2026-08-10", "FULL", calendar, true)).toBe(4)
  })

  it("sandwich ON: trailing weekend is NOT charged — nothing on the far side", () => {
    // Thu 6th → Sun 9th: Sunday has no working leave day after it.
    expect(countLeaveUnits("2026-08-06", "2026-08-09", "FULL", calendar, true)).toBe(3)
  })

  it("sandwich ON charges the sandwiched holiday too (14th–17th spans the 15th + Sunday 16th)", () => {
    expect(countLeaveUnits("2026-08-14", "2026-08-17", "FULL", calendar, true)).toBe(4)
    expect(countLeaveUnits("2026-08-14", "2026-08-17", "FULL", calendar, false)).toBe(2)
  })
})

describe("prorateAnnualQuota — mid-year joiners (§5)", () => {
  it("joined before the year → full quota", () => {
    expect(prorateAnnualQuota(18, "2025-03-01", 2026)).toBe(18)
  })

  it("joined 1 July → half the year → half the quota", () => {
    expect(prorateAnnualQuota(18, "2026-07-01", 2026)).toBe(9)
  })

  it("joining on the 15th counts the month; the 16th does not", () => {
    expect(prorateAnnualQuota(12, "2026-07-15", 2026)).toBe(6)
    expect(prorateAnnualQuota(12, "2026-07-16", 2026)).toBe(5)
  })

  it("rounds to half days", () => {
    expect(prorateAnnualQuota(10, "2026-06-01", 2026) % 0.5).toBe(0)
  })

  it("joining after the year yields nothing", () => {
    expect(prorateAnnualQuota(18, "2027-01-05", 2026)).toBe(0)
  })
})

describe("compOffUsable — expiry window", () => {
  it("usable inside the window, dead after it", () => {
    expect(compOffUsable("2026-08-01", 60, "2026-09-15")).toBe(true)
    expect(compOffUsable("2026-08-01", 60, "2026-10-01")).toBe(false)
  })

  it("cannot be used before it was earned", () => {
    expect(compOffUsable("2026-08-10", 60, "2026-08-05")).toBe(false)
  })
})

describe("compOffCredit", () => {
  const settings = { halfDayMinHours: 4, fullDayMinHours: 8 }

  it("uses the same thresholds a normal day uses", () => {
    expect(compOffCredit(8 * 60, settings)).toBe(1)
    expect(compOffCredit(9 * 60, settings)).toBe(1)
    expect(compOffCredit(4 * 60, settings)).toBe(0.5)
    expect(compOffCredit(7 * 60 + 59, settings)).toBe(0.5)
  })

  it("earns nothing for a token appearance", () => {
    expect(compOffCredit(0, settings)).toBe(0)
    expect(compOffCredit(3 * 60 + 59, settings)).toBe(0)
  })
})

describe("compOffExpiries", () => {
  const credits = [
    { earnedISO: "2026-01-10", units: 1 },
    { earnedISO: "2026-05-01", units: 1 },
    { earnedISO: "2026-08-01", units: 0.5 },
  ]

  it("consumes oldest first, so a debit burns the credit closest to expiring", () => {
    // One day spent: it comes off the January lot, which is the one at risk.
    const expired = compOffExpiries(credits, 1, 90, "2026-08-08")
    expect(expired.map((entry) => entry.earnedISO)).toEqual(["2026-05-01"])
    expect(expired[0].units).toBe(1)
  })

  it("reports every un-consumed lot past its window", () => {
    const expired = compOffExpiries(credits, 0, 90, "2026-08-08")
    expect(expired).toEqual([
      { earnedISO: "2026-01-10", units: 1 },
      { earnedISO: "2026-05-01", units: 1 },
    ])
  })

  it("expires nothing while every credit is still inside the window", () => {
    expect(compOffExpiries(credits, 0, 365, "2026-08-08")).toEqual([])
  })

  it("expires a partially consumed lot only for what is left", () => {
    const expired = compOffExpiries([{ earnedISO: "2026-01-10", units: 1 }], 0.5, 90, "2026-08-08")
    expect(expired).toEqual([{ earnedISO: "2026-01-10", units: 0.5 }])
  })

  it("a debit larger than the stale lots leaves nothing to expire", () => {
    expect(compOffExpiries(credits, 3, 90, "2026-08-08")).toEqual([])
  })
})
