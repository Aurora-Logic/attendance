import { prisma } from "./db"

/**
 * First real repositories. Departments and calendar days live in Postgres
 * (not the JSON store) — the pattern every remaining entity follows: a thin
 * module the routes call, returning plain shapes, so nothing above it knows
 * which storage answered.
 *
 * `null` means "database unavailable"; routes turn that into 503 rather than
 * pretending an empty list is the truth.
 */

const COMPANY_ID = "co_delta"
const CALENDAR_ID = "cal_default"

export interface DepartmentRow {
  id: string
  code: string
  name: string
  isActive: boolean
  sortOrder: number
}

export async function listDepartments(): Promise<DepartmentRow[] | null> {
  const db = prisma()
  if (!db) return null
  const rows = await db.department.findMany({
    where: { companyId: COMPANY_ID },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })
  return rows.map(({ id, code, name, isActive, sortOrder }) => ({
    id,
    code,
    name,
    isActive,
    sortOrder,
  }))
}

export async function createDepartment(input: {
  code: string
  name: string
}): Promise<DepartmentRow> {
  const db = prisma()
  if (!db) throw new Error("DB_UNAVAILABLE")
  const count = await db.department.count({ where: { companyId: COMPANY_ID } })
  const row = await db.department.create({
    data: {
      companyId: COMPANY_ID,
      code: input.code.toUpperCase(),
      name: input.name,
      sortOrder: count,
    },
  })
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  }
}

export async function updateDepartment(
  id: string,
  patch: { name?: string; code?: string; isActive?: boolean }
): Promise<DepartmentRow> {
  const db = prisma()
  if (!db) throw new Error("DB_UNAVAILABLE")
  const row = await db.department.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.code !== undefined ? { code: patch.code.toUpperCase() } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    },
  })
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  }
}

/* ------------------------------------------------------------ calendar days */

export type CalendarDayType = "HOLIDAY" | "HALF_DAY"

export interface CalendarDayRow {
  date: string
  name: string
  type: CalendarDayType
}

async function ensureCalendar(db: NonNullable<ReturnType<typeof prisma>>) {
  await db.holidayCalendar.upsert({
    where: { id: CALENDAR_ID },
    update: {},
    create: { id: CALENDAR_ID, companyId: COMPANY_ID, name: "Company calendar" },
  })
}

const toISO = (date: Date) => date.toISOString().slice(0, 10)

export async function listCalendarDays(): Promise<CalendarDayRow[] | null> {
  const db = prisma()
  if (!db) return null
  await ensureCalendar(db)
  const rows = await db.holiday.findMany({
    where: { calendarId: CALENDAR_ID },
    orderBy: { date: "asc" },
  })
  return rows.map((row) => ({
    date: toISO(row.date),
    name: row.name,
    type: row.type as CalendarDayType,
  }))
}

/** Idempotent by date: re-declaring a date replaces what was there. */
export async function setCalendarDay(input: CalendarDayRow): Promise<CalendarDayRow> {
  const db = prisma()
  if (!db) throw new Error("DB_UNAVAILABLE")
  await ensureCalendar(db)
  const date = new Date(`${input.date}T00:00:00Z`)
  const row = await db.holiday.upsert({
    where: { calendarId_date: { calendarId: CALENDAR_ID, date } },
    update: { name: input.name, type: input.type },
    create: { calendarId: CALENDAR_ID, date, name: input.name, type: input.type },
  })
  return { date: toISO(row.date), name: row.name, type: row.type as CalendarDayType }
}

export async function clearCalendarDay(dateISO: string): Promise<void> {
  const db = prisma()
  if (!db) throw new Error("DB_UNAVAILABLE")
  await db.holiday
    .delete({
      where: {
        calendarId_date: { calendarId: CALENDAR_ID, date: new Date(`${dateISO}T00:00:00Z`) },
      },
    })
    .catch(() => {
      // Already absent — clearing a non-declared day is a no-op, not an error.
    })
}

/* ------------------------------------------------- attendance write-through */

/**
 * Punches, approvals and ledger entries dual-write: the store answers requests
 * (fast, synchronous), Postgres is the durable record, and boot hydration
 * makes Postgres the source of truth across restarts. Writes are
 * fire-and-forget like the audit log — a DB outage never fails a punch.
 *
 * Selfie data URLs deliberately do NOT go to Postgres (§1: images never in the
 * DB); they stay in the store file until MinIO object storage lands.
 */

import type { LedgerRow, Store, StoredApproval, StoredPunch } from "./store"

const fire = (label: string, work: () => Promise<unknown>) => {
  void work().catch((error) => console.error(`${label}:`, (error as Error).message))
}

export function persistPunch(punch: StoredPunch): void {
  const db = prisma()
  if (!db) return
  fire("persist punch", () =>
    db.punch.create({
      data: {
        id: punch.id,
        companyId: COMPANY_ID,
        employeeId: punch.employeeId,
        type: punch.type,
        at: new Date(`${punch.at}:00`),
        resolvedDate: new Date(`${punch.businessDate}T00:00:00Z`),
        offsetMin: punch.offsetMin,
        lat: punch.lat,
        lng: punch.lng,
        accuracyM: punch.accuracyM,
        dayPart: punch.dayPart,
        flags: punch.flags,
        idempotencyKey: punch.idempotencyKey,
        syncDeltaSec: punch.syncDeltaSec,
      },
    })
  )
}

export function persistApproval(approval: StoredApproval): void {
  const db = prisma()
  if (!db) return
  fire("persist approval", () =>
    db.approvalRequest.create({
      data: {
        id: approval.id,
        companyId: COMPANY_ID,
        kind: approval.kind,
        employeeId: approval.employeeId,
        subject: approval.subject,
        detail: approval.detail,
        dateFrom: new Date(`${approval.dateFrom}T00:00:00Z`),
        dateTo: new Date(`${approval.dateTo}T00:00:00Z`),
        units: approval.units,
        status: approval.status,
        level: approval.level,
        // The model has no createdAt/leaveType columns; they ride in metaJson
        // so hydration can round-trip the store shape exactly.
        metaJson: {
          createdAt: approval.createdAt,
          leaveType: approval.leaveType ?? null,
          leavePart: approval.leavePart ?? null,
        },
      },
    })
  )
}

export function persistApprovalDecision(approval: StoredApproval): void {
  const db = prisma()
  if (!db) return
  fire("persist decision", () =>
    db.approvalRequest.update({
      where: { id: approval.id },
      data: { status: approval.status },
    })
  )
}

export function persistLedgerEntry(entry: LedgerRow): void {
  const db = prisma()
  if (!db) return
  fire("persist ledger", () =>
    db.leaveLedgerEntry.create({
      data: {
        id: entry.id,
        companyId: COMPANY_ID,
        employeeId: entry.employeeId,
        typeCode: entry.type,
        txnType: entry.txnType,
        units: entry.units,
        date: new Date(`${entry.date}T00:00:00Z`),
        remarks: entry.remarks,
      },
    })
  )
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10)
const clockOf = (value: Date) =>
  `${dateOnly(value)}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`

/**
 * Boot hydration: Postgres rows replace the JSON file's copy of attendance
 * truth. The file keeps carrying what has no table yet (procurement, sales,
 * branding extras).
 */
export async function hydrateFromDb(store: Store): Promise<{
  punches: number
  approvals: number
  ledger: number
} | null> {
  const db = prisma()
  if (!db) return null

  // One-time backfill: rows that predate the write-through exist only in the
  // JSON file. An empty table with a non-empty store means this is that first
  // boot — copy the history in before reading it back.
  if ((await db.punch.count()) === 0 && store.punches.length > 0) {
    await db.punch.createMany({
      skipDuplicates: true,
      data: store.punches.map((punch) => ({
        id: punch.id,
        companyId: COMPANY_ID,
        employeeId: punch.employeeId,
        type: punch.type,
        at: new Date(`${punch.at}:00`),
        resolvedDate: new Date(`${punch.businessDate}T00:00:00Z`),
        offsetMin: punch.offsetMin,
        lat: punch.lat,
        lng: punch.lng,
        accuracyM: punch.accuracyM,
        dayPart: punch.dayPart,
        flags: punch.flags,
        idempotencyKey: punch.idempotencyKey,
        syncDeltaSec: punch.syncDeltaSec,
      })),
    })
  }
  if ((await db.approvalRequest.count()) === 0 && store.approvals.length > 0) {
    await db.approvalRequest.createMany({
      skipDuplicates: true,
      data: store.approvals.map((approval) => ({
        id: approval.id,
        companyId: COMPANY_ID,
        kind: approval.kind,
        employeeId: approval.employeeId,
        subject: approval.subject,
        detail: approval.detail,
        dateFrom: new Date(`${approval.dateFrom}T00:00:00Z`),
        dateTo: new Date(`${approval.dateTo}T00:00:00Z`),
        units: approval.units,
        status: approval.status,
        level: approval.level,
        metaJson: {
          createdAt: approval.createdAt,
          leaveType: approval.leaveType ?? null,
          leavePart: approval.leavePart ?? null,
        },
      })),
    })
  }
  if ((await db.leaveLedgerEntry.count()) === 0 && store.ledger.length > 0) {
    await db.leaveLedgerEntry.createMany({
      skipDuplicates: true,
      data: store.ledger.map((entry) => ({
        id: entry.id,
        companyId: COMPANY_ID,
        employeeId: entry.employeeId,
        typeCode: entry.type,
        txnType: entry.txnType,
        units: entry.units,
        date: new Date(`${entry.date}T00:00:00Z`),
        remarks: entry.remarks,
      })),
    })
  }

  const [punches, approvals, ledger] = await Promise.all([
    db.punch.findMany({ orderBy: { at: "asc" } }),
    db.approvalRequest.findMany(),
    db.leaveLedgerEntry.findMany({ orderBy: { date: "asc" } }),
  ])

  if (punches.length > 0) {
    // Selfies live only in the store file — merge them back onto DB rows.
    const selfies = new Map(
      store.punches.map((punch) => [punch.id, { thumb: punch.selfieThumb, view: punch.selfieView }])
    )
    store.punches = punches.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      type: row.type,
      businessDate: dateOnly(row.resolvedDate),
      offsetMin: row.offsetMin,
      at: clockOf(row.at),
      lat: row.lat ?? undefined,
      lng: row.lng ?? undefined,
      accuracyM: row.accuracyM ?? 0,
      dayPart: row.dayPart as StoredPunch["dayPart"],
      flags: row.flags as StoredPunch["flags"],
      idempotencyKey: row.idempotencyKey,
      selfieThumb: selfies.get(row.id)?.thumb,
      selfieView: selfies.get(row.id)?.view,
      syncDeltaSec: row.syncDeltaSec ?? undefined,
    }))
  }

  if (approvals.length > 0) {
    store.approvals = approvals.map((row) => {
      const meta = (row.metaJson ?? {}) as {
        createdAt?: string
        leaveType?: string | null
        leavePart?: StoredApproval["leavePart"] | null
      }
      return {
        id: row.id,
        kind: row.kind as StoredApproval["kind"],
        employeeId: row.employeeId,
        subject: row.subject,
        detail: row.detail,
        dateFrom: dateOnly(row.dateFrom),
        dateTo: dateOnly(row.dateTo),
        units: row.units,
        status: row.status as StoredApproval["status"],
        level: row.level as 1 | 2,
        createdAt: meta.createdAt ?? row.dateFrom.toISOString(),
        leaveType: meta.leaveType ?? undefined,
        leavePart: meta.leavePart ?? undefined,
      }
    })
  }

  if (ledger.length > 0) {
    store.ledger = ledger.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      type: row.typeCode,
      txnType: row.txnType as LedgerRow["txnType"],
      units: row.units,
      date: dateOnly(row.date),
      remarks: row.remarks,
    }))
  }

  return { punches: punches.length, approvals: approvals.length, ledger: ledger.length }
}
