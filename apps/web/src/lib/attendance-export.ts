import type { AttendanceDay } from "@attendance/shared"

/**
 * Daily attendance register → .xlsx per the §7 standard: typed cells, frozen
 * bold header, auto-filter, and SUM-formula totals. Client-side today; the
 * identical workbook code moves behind the BullMQ export worker in Phase 6,
 * which is also where >5k-row exports start streaming.
 */
export async function exportDailyRegisterExcel(
  rows: AttendanceDay[],
  dateLabel: string
): Promise<void> {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()
  const sheet = workbook.addWorksheet("Daily Register", {
    views: [{ state: "frozen", ySplit: 4 }],
  })
  sheet.columns = [
    { width: 10 },
    { width: 26 },
    { width: 14 },
    { width: 20 },
    { width: 16 },
    { width: 8 },
    { width: 8 },
    { width: 11 },
    { width: 9 },
    { width: 9 },
    { width: 9 },
  ]

  sheet.mergeCells("A1:K1")
  sheet.getCell("A1").value = `Daily Attendance Register — ${dateLabel}`
  sheet.getCell("A1").font = { bold: true, size: 14 }
  sheet.mergeCells("A2:K2")
  sheet.getCell("A2").value = `Generated ${new Date().toLocaleString("en-IN")}`
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } }
  sheet.addRow([])

  const header = sheet.addRow([
    "Code",
    "Employee",
    "Department",
    "Shift",
    "Status",
    "In",
    "Out",
    "Worked (h)",
    "Late (m)",
    "OT (m)",
    "Payable",
  ])
  header.font = { bold: true }
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin" } }
  })
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 11 } }

  for (const row of rows) {
    const dataRow = sheet.addRow([
      row.employeeCode,
      row.employeeName,
      row.department,
      row.shiftName ?? "—",
      row.status.replaceAll("_", " "),
      row.firstInAt ?? "—",
      row.lastOutAt ?? "—",
      Number((row.workedMinutes / 60).toFixed(2)),
      row.lateMinutes,
      row.otMinutes,
      row.payableUnits,
    ])
    dataRow.getCell(8).numFmt = "0.00"
    dataRow.getCell(11).numFmt = "0.0"
  }

  // Totals as formulas so the sheet stays verifiable, not asserted.
  const firstDataRow = 5
  const lastDataRow = 4 + rows.length
  const totals = sheet.addRow(["", "", "", "", "", "", "Total", "", "", "", ""])
  totals.font = { bold: true }
  for (const column of [8, 9, 10, 11]) {
    const letter = String.fromCharCode(64 + column)
    totals.getCell(column).value = {
      formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
    }
  }
  totals.getCell(8).numFmt = "0.00"
  totals.getCell(11).numFmt = "0.0"
  totals.eachCell((cell) => {
    cell.border = { top: { style: "thin" } }
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `Delta_DailyRegister_${dateLabel}.xlsx`
  anchor.click()
  URL.revokeObjectURL(url)
}
