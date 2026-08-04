import ExcelJS from "exceljs"
import {
  paiseToRupees,
  poTotals,
  type Item,
  type PoDisplayStatus,
  type PurchaseOrder,
} from "@attendance/shared"

/**
 * PO register → a real .xlsx per the §7 export standard: typed cells, ₹ number
 * format, bold frozen header, auto-filter, and a totals row of SUM formulas so
 * the accountant can verify rather than trust.
 *
 * Runs client-side for now. When the BullMQ export worker lands (Phase 6) this
 * moves behind /exports with the identical workbook code — the §7 rule that
 * big exports never block a request thread applies to the server, and >5k-row
 * registers will stream from there.
 */

export interface PoRegisterRow {
  po: PurchaseOrder
  vendorName: string
  displayStatus: PoDisplayStatus
  /** 0–100, derived from GRNs. */
  receiptPct: number
}

const RUPEE_FORMAT = "₹#,##0.00"

export async function exportPoRegisterExcel(rows: PoRegisterRow[], _items: Item[]): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()
  const sheet = workbook.addWorksheet("PO Register", {
    views: [{ state: "frozen", ySplit: 4 }],
  })

  // ---- title block --------------------------------------------------------
  sheet.mergeCells("A1:H1")
  sheet.getCell("A1").value = "Purchase Order Register"
  sheet.getCell("A1").font = { bold: true, size: 14 }
  sheet.mergeCells("A2:H2")
  sheet.getCell("A2").value = `Generated ${new Date().toLocaleString("en-IN")}`
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } }
  sheet.addRow([])

  // ---- header -------------------------------------------------------------
  const header = sheet.addRow([
    "PO Number",
    "Order Date",
    "Vendor",
    "Status",
    "Lines",
    "Receipt %",
    "Taxable (₹)",
    "Total (₹)",
  ])
  header.font = { bold: true }
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin" } }
  })
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 8 } }

  // ---- data — dates as dates, numbers as numbers, never text --------------
  for (const row of rows) {
    const totals = poTotals(row.po.lines)
    const dataRow = sheet.addRow([
      row.po.number,
      new Date(`${row.po.orderDate}T00:00:00`),
      row.vendorName,
      row.displayStatus.replaceAll("_", " "),
      row.po.lines.length,
      row.receiptPct / 100,
      paiseToRupees(totals.taxablePaise),
      paiseToRupees(totals.totalPaise),
    ])
    dataRow.getCell(2).numFmt = "dd-mmm-yyyy"
    dataRow.getCell(6).numFmt = "0%"
    dataRow.getCell(7).numFmt = RUPEE_FORMAT
    dataRow.getCell(8).numFmt = RUPEE_FORMAT
  }

  // ---- totals row: SUM formulas, not baked values -------------------------
  if (rows.length > 0) {
    const firstDataRow = 5
    const lastDataRow = 4 + rows.length
    const totalsRow = sheet.addRow(["", "", "", "", "", "Total", "", ""])
    totalsRow.font = { bold: true }
    totalsRow.getCell(7).value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})` }
    totalsRow.getCell(8).value = { formula: `SUM(H${firstDataRow}:H${lastDataRow})` }
    totalsRow.getCell(7).numFmt = RUPEE_FORMAT
    totalsRow.getCell(8).numFmt = RUPEE_FORMAT
    totalsRow.eachCell((cell) => {
      cell.border = { top: { style: "thin" } }
    })
  }

  sheet.columns.forEach((column, index) => {
    column.width = [14, 13, 28, 18, 7, 10, 14, 14][index] ?? 12
  })

  // ---- download -----------------------------------------------------------
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `PO_Register_${new Date().toISOString().slice(0, 7)}.xlsx`
  anchor.click()
  URL.revokeObjectURL(url)
}
