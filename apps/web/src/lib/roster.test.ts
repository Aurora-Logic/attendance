import { seedAttendanceDays } from "./seed"
import { describe, expect, it } from "vitest"

import {
  DEFAULT_PATTERNS,
  DEFAULT_ROSTER_RULES,
  DEFAULT_SHIFTS,
  type RosterConfig,
} from "./app-config"
import { generateRoster } from "./roster"
import { EMPLOYEES } from "./seed"

const config = (over: Partial<RosterConfig> = {}): RosterConfig => ({
  shifts: DEFAULT_SHIFTS,
  patterns: DEFAULT_PATTERNS,
  departmentPatterns: { Finance: "sun-alt-sat", HR: "sun-alt-sat" },
  rotation: { enabled: true, department: "Production", cycle: ["morn", "eve", "night"] },
  rules: DEFAULT_ROSTER_RULES.map((rule) => ({ ...rule })),
  holidays: { "2026-08-15": "Independence Day" },
  halfDays: { "2026-08-20": "Founders Day" },
  ...over,
})

// August 2026: Sundays are the 2nd, 9th, 16th, 23rd, 30th. Saturdays: 1, 8, 15, 22, 29.
const rowFor = (rows: ReturnType<typeof generateRoster>, department: string) =>
  rows.find((row) => row.employee.department === department)!

describe("generateRoster — derived from configuration, never copied", () => {
  it("Sundays are weekly off for everyone on the base pattern", () => {
    const rows = generateRoster(2026, 7, config())
    const operations = rowFor(rows, "Operations")
    for (const day of [2, 9, 16, 23, 30]) {
      expect(operations.cells[day - 1].status).toBe("WEEKLY_OFF")
    }
  })

  it("Finance gets 2nd and 4th Saturdays off; 1st/3rd/5th stay working", () => {
    const rows = generateRoster(2026, 7, config())
    const finance = rowFor(rows, "Finance")
    expect(finance.cells[8 - 1].status).toBe("WEEKLY_OFF") // 2nd Saturday
    expect(finance.cells[22 - 1].status).toBe("WEEKLY_OFF") // 4th Saturday
    expect(finance.cells[1 - 1].status).not.toBe("WEEKLY_OFF") // 1st Saturday
    expect(finance.cells[29 - 1].status).not.toBe("WEEKLY_OFF") // 5th Saturday
  })

  it("a declared holiday overrides the whole column", () => {
    const rows = generateRoster(2026, 7, config())
    for (const row of rows) {
      expect(row.cells[15 - 1].status).toBe("HOLIDAY")
      expect(row.cells[15 - 1].note).toBe("Independence Day")
    }
  })

  it("the rotation department changes shift across ISO weeks; others never rotate", () => {
    const rows = generateRoster(2026, 7, config())
    const production = rowFor(rows, "Production")
    const shiftsAcrossWeeks = new Set(
      production.cells
        .filter((cell) => cell.source === "ROTATION")
        .map((cell) => cell.shift?.id)
    )
    expect(shiftsAcrossWeeks.size).toBeGreaterThan(1)

    const operations = rowFor(rows, "Operations")
    expect(operations.cells.every((cell) => cell.source !== "ROTATION")).toBe(true)
  })

  it("disabling the weekly-off rule turns Sundays into working days", () => {
    const noWeeklyOff = config()
    noWeeklyOff.rules.find((rule) => rule.id === "weekly-off")!.enabled = false
    const rows = generateRoster(2026, 7, noWeeklyOff)
    expect(rowFor(rows, "Operations").cells[2 - 1].status).toBe("PRESENT")
  })

  it("disabling rotation puts the rotating department on its default shift", () => {
    const noRotation = config({ rotation: { enabled: false, department: "Production", cycle: [] } })
    const rows = generateRoster(2026, 7, noRotation)
    expect(rowFor(rows, "Production").cells.every((cell) => cell.source !== "ROTATION")).toBe(true)
  })

  it("working-day count excludes offs and holidays", () => {
    const rows = generateRoster(2026, 7, config())
    for (const row of rows) {
      const offs = row.cells.filter((cell) => cell.shift === null).length
      expect(row.workingDays + offs).toBe(31)
    }
  })

  it("a declared half day stays a WORKING day with its shift, marked HALF_DAY", () => {
    const rows = generateRoster(2026, 7, config())
    const cell = rowFor(rows, "Operations").cells[20 - 1]
    expect(cell.status).toBe("PRESENT")
    expect(cell.shift).not.toBeNull()
    expect(cell.source).toBe("HALF_DAY")
    expect(cell.note).toMatch(/half working day/i)
  })

  it("covers every seeded employee", () => {
    expect(generateRoster(2026, 7, config())).toHaveLength(EMPLOYEES.length)
  })
})

describe("seedAttendanceDays identity", () => {
  it("returns the same array for the same date, so memo dependencies hold", () => {
    const first = seedAttendanceDays("2026-08-03")
    const second = seedAttendanceDays("2026-08-03")
    // Identity, not just equality — this is what downstream useMemo compares.
    expect(second).toBe(first)
  })

  it("still gives a distinct array per date", () => {
    expect(seedAttendanceDays("2026-08-04")).not.toBe(seedAttendanceDays("2026-08-03"))
  })

  it("the cached rows are the real shape, not an empty placeholder", () => {
    const rows = seedAttendanceDays("2026-08-03")
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty("employeeCode")
    expect(rows[0]).toHaveProperty("payableUnits")
  })
})
