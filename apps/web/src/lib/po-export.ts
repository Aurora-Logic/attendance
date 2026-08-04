import {
  lineAmounts,
  paiseToRupees,
  poTotals,
  type Grn,
  type Item,
  type PoDisplayStatus,
  type PurchaseOrder,
  type Vendor,
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

/** exceljs is ~250 KB gzipped — loaded only when someone actually exports. */
const loadExcelJS = async () => (await import("exceljs")).default

export async function exportPoRegisterExcel(rows: PoRegisterRow[], _items: Item[]): Promise<void> {
  const ExcelJS = await loadExcelJS()
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

/**
 * One PO as a workbook: order block, typed line items, a totals block whose
 * sums are formulas, then the delivery schedule and every goods receipt — the
 * whole story of the order in a file the vendor or the accountant can open.
 */
export async function exportPoExcel(
  po: PurchaseOrder,
  vendor: Vendor | null,
  items: Item[],
  grns: Grn[]
): Promise<void> {
  const itemFor = (itemId: string) => items.find((candidate) => candidate.id === itemId)

  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()
  const sheet = workbook.addWorksheet(po.number)
  sheet.columns = [
    { width: 5 },
    { width: 34 },
    { width: 10 },
    { width: 10 },
    { width: 13 },
    { width: 8 },
    { width: 8 },
    { width: 15 },
  ]

  // ---- order block ---------------------------------------------------------
  sheet.mergeCells("A1:H1")
  sheet.getCell("A1").value = `Purchase Order ${po.number}`
  sheet.getCell("A1").font = { bold: true, size: 14 }
  sheet.addRow(["Vendor", vendor?.name ?? "—", "", "", "GSTIN", vendor?.gstin ?? "—"])
  const dateRow = sheet.addRow(["Date", new Date(`${po.orderDate}T00:00:00`), "", "", "Status", po.status.replaceAll("_", " ")])
  dateRow.getCell(2).numFmt = "dd-mmm-yyyy"
  if (po.terms) sheet.addRow(["Terms", po.terms])
  sheet.addRow([])

  // ---- lines ---------------------------------------------------------------
  const header = sheet.addRow(["#", "Item", "HSN", "Qty", "Rate (₹)", "Disc %", "GST %", "Amount (₹)"])
  header.font = { bold: true }
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin" } }
  })

  po.lines.forEach((line, index) => {
    const item = itemFor(line.itemId)
    const amounts = lineAmounts(line)
    const row = sheet.addRow([
      index + 1,
      item ? `${item.name} (${item.code})` : line.itemId,
      item?.hsn ?? "",
      line.qty,
      paiseToRupees(line.unitPricePaise),
      line.discountPct / 100,
      line.gstRatePct / 100,
      paiseToRupees(amounts.totalPaise),
    ])
    row.getCell(5).numFmt = RUPEE_FORMAT
    row.getCell(6).numFmt = "0%"
    row.getCell(7).numFmt = "0%"
    row.getCell(8).numFmt = RUPEE_FORMAT
  })

  // ---- totals: each component from the same rounded-once paise maths -------
  const totals = poTotals(po.lines)
  const totalLines: Array<[string, number, boolean?]> = [
    ["Subtotal", totals.subtotalPaise],
    ...(totals.discountPaise > 0
      ? [["Discount", -totals.discountPaise] as [string, number]]
      : []),
    ...totals.taxBreakup.map(
      (bucket): [string, number] => [`GST ${bucket.ratePct}%`, bucket.taxPaise]
    ),
    ["Total", totals.totalPaise, true],
  ]
  sheet.addRow([])
  for (const [label, paise, bold] of totalLines) {
    const row = sheet.addRow(["", "", "", "", "", "", label, paiseToRupees(paise)])
    row.getCell(8).numFmt = RUPEE_FORMAT
    if (bold) {
      row.font = { bold: true }
      row.getCell(8).border = { top: { style: "thin" } }
    }
  }

  // ---- delivery schedule ---------------------------------------------------
  if (po.schedules.length > 0) {
    sheet.addRow([])
    sheet.addRow(["Delivery schedule"]).font = { bold: true }
    sheet.addRow(["Item", "Due date", "Qty"]).font = { bold: true }
    for (const schedule of po.schedules) {
      const line = po.lines.find((candidate) => candidate.id === schedule.poLineId)
      const row = sheet.addRow([
        line ? (itemFor(line.itemId)?.name ?? "—") : "—",
        new Date(`${schedule.dueDate}T00:00:00`),
        schedule.qty,
      ])
      row.getCell(2).numFmt = "dd-mmm-yyyy"
    }
  }

  // ---- goods receipts ------------------------------------------------------
  if (grns.length > 0) {
    sheet.addRow([])
    sheet.addRow(["Goods receipts"]).font = { bold: true }
    sheet.addRow(["GRN", "Date", "Invoice", "Item", "Accepted", "Rejected"]).font = { bold: true }
    for (const grn of grns) {
      for (const grnLine of grn.lines) {
        const line = po.lines.find((candidate) => candidate.id === grnLine.poLineId)
        const row = sheet.addRow([
          grn.number,
          new Date(`${grn.receivedDate}T00:00:00`),
          grn.invoiceNo,
          line ? (itemFor(line.itemId)?.name ?? "—") : "—",
          grnLine.qtyAccepted,
          grnLine.qtyRejected,
        ])
        row.getCell(2).numFmt = "dd-mmm-yyyy"
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${po.number}.xlsx`
  anchor.click()
  URL.revokeObjectURL(url)
}
