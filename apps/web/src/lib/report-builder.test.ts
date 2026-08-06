import { describe, expect, it } from "vitest"
import type { AttendanceDay } from "@attendance/shared"

import { applyReport, columnSpec, type CustomReportDef } from "./report-builder"

const day = (over: Partial<AttendanceDay>): AttendanceDay => ({
  id: "x",
  employeeId: "e1",
  employeeCode: "DLT0001",
  employeeName: "Aarav",
  department: "Operations",
  date: "2026-08-06",
  shiftName: "General",
  status: "PRESENT",
  firstInAt: "09:05",
  lastOutAt: "18:02",
  workedMinutes: 480,
  lateMinutes: 0,
  otMinutes: 0,
  flags: [],
  approvalStatus: "NOT_REQUIRED",
  halfDayReason: null,
  payableUnits: 1,
  isLocked: false,
  ...over,
})

const def = (over: Partial<CustomReportDef>): CustomReportDef => ({
  id: "r1",
  name: "Test",
  columns: ["code", "name", "lateMin"],
  statuses: [],
  departments: [],
  groupBy: "none",
  sortBy: "code",
  sortDir: "asc",
  ...over,
})

const rows: AttendanceDay[] = [
  day({ id: "1", employeeCode: "DLT0002", employeeName: "Meera", department: "HR", lateMinutes: 25, status: "PRESENT" }),
  day({ id: "2", employeeCode: "DLT0001", employeeName: "Aarav", department: "Operations", lateMinutes: 0 }),
  day({ id: "3", employeeCode: "DLT0003", employeeName: "Kabir", department: "Operations", status: "ABSENT", payableUnits: 0 }),
  day({ id: "4", employeeCode: "DLT0004", employeeName: "Sana", department: "Finance", status: "ON_LEAVE" }),
]

describe("applyReport", () => {
  it("no filters, no grouping → one bucket, sorted by the chosen column", () => {
    const groups = applyReport(rows, def({}))
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBeNull()
    expect(groups[0].rows.map((row) => row.employeeCode)).toEqual([
      "DLT0001",
      "DLT0002",
      "DLT0003",
      "DLT0004",
    ])
  })

  it("status filter keeps only matching rows", () => {
    const groups = applyReport(rows, def({ statuses: ["ABSENT", "ON_LEAVE"] }))
    expect(groups[0].rows.map((row) => row.employeeName)).toEqual(["Kabir", "Sana"])
  })

  it("department filter composes with status filter", () => {
    const groups = applyReport(
      rows,
      def({ statuses: ["PRESENT"], departments: ["Operations"] })
    )
    expect(groups[0].rows.map((row) => row.employeeName)).toEqual(["Aarav"])
  })

  it("numeric sort desc puts the latest arrival first", () => {
    const groups = applyReport(rows, def({ sortBy: "lateMin", sortDir: "desc" }))
    expect(groups[0].rows[0].employeeName).toBe("Meera")
  })

  it("groupBy department yields alphabetical buckets with the right members", () => {
    const groups = applyReport(rows, def({ groupBy: "department" }))
    expect(groups.map((group) => group.label)).toEqual(["Finance", "HR", "Operations"])
    expect(groups[2].rows.map((row) => row.employeeName)).toEqual(["Aarav", "Kabir"])
  })

  it("groupBy status humanises the enum for labels", () => {
    const groups = applyReport(rows, def({ groupBy: "status" }))
    expect(groups.map((group) => group.label)).toContain("ON LEAVE")
  })

  it("column specs compute derived values (worked hours as decimal)", () => {
    expect(columnSpec("workedH").value(day({ workedMinutes: 450 }))).toBe(7.5)
    expect(columnSpec("flags").value(day({ flags: ["LATE", "OUT_OF_GEOFENCE"] }))).toBe(
      "LATE, OUT_OF_GEOFENCE"
    )
  })
})
