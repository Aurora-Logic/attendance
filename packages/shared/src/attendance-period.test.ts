import { describe, expect, it } from "vitest"

import {
  datesInPeriod,
  monthsInPeriod,
  periodBalances,
  summarisePeriod,
  type PeriodDay,
} from "./attendance-period"

const day = (over: Partial<PeriodDay> = {}): PeriodDay => ({
  dateISO: "2026-08-03",
  status: "PRESENT",
  payableUnits: 1,
  otMinutes: 0,
  lateMinutes: 0,
  ...over,
})

describe("summarisePeriod", () => {
  it("counts a plain working month the way a person would", () => {
    const days = [
      ...Array.from({ length: 20 }, () => day()),
      ...Array.from({ length: 4 }, () => day({ status: "WEEKLY_OFF", payableUnits: 1 })),
      day({ status: "HOLIDAY", payableUnits: 1 }),
      day({ status: "ABSENT", payableUnits: 0 }),
    ]
    const totals = summarisePeriod(days)
    expect(totals.presentDays).toBe(20)
    expect(totals.weeklyOffDays).toBe(4)
    expect(totals.holidayDays).toBe(1)
    expect(totals.absentDays).toBe(1)
    expect(totals.totalDays).toBe(26)
  })

  it("separates paid leave from unpaid, which is the figure that cuts salary", () => {
    const totals = summarisePeriod([
      day({ status: "ON_LEAVE", payableUnits: 1, leaveIsPaid: true }),
      day({ status: "ON_LEAVE", payableUnits: 1, leaveIsPaid: true }),
      day({ status: "ON_LEAVE", payableUnits: 0, leaveIsPaid: false }),
    ])
    expect(totals.paidLeaveDays).toBe(2)
    expect(totals.unpaidLeaveDays).toBe(1)
  })

  it("treats leave with no paid flag as paid, never silently unpaid", () => {
    // Guessing "unpaid" on missing data docks somebody's pay on a default.
    expect(summarisePeriod([day({ status: "ON_LEAVE", payableUnits: 1 })]).paidLeaveDays).toBe(1)
  })

  it("splits a half-leave day across both columns so it still reconciles", () => {
    const totals = summarisePeriod([
      day({ status: "ON_LEAVE_HALF", payableUnits: 1, leaveIsPaid: true }),
    ])
    expect(totals.halfDays).toBe(0.5)
    expect(totals.paidLeaveDays).toBe(0.5)
    expect(periodBalances(totals)).toBe(true)
  })

  it("counts WFH and on-duty as present — they are worked days", () => {
    const totals = summarisePeriod([day({ status: "WFH" }), day({ status: "ON_DUTY" })])
    expect(totals.presentDays).toBe(2)
    expect(totals.absentDays).toBe(0)
  })

  it("keeps an undecided day out of the payable count", () => {
    // Paying for something nobody approved is worse than paying it late.
    const totals = summarisePeriod([day({ status: "PENDING_APPROVAL", payableUnits: 0 })])
    expect(totals.pendingDays).toBe(1)
    expect(totals.payableDays).toBe(0)
  })

  it("sums overtime and reports it in hours to two places", () => {
    const totals = summarisePeriod([
      day({ otMinutes: 45 }),
      day({ otMinutes: 30 }),
      day({ otMinutes: 15 }),
    ])
    expect(totals.overtimeMinutes).toBe(90)
    expect(totals.overtimeHours).toBe(1.5)
  })

  it("does not accumulate floating-point dust across a long period", () => {
    // 0.5 payable days over a month is exactly the shape that produces
    // 12.999999999999998 and an argument with the accountant.
    const totals = summarisePeriod(
      Array.from({ length: 26 }, () => day({ status: "HALF_DAY", payableUnits: 0.5 }))
    )
    expect(totals.payableDays).toBe(13)
    expect(totals.halfDays).toBe(26)
  })

  it("every bucket accounts for every day, for any mix", () => {
    const totals = summarisePeriod([
      day(),
      day({ status: "HALF_DAY", payableUnits: 0.5 }),
      day({ status: "ABSENT", payableUnits: 0 }),
      day({ status: "ON_LEAVE", leaveIsPaid: true }),
      day({ status: "ON_LEAVE", leaveIsPaid: false, payableUnits: 0 }),
      day({ status: "ON_LEAVE_HALF", leaveIsPaid: true, payableUnits: 1 }),
      day({ status: "WEEKLY_OFF" }),
      day({ status: "HOLIDAY" }),
      day({ status: "PENDING_APPROVAL", payableUnits: 0 }),
      day({ status: "WFH" }),
      day({ status: "ON_DUTY" }),
    ])
    expect(periodBalances(totals)).toBe(true)
  })

  it("an empty period is all zeroes, not NaN", () => {
    const totals = summarisePeriod([])
    expect(totals.totalDays).toBe(0)
    expect(totals.overtimeHours).toBe(0)
    expect(periodBalances(totals)).toBe(true)
  })
})

describe("datesInPeriod", () => {
  it("includes both ends", () => {
    expect(datesInPeriod("2026-08-01", "2026-08-03")).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ])
  })

  it("crosses a month and a year end", () => {
    expect(datesInPeriod("2026-01-31", "2026-02-01")).toEqual(["2026-01-31", "2026-02-01"])
    expect(datesInPeriod("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"])
  })

  it("handles a leap day", () => {
    const days = datesInPeriod("2028-02-27", "2028-03-01")
    expect(days).toContain("2028-02-29")
    expect(days).toHaveLength(4)
  })

  it("is one day for a single-day period, and empty when reversed", () => {
    expect(datesInPeriod("2026-08-05", "2026-08-05")).toEqual(["2026-08-05"])
    expect(datesInPeriod("2026-08-05", "2026-08-01")).toEqual([])
  })

  it("returns nothing rather than looping forever on an unreadable date", () => {
    expect(datesInPeriod("not-a-date", "2026-08-01")).toEqual([])
  })

  it("counts a full month correctly, including February", () => {
    expect(datesInPeriod("2026-02-01", "2026-02-28")).toHaveLength(28)
    expect(datesInPeriod("2028-02-01", "2028-02-29")).toHaveLength(29)
    expect(datesInPeriod("2026-08-01", "2026-08-31")).toHaveLength(31)
  })
})

describe("monthsInPeriod", () => {
  it("names every month a period touches, so each lock can be checked", () => {
    expect(monthsInPeriod("2026-07-28", "2026-08-02")).toEqual(["2026-07", "2026-08"])
    expect(monthsInPeriod("2026-08-01", "2026-08-31")).toEqual(["2026-08"])
  })
})
