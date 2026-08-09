import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { buildPayrollHandover, type ExportJobRecord } from "../src/exports"
import { seedStore, type Store } from "../src/store"

/**
 * The workbook itself, not the route.
 *
 * Work order Section 2 asks for a locked period, no editable formulas and one
 * row per employee. Only the produced file can show whether that is true, so
 * this builds a real xlsx and reads it back.
 */

let dir: string
let store: Store

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "handover-"))
  store = seedStore()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const job: ExportJobRecord = {
  id: "exp_test",
  report: "payroll-handover",
  params: { from: "2026-08-01", to: "2026-08-31" },
  status: "RUNNING",
  filename: "handover.xlsx",
  rowCount: 0,
  requestedBy: "u1",
  createdAt: "2026-09-01T00:00:00.000Z",
}

const read = async () => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(join(dir, "exp_test.xlsx"))
  return workbook.getWorksheet("Payroll handover")!
}

describe("buildPayrollHandover", () => {
  it("writes one row per employee and no more", async () => {
    const rows = await buildPayrollHandover({ store, dir }, job)
    expect(rows).toBe(store.employees.length)

    const sheet = await read()
    // 4 parameter lines + 1 header + one row each. No totals row: a total is a
    // formula, and this file must not carry one.
    expect(sheet.rowCount).toBe(5 + store.employees.length)
  })

  it("contains no formulas at all", async () => {
    // A SUM the recipient can edit is a number nobody can trace back, and this
    // workbook leaves our hands.
    await buildPayrollHandover({ store, dir }, job)
    const sheet = await read()

    const formulas: string[] = []
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        const value = cell.value as { formula?: string } | null
        if (value && typeof value === "object" && "formula" in value) {
          formulas.push(`R${rowNumber}C${colNumber}: ${value.formula}`)
        }
      })
    })
    expect(formulas).toEqual([])
  })

  it("carries a parameter block naming the period and when it was produced", async () => {
    // A spreadsheet on somebody's desktop is untraceable a week later without
    // this.
    await buildPayrollHandover({ store, dir }, job)
    const sheet = await read()
    expect(String(sheet.getCell("A2").value)).toContain("2026-08-01 to 2026-08-31")
    expect(String(sheet.getCell("A3").value)).toContain("Generated")
    expect(String(sheet.getCell("A4").value)).toContain("calculated outside this system")
  })

  it("uses no merged cells, so it filters and imports cleanly", async () => {
    await buildPayrollHandover({ store, dir }, job)
    const sheet = await read()
    // exceljs exposes merges as a map; the register merges its title, this must not.
    const merges = (sheet as unknown as { _merges?: Record<string, unknown> })._merges ?? {}
    expect(Object.keys(merges)).toEqual([])
  })

  it("carries every column payroll needs to compute a salary", async () => {
    await buildPayrollHandover({ store, dir }, job)
    const sheet = await read()
    const header = (sheet.getRow(5).values as unknown[]).slice(1).map(String)
    expect(header).toEqual([
      "Code",
      "Employee",
      "Department",
      "Present",
      "Half",
      "Absent",
      "Paid leave",
      "Unpaid leave",
      "Weekly off",
      "Holiday",
      "OT (h)",
      "Payable days",
    ])
  })

  it("every row's day buckets add up to the days in the period", async () => {
    // A row that does not reconcile is worse than no row: somebody pays
    // against it.
    await buildPayrollHandover({ store, dir }, job)
    const sheet = await read()
    const daysInAugust = 31

    for (let rowNumber = 6; rowNumber <= sheet.rowCount; rowNumber++) {
      const cells = sheet.getRow(rowNumber).values as unknown[]
      const [present, half, absent, paid, unpaid, weeklyOff, holiday] = cells
        .slice(4, 11)
        .map((value) => Number(value ?? 0))
      const counted = present + half + absent + paid + unpaid + weeklyOff + holiday
      expect(counted, `row ${rowNumber} (${String(cells[2])})`).toBeCloseTo(daysInAugust, 2)
    }
  })

  it("refuses to skip an employee whose shift is missing", async () => {
    // Silently dropping them means somebody is absent from payroll entirely.
    store.employees[0].shiftId = "ghost-shift"
    await expect(buildPayrollHandover({ store, dir }, job)).rejects.toThrow(/ghost-shift/)
  })
})

describe("overtime in the handover is only what was approved", () => {
  /**
   * `otRequiresApproval` was read by the payroll run, and payroll left with
   * Section 2. Without carrying the rule across, the setting would still sit in
   * Settings governing nothing, and this file would hand over overtime nobody
   * agreed to pay for.
   */
  const workedLate = (employeeId: string, date: string) => {
    const shift = store.shifts.find((candidate) => candidate.id === "gen")!
    store.punches.push(
      {
        id: `p_in_${date}`,
        employeeId,
        type: "IN",
        businessDate: date,
        offsetMin: 0,
        at: `${date}T09:00:00.000Z`,
        accuracyM: 5,
        dayPart: "FULL",
        flags: [],
        idempotencyKey: `k_in_${date}`,
      },
      {
        id: `p_out_${date}`,
        employeeId,
        type: "OUT",
        businessDate: date,
        // Three hours past the end of the shift.
        offsetMin: shift.endMin - shift.startMin + 180,
        at: `${date}T21:00:00.000Z`,
        accuracyM: 5,
        dayPart: "FULL",
        flags: [],
        idempotencyKey: `k_out_${date}`,
      }
    )
  }

  const otHoursFor = async (code: string) => {
    await buildPayrollHandover({ store, dir }, job)
    const sheet = await read()
    for (let row = 6; row <= sheet.rowCount; row++) {
      const cells = sheet.getRow(row).values as unknown[]
      if (String(cells[1]) === code) return Number(cells[11] ?? 0)
    }
    throw new Error(`${code} is not in the handover at all`)
  }

  it("leaves unapproved overtime out when approval is required", async () => {
    store.settings.otRequiresApproval = true
    workedLate("e4", "2026-08-05")
    expect(await otHoursFor("DLT0004")).toBe(0)
  })

  it("includes it once an approval covers the day", async () => {
    store.settings.otRequiresApproval = true
    workedLate("e4", "2026-08-05")
    store.approvals.push({
      id: "req_ot",
      kind: "OVERTIME",
      employeeId: "e4",
      subject: "OT",
      detail: "",
      dateFrom: "2026-08-05",
      dateTo: "2026-08-05",
      units: 3,
      status: "APPROVED",
      level: 1,
      createdAt: "2026-08-05T21:05:00.000Z",
    })
    expect(await otHoursFor("DLT0004")).toBeGreaterThan(0)
  })

  it("includes it without an approval when the company does not require one", async () => {
    store.settings.otRequiresApproval = false
    workedLate("e4", "2026-08-05")
    expect(await otHoursFor("DLT0004")).toBeGreaterThan(0)
  })

  it("a pending approval is not an approval", async () => {
    store.settings.otRequiresApproval = true
    workedLate("e4", "2026-08-05")
    store.approvals.push({
      id: "req_ot_pending",
      kind: "OVERTIME",
      employeeId: "e4",
      subject: "OT",
      detail: "",
      dateFrom: "2026-08-05",
      dateTo: "2026-08-05",
      units: 3,
      status: "PENDING",
      level: 1,
      createdAt: "2026-08-05T21:05:00.000Z",
    })
    expect(await otHoursFor("DLT0004")).toBe(0)
  })
})
