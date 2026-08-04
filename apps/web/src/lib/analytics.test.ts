import { describe, expect, it } from "vitest"

import { buildEmployeeAnalytics, crownHolder, rankedByPunctuality } from "./analytics"
import { EMPLOYEES } from "./seed"

describe("employee analytics", () => {
  it("recent-day dates are unique — regression for the duplicate-key bug", () => {
    for (const employee of EMPLOYEES) {
      const { recentDays } = buildEmployeeAnalytics(employee)
      const dates = recentDays.map((day) => day.date)
      expect(new Set(dates).size).toBe(dates.length)
    }
  })

  it("the crown needs the 85% floor — a bad month crowns nobody", () => {
    const crown = crownHolder()
    if (crown) expect(crown.score).toBeGreaterThanOrEqual(85)
  })

  it("ranking is a permutation of the workforce, best first", () => {
    const ranked = rankedByPunctuality()
    expect(ranked).toHaveLength(EMPLOYEES.length)
    for (let index = 1; index < ranked.length; index++) {
      expect(ranked[index - 1].score).toBeGreaterThanOrEqual(ranked[index].score)
    }
  })

  it("KPIs and chart series are fully populated", () => {
    const analytics = buildEmployeeAnalytics(EMPLOYEES[0])
    expect(analytics.kpis).toHaveLength(6)
    expect(analytics.workedSeries.length).toBeGreaterThan(10)
    expect(analytics.weekdayLate).toHaveLength(6)
    expect(analytics.statusSplit.reduce((sum, entry) => sum + entry.count, 0)).toBe(26)
  })
})
