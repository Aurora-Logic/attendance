import { mkdirSync, createReadStream, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import {
  computeAttendanceDay,
  countPriorLateMarks,
  datesInPeriod,
  minutesToClock,
  summarisePeriod,
  type AttendanceSettings,
  type PeriodDay,
} from "@attendance/shared"

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

export type ExportReport = "daily-register" | "payroll-handover"

export interface ExportJobRecord {
  id: string
  report: ExportReport
  /** `date` for the daily register; `from`/`to` for a period handover. */
  params: { date?: string; from?: string; to?: string }
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
  // Params are a union across report types now; a register job without a date
  // is a programming error, and failing here names it rather than producing a
  // workbook full of "undefined".
  const date = job.params.date
  if (!date) throw new Error(`Export ${job.id} is a daily register with no date.`)
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
    const shift = store.shifts.find((candidate) => candidate.id === employee.shiftId)
    if (!shift) {
      // Never skip silently — that is someone missing from the export with no
      // trace. Fail loudly naming who to fix.
      throw new Error(
        `${employee.code} (${employee.name}) references shift ${employee.shiftId}, which does not exist. Fix the employee before running this.`
      )
    }
    const punches = store.punches
      .filter((punch) => punch.employeeId === employee.id && punch.businessDate === date)
      .map((punch) => ({ type: punch.type, offsetMin: punch.offsetMin }))
    const result = computeAttendanceDay({
      shift,
      dayKind: holiday ? "HOLIDAY" : isWeeklyOff ? "WEEKLY_OFF" : "WORKING",
      leave: null,
      punches,
      priorLateMarks: countPriorLateMarks(
        store.punches.filter((punch) => punch.employeeId === employee.id),
        date,
        settings.lateGraceMinutes
      ),
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

/**
 * The payroll handover (work order Section 2).
 *
 * Payroll is not run here. This is what the people who do run it receive: one
 * row per employee for the period, with the counts salary is calculated from.
 *
 * Two properties the order asks for and this deliberately keeps:
 *
 *  - **No formulas.** Every cell is a computed value. A SUM the recipient can
 *    edit is a number nobody can trace back, and this workbook leaves our
 *    hands. The daily register writes formulas; this must not.
 *  - **One row per employee.** No merged cells in the data region, so it
 *    filters, sorts and imports cleanly.
 *
 * The period must be locked before this runs — enforced at the route, so the
 * refusal reaches the person rather than failing later inside the worker.
 */
export async function buildPayrollHandover(
  context: ExportContext,
  job: ExportJobRecord
): Promise<number> {
  const { store } = context
  const from = job.params.from!
  const to = job.params.to!
  const settings: AttendanceSettings = store.settings
  const dates = datesInPeriod(from, to)

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Payroll handover", {
    views: [{ state: "frozen", ySplit: 5 }],
  })
  sheet.columns = [12, 26, 16, 11, 10, 10, 12, 13, 11, 10, 11, 12].map((width) => ({ width }))

  // A parameter block, unmerged: what this is, for whom, over what, and when
  // it was produced. Without it a spreadsheet on somebody's desktop is
  // untraceable a week later.
  sheet.getCell("A1").value = `${store.branding.companyName} — Payroll handover`
  sheet.getCell("A1").font = { bold: true, size: 14 }
  sheet.getCell("A2").value = `Period: ${from} to ${to} (${dates.length} days)`
  sheet.getCell("A3").value = `Generated: ${new Date().toLocaleString("en-IN")} (server)`
  sheet.getCell("A4").value =
    "Attendance only. Salary, deductions and statutory amounts are calculated outside this system."
  for (const ref of ["A2", "A3", "A4"]) {
    sheet.getCell(ref).font = { size: 10, color: { argb: "FF6B7280" } }
  }

  const header = sheet.addRow([
    "Code", "Employee", "Department",
    "Present", "Half", "Absent",
    "Paid leave", "Unpaid leave", "Weekly off", "Holiday",
    "OT (h)", "Payable days",
  ])
  header.font = { bold: true }
  header.eachCell((cell) => (cell.border = { bottom: { style: "thin" } }))
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 12 } }

  let rows = 0
  for (const employee of store.employees) {
    const shift = store.shifts.find((candidate) => candidate.id === employee.shiftId)
    if (!shift) {
      // Never skip silently — that is somebody missing from a payroll run with
      // no trace at all.
      throw new Error(
        `${employee.code} (${employee.name}) references shift ${employee.shiftId}, which does not exist. Fix the employee before running this.`
      )
    }

    const days: PeriodDay[] = dates.map((date) => {
      const punches = store.punches
        .filter((punch) => punch.employeeId === employee.id && punch.businessDate === date)
        .map((punch) => ({ type: punch.type, offsetMin: punch.offsetMin }))

      // Resolved exactly as the live register does, so the handover and the
      // screen can never disagree about somebody's day.
      const approvedLeave = store.approvals.find(
        (approval) =>
          approval.kind === "LEAVE" &&
          approval.status === "APPROVED" &&
          approval.employeeId === employee.id &&
          approval.dateFrom <= date &&
          date <= approval.dateTo
      )
      const isPaidLeave = approvedLeave ? approvedLeave.leaveType !== "LOP" : undefined

      /**
       * Overtime only counts if the company says it counts.
       *
       * `otRequiresApproval` used to be read by the payroll run. Payroll left
       * with Section 2, and without this the setting would govern nothing
       * while still sitting in Settings looking as though it did — and the
       * handover would hand over overtime nobody approved.
       */
      const overtimeApproved =
        !settings.otRequiresApproval ||
        store.approvals.some(
          (approval) =>
            approval.kind === "OVERTIME" &&
            approval.status === "APPROVED" &&
            approval.employeeId === employee.id &&
            approval.dateFrom <= date &&
            date <= approval.dateTo
        )

      const isWeeklyOff = new Date(`${date}T00:00:00Z`).getUTCDay() === 0
      const result = computeAttendanceDay({
        shift,
        dayKind: store.holidays[date] ? "HOLIDAY" : isWeeklyOff ? "WEEKLY_OFF" : "WORKING",
        leave: approvedLeave
          ? { part: approvedLeave.leavePart ?? "FULL", isPaid: isPaidLeave! }
          : null,
        punches,
        priorLateMarks: countPriorLateMarks(
          store.punches.filter((punch) => punch.employeeId === employee.id),
          date,
          settings.lateGraceMinutes
        ),
        settings,
      })

      return {
        dateISO: date,
        status: result.status,
        payableUnits: result.payableUnits,
        otMinutes: overtimeApproved ? result.otMinutes : 0,
        lateMinutes: result.lateMinutes,
        leaveIsPaid: isPaidLeave,
      }
    })

    const totals = summarisePeriod(days)
    const row = sheet.addRow([
      employee.code,
      employee.name,
      employee.department,
      totals.presentDays,
      totals.halfDays,
      totals.absentDays,
      totals.paidLeaveDays,
      totals.unpaidLeaveDays,
      totals.weeklyOffDays,
      totals.holidayDays,
      totals.overtimeHours,
      totals.payableDays,
    ])
    for (const column of [5, 7, 8, 11, 12]) row.getCell(column).numFmt = "0.00"
    rows += 1
  }

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
        record.rowCount =
          record.report === "payroll-handover"
            ? await buildPayrollHandover(context, record)
            : await buildDailyRegister(context, record)
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

export type ExportRequest =
  | { report: "daily-register"; date: string; requestedBy: string }
  | { report: "payroll-handover"; from: string; to: string; requestedBy: string }

export async function enqueueExport(
  store: Store,
  input: ExportRequest
): Promise<ExportJobRecord | null> {
  if (!queue) return null
  const company = store.branding.companyName.replaceAll(" ", "_")
  const record: ExportJobRecord = {
    id: id(store, "exp"),
    report: input.report,
    params:
      input.report === "payroll-handover"
        ? { from: input.from, to: input.to }
        : { date: input.date },
    status: "QUEUED",
    filename:
      input.report === "payroll-handover"
        ? `${company}_PayrollHandover_${input.from}_to_${input.to}.xlsx`
        : `${company}_DailyRegister_${input.date}.xlsx`,
    rowCount: 0,
    requestedBy: input.requestedBy,
    createdAt: new Date().toISOString(),
  }
  // Queue first, register second. The other order left a permanently QUEUED
  // ghost job whenever Redis was unreachable: the row existed, nothing would
  // ever pick it up, and the caller got a raw 500 with no way to tell the
  // difference between "queued" and "lost".
  try {
    await queue.add("export", { id: record.id }, { removeOnComplete: true, removeOnFail: true })
  } catch (error) {
    throw new ExportQueueUnavailable((error as Error).message)
  }
  store.exportJobs.unshift(record)
  return record
}

/** Redis refused the job. The caller answers 503, and no row is written. */
export class ExportQueueUnavailable extends Error {
  constructor(detail: string) {
    super(`Export queue unavailable: ${detail}`)
    this.name = "ExportQueueUnavailable"
  }
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
