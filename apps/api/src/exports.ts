import { mkdirSync, createReadStream, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { computeAttendanceDay, minutesToClock, type AttendanceSettings } from "@attendance/shared"

import type { Store } from "./store"
import { id } from "./store"

/**
 * §7 export worker, for real: jobs go through BullMQ on Redis, the workbook is
 * built server-side with ExcelJS (typed cells, frozen header, auto-filter,
 * SUM-formula totals) and written under .data/exports for download. The
 * request thread never builds a file.
 *
 * Disabled under vitest: no queue, no Redis connection — the enqueue function
 * reports UNAVAILABLE and tests stay hermetic.
 */

const REDIS = { host: "localhost", port: Number(process.env.REDIS_PORT ?? 6379) }
const enabled = () => process.env.NODE_ENV !== "test" && process.env.EXPORTS_QUEUE !== "0"

export interface ExportJobRecord {
  id: string
  report: "daily-register"
  params: { date: string }
  status: "QUEUED" | "RUNNING" | "READY" | "FAILED"
  filename: string
  rowCount: number
  requestedBy: string
  createdAt: string
  error?: string
}

// The registry lives on the store (and therefore in the persistence file);
// the files live next to it.
export function exportsDir(dataDir: string): string {
  const dir = join(dataDir, "exports")
  mkdirSync(dir, { recursive: true })
  return dir
}

interface ExportContext {
  store: Store
  dir: string
}

// bullmq is imported dynamically so tests (and EXPORTS_QUEUE=0 boots) never
// touch Redis at module-load time.
let queue: import("bullmq").Queue | null = null
let worker: import("bullmq").Worker | null = null

async function buildDailyRegister(
  context: ExportContext,
  job: ExportJobRecord
): Promise<number> {
  const { store } = context
  const date = job.params.date
  const settings: AttendanceSettings = store.settings

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Daily Register", { views: [{ state: "frozen", ySplit: 4 }] })
  sheet.columns = [10, 26, 14, 14, 16, 8, 8, 11, 9, 9, 9].map((width) => ({ width }))

  sheet.mergeCells("A1:K1")
  sheet.getCell("A1").value = `${store.branding.companyName} — Daily Attendance Register — ${date}`
  sheet.getCell("A1").font = { bold: true, size: 14 }
  sheet.mergeCells("A2:K2")
  sheet.getCell("A2").value = `Generated ${new Date().toLocaleString("en-IN")} (server)`
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } }
  sheet.addRow([])

  const header = sheet.addRow([
    "Code", "Employee", "Department", "Shift", "Status", "In", "Out",
    "Worked (h)", "Late (m)", "OT (m)", "Payable",
  ])
  header.font = { bold: true }
  header.eachCell((cell) => (cell.border = { bottom: { style: "thin" } }))
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 11 } }

  const isWeeklyOff = new Date(`${date}T00:00:00Z`).getUTCDay() === 0
  const holiday = store.holidays[date]

  let rows = 0
  for (const employee of store.employees) {
    const shift = store.shifts.find((candidate) => candidate.id === employee.shiftId)!
    const punches = store.punches
      .filter((punch) => punch.employeeId === employee.id && punch.businessDate === date)
      .map((punch) => ({ type: punch.type, offsetMin: punch.offsetMin }))
    const result = computeAttendanceDay({
      shift,
      dayKind: holiday ? "HOLIDAY" : isWeeklyOff ? "WEEKLY_OFF" : "WORKING",
      leave: null,
      punches,
      priorLateMarks: 0,
      settings,
    })
    const inPunch = punches.find((punch) => punch.type === "IN")
    const outPunch = [...punches].reverse().find((punch) => punch.type === "OUT")
    const row = sheet.addRow([
      employee.code,
      employee.name,
      employee.department,
      shift.name,
      result.status.replaceAll("_", " "),
      inPunch ? minutesToClock(shift.startMin + inPunch.offsetMin) : "—",
      outPunch ? minutesToClock(shift.startMin + outPunch.offsetMin) : "—",
      Number((result.workedMinutes / 60).toFixed(2)),
      result.lateMinutes,
      result.otMinutes,
      result.payableUnits,
    ])
    row.getCell(8).numFmt = "0.00"
    row.getCell(11).numFmt = "0.0"
    rows += 1
  }

  const totals = sheet.addRow(["", "", "", "", "", "", "Total", "", "", "", ""])
  totals.font = { bold: true }
  for (const column of [8, 9, 10, 11]) {
    const letter = String.fromCharCode(64 + column)
    totals.getCell(column).value = { formula: `SUM(${letter}5:${letter}${4 + rows})` }
  }
  totals.eachCell((cell) => (cell.border = { top: { style: "thin" } }))

  await workbook.xlsx.writeFile(join(context.dir, `${job.id}.xlsx`))
  return rows
}

export async function startExportWorker(store: Store, dir: string): Promise<void> {
  if (!enabled()) return
  const context: ExportContext = { store, dir }

  const { Queue, Worker } = await import("bullmq")
  queue = new Queue("exports", { connection: REDIS })
  worker = new Worker(
    "exports",
    async (bullJob) => {
      const record = store.exportJobs.find((candidate) => candidate.id === bullJob.data.id)
      if (!record) return
      record.status = "RUNNING"
      try {
        record.rowCount = await buildDailyRegister(context, record)
        record.status = "READY"
      } catch (error) {
        record.status = "FAILED"
        record.error = (error as Error).message
      }
    },
    { connection: REDIS, concurrency: 2 }
  )
  worker.on("error", (error) => console.error("export worker:", error.message))
}

export async function enqueueExport(
  store: Store,
  input: { report: "daily-register"; date: string; requestedBy: string }
): Promise<ExportJobRecord | null> {
  if (!queue) return null
  const record: ExportJobRecord = {
    id: id(store, "exp"),
    report: input.report,
    params: { date: input.date },
    status: "QUEUED",
    filename: `${store.branding.companyName.replaceAll(" ", "_")}_DailyRegister_${input.date}.xlsx`,
    rowCount: 0,
    requestedBy: input.requestedBy,
    createdAt: new Date().toISOString(),
  }
  store.exportJobs.unshift(record)
  await queue.add("export", { id: record.id }, { removeOnComplete: true, removeOnFail: true })
  return record
}

export function exportFileStream(dir: string, jobId: string) {
  const path = join(dir, `${jobId}.xlsx`)
  if (!existsSync(path)) return null
  return { stream: createReadStream(path), size: statSync(path).size }
}

export async function stopExports(): Promise<void> {
  await worker?.close()
  await queue?.close()
}
