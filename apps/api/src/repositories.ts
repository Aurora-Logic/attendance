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
