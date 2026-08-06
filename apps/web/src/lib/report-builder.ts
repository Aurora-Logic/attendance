import type { AttendanceDay, DayStatus } from "@attendance/shared"

/**
 * Custom report definitions — the user composes columns, filters, grouping and
 * sort over the attendance-day dataset, saves the definition, and runs it for
 * any date. Definitions are personal views, stored client-side (the same
 * localStorage pattern as roster config); the rows they run over are always
 * server truth when signed in with the API.
 */

export type ReportColumnKey =
  | "code"
  | "name"
  | "department"
  | "shift"
  | "status"
  | "in"
  | "out"
  | "workedH"
  | "lateMin"
  | "otMin"
  | "payable"
  | "flags"
  | "approval"

export interface ReportColumnSpec {
  key: ReportColumnKey
  label: string
  kind: "text" | "number"
  value: (row: AttendanceDay) => string | number
  /** ExcelJS number format for numeric columns. */
  numFmt?: string
}

export const REPORT_COLUMNS: ReportColumnSpec[] = [
  { key: "code", label: "Code", kind: "text", value: (row) => row.employeeCode },
  { key: "name", label: "Employee", kind: "text", value: (row) => row.employeeName },
  { key: "department", label: "Department", kind: "text", value: (row) => row.department },
  { key: "shift", label: "Shift", kind: "text", value: (row) => row.shiftName ?? "—" },
  { key: "status", label: "Status", kind: "text", value: (row) => row.status.replaceAll("_", " ") },
  { key: "in", label: "In", kind: "text", value: (row) => row.firstInAt ?? "—" },
  { key: "out", label: "Out", kind: "text", value: (row) => row.lastOutAt ?? "—" },
  {
    key: "workedH",
    label: "Worked (h)",
    kind: "number",
    value: (row) => Number((row.workedMinutes / 60).toFixed(2)),
    numFmt: "0.00",
  },
  { key: "lateMin", label: "Late (m)", kind: "number", value: (row) => row.lateMinutes },
  { key: "otMin", label: "OT (m)", kind: "number", value: (row) => row.otMinutes },
  {
    key: "payable",
    label: "Payable",
    kind: "number",
    value: (row) => row.payableUnits,
    numFmt: "0.0",
  },
  { key: "flags", label: "Flags", kind: "text", value: (row) => row.flags.join(", ") },
  {
    key: "approval",
    label: "Approval",
    kind: "text",
    value: (row) => row.approvalStatus.replaceAll("_", " "),
  },
]

export const columnSpec = (key: ReportColumnKey): ReportColumnSpec =>
  REPORT_COLUMNS.find((column) => column.key === key)!

export type ReportGroupBy = "none" | "department" | "status" | "shift"

export interface CustomReportDef {
  id: string
  name: string
  /** Ordered subset of the catalog — the report shows exactly these. */
  columns: ReportColumnKey[]
  /** Empty array = no filter on that axis. */
  statuses: DayStatus[]
  departments: string[]
  groupBy: ReportGroupBy
  sortBy: ReportColumnKey
  sortDir: "asc" | "desc"
}

export interface ReportGroup {
  /** null for the single ungrouped bucket. */
  label: string | null
  rows: AttendanceDay[]
}

/** Filter → group → sort. Pure — the UI and the Excel export both consume this. */
export function applyReport(rows: AttendanceDay[], def: CustomReportDef): ReportGroup[] {
  const filtered = rows.filter(
    (row) =>
      (def.statuses.length === 0 || def.statuses.includes(row.status)) &&
      (def.departments.length === 0 || def.departments.includes(row.department))
  )

  const sortSpec = columnSpec(def.sortBy)
  const direction = def.sortDir === "desc" ? -1 : 1
  const sorted = [...filtered].sort((a, b) => {
    const left = sortSpec.value(a)
    const right = sortSpec.value(b)
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction
    return String(left).localeCompare(String(right)) * direction
  })

  if (def.groupBy === "none") return [{ label: null, rows: sorted }]

  const keyOf = (row: AttendanceDay): string =>
    def.groupBy === "department"
      ? row.department
      : def.groupBy === "shift"
        ? (row.shiftName ?? "—")
        : row.status.replaceAll("_", " ")

  const buckets = new Map<string, AttendanceDay[]>()
  for (const row of sorted) {
    const key = keyOf(row)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, groupRows]) => ({ label, rows: groupRows }))
}

// ---- persistence -----------------------------------------------------------

const STORAGE_KEY = "attendance.custom-reports.v1"

export function loadReportDefs(): CustomReportDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CustomReportDef[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveReportDef(def: CustomReportDef): CustomReportDef[] {
  const defs = loadReportDefs()
  const index = defs.findIndex((candidate) => candidate.id === def.id)
  if (index >= 0) defs[index] = def
  else defs.push(def)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defs))
  return defs
}

export function deleteReportDef(defId: string): CustomReportDef[] {
  const defs = loadReportDefs().filter((candidate) => candidate.id !== defId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defs))
  return defs
}

// ---- Excel export ----------------------------------------------------------

/**
 * Same workbook standards as every other export: typed cells, frozen header,
 * auto-filter, totals as SUM formulas. Group sections carry their own subtotal
 * row. exceljs stays a dynamic import so the route chunk never bundles it.
 */
export async function exportCustomReportExcel(
  def: CustomReportDef,
  groups: ReportGroup[],
  dateISO: string,
  companyName: string
): Promise<void> {
  const { Workbook } = await import("exceljs")
  const workbook = new Workbook()
  const sheet = workbook.addWorksheet(def.name.slice(0, 28) || "Report", {
    views: [{ state: "frozen", ySplit: 4 }],
  })
  const columns = def.columns.map(columnSpec)
  sheet.columns = columns.map((column) => ({
    width: column.key === "name" ? 26 : column.kind === "number" ? 11 : 14,
  }))

  const lastColumn = String.fromCharCode(64 + columns.length)
  sheet.mergeCells(`A1:${lastColumn}1`)
  sheet.getCell("A1").value = `${companyName} — ${def.name} — ${dateISO}`
  sheet.getCell("A1").font = { bold: true, size: 14 }
  sheet.mergeCells(`A2:${lastColumn}2`)
  sheet.getCell("A2").value = `Custom report · generated ${new Date().toLocaleString("en-IN")}`
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } }
  sheet.addRow([])

  const header = sheet.addRow(columns.map((column) => column.label))
  header.font = { bold: true }
  header.eachCell((cell) => (cell.border = { bottom: { style: "thin" } }))
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } }

  const numericIndexes = columns
    .map((column, index) => (column.kind === "number" ? index + 1 : null))
    .filter((index): index is number => index !== null)

  const grandRanges: string[][] = numericIndexes.map(() => [])
  for (const group of groups) {
    if (group.label !== null) {
      const section = sheet.addRow([`${group.label} (${group.rows.length})`])
      section.font = { bold: true }
      sheet.mergeCells(`A${section.number}:${lastColumn}${section.number}`)
    }
    const firstDataRow = sheet.rowCount + 1
    for (const row of group.rows) {
      const added = sheet.addRow(columns.map((column) => column.value(row)))
      columns.forEach((column, index) => {
        if (column.numFmt) added.getCell(index + 1).numFmt = column.numFmt
      })
    }
    const lastDataRow = sheet.rowCount
    if (group.label !== null && group.rows.length > 0 && numericIndexes.length > 0) {
      const subtotal = sheet.addRow([])
      subtotal.font = { bold: true }
      subtotal.getCell(1).value = "Subtotal"
      numericIndexes.forEach((columnIndex, position) => {
        const letter = String.fromCharCode(64 + columnIndex)
        subtotal.getCell(columnIndex).value = {
          formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
        }
        grandRanges[position].push(`${letter}${firstDataRow}:${letter}${lastDataRow}`)
      })
    } else if (group.label === null) {
      numericIndexes.forEach((columnIndex, position) => {
        const letter = String.fromCharCode(64 + columnIndex)
        grandRanges[position].push(`${letter}${firstDataRow}:${letter}${lastDataRow}`)
      })
    }
  }

  if (numericIndexes.length > 0 && groups.some((group) => group.rows.length > 0)) {
    const total = sheet.addRow([])
    total.font = { bold: true }
    total.getCell(1).value = "Total"
    numericIndexes.forEach((columnIndex, position) => {
      if (grandRanges[position].length === 0) return
      total.getCell(columnIndex).value = {
        formula: grandRanges[position].map((range) => `SUM(${range})`).join("+"),
      }
    })
    total.eachCell((cell) => (cell.border = { top: { style: "thin" } }))
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${companyName.replaceAll(" ", "_")}_${def.name.replaceAll(" ", "_")}_${dateISO}.xlsx`
  anchor.click()
  URL.revokeObjectURL(url)
}
