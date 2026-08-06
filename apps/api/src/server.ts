import cookie from "@fastify/cookie"
import rateLimit from "@fastify/rate-limit"
import cors from "@fastify/cors"
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify"
import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"
import * as z from "zod"
import {
  attendanceSettingsSchema,
  checkGeofence,
  computeAttendanceDay,
  countLeaveUnits,
  evaluateLate,
  minutesToClock,
  offsetFromShiftStart,
  punchWindowFlag,
  reduceLedger,
  resolveBusinessDate,
  scopeSchema,
  type PunchFlag,
  type Role,
  type Scope,
} from "@attendance/shared"

import { auditPage, prisma, recordAudit } from "./db"
import { computeRunItems } from "./payroll"
import { enqueueExport, exportFileStream } from "./exports"
import {
  clearCalendarDay,
  createDepartment,
  listCalendarDays,
  listDepartments,
  persistApproval,
  persistApprovalDecision,
  persistLedgerEntry,
  persistPunch,
  setCalendarDay,
  updateDepartment,
  type CalendarDayRow,
} from "./repositories"
import { registerProcurementRoutes } from "./procurement"
import { registerOpsRoutes } from "./ops"
import { registerSalesRoutes } from "./sales"
import { id, seedStore, type Store, type StoredEmployee } from "./store"

const ACCESS_TTL_SEC = 15 * 60
const REFRESH_TTL_SEC = 30 * 24 * 3600
const SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-only-secret-change-me"

interface AuthContext {
  userId: string
  role: Role
  employeeId: string
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext
  }
}

const credentialsSchema = z.object({ email: z.email(), password: z.string().min(1) })

const punchBodySchema = z.object({
  employeeId: z.string(),
  type: z.enum(["IN", "OUT", "BREAK_OUT", "BREAK_IN"]),
  /** Local wall time — "2026-08-04T09:05". Server time takes over in Phase 3. */
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  lat: z.number().optional(),
  lng: z.number().optional(),
  accuracyM: z.number().nonnegative().default(0),
  dayPart: z.enum(["FULL", "FIRST_HALF", "SECOND_HALF"]).default("FULL"),
  idempotencyKey: z.string().min(8),
  /** ~4 KB and ~40 KB WebP targets; the caps stop a raw camera frame sneaking in. */
  selfieThumb: z.string().startsWith("data:image/").max(30_000).optional(),
  selfieView: z.string().startsWith("data:image/").max(160_000).optional(),
  /** True when replayed from the device's IndexedDB queue after reconnect. */
  queuedOffline: z.boolean().default(false),
})

const leaveApplySchema = z.object({
  type: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  part: z.enum(["FULL", "FIRST_HALF", "SECOND_HALF"]).default("FULL"),
  reason: z.string().default(""),
})

const decideSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  remarks: z.string().default(""),
})

const departmentSchema = z.object({
  code: z.string().min(2).max(8).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only."),
  name: z.string().min(2).max(60),
})

const calendarDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(60),
  type: z.enum(["HOLIDAY", "HALF_DAY"]),
})

const brandingSchema = z.object({
  companyName: z.string().min(1).max(80),
  logoDataUrl: z.string().startsWith("data:image/").max(300_000).nullable(),
  address: z.string().max(300).default(""),
  gstin: z.string().max(15).default(""),
  phone: z.string().max(20).default(""),
  email: z.string().max(120).default(""),
})

/** Does the actor's scope reach this employee? VIEW is read-only reach-all. */
function scopeReaches(
  scope: Scope,
  target: StoredEmployee,
  actor: AuthContext,
  forWrite: boolean
): boolean {
  switch (scope) {
    case "ALL":
      return true
    case "VIEW":
      return !forWrite
    case "OWN_BRANCH":
      return true // single-branch seed; branch check lands with Prisma
    case "OWN_TEAM":
      return target.managerId === actor.employeeId || target.id === actor.employeeId
    case "SELF":
      return target.id === actor.employeeId
    case "NONE":
      return false
  }
}

export function buildServer(store: Store = seedStore(), options: { exportsDir?: string } = {}) {
  const app = Fastify({ logger: false })

  app.register(cors, { origin: true, credentials: true })
  app.register(cookie)
  // §8.6: global ceiling; auth and punch carry tighter per-route limits below.
  app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" })

  const sign = (payload: AuthContext, ttlSec: number) =>
    jwt.sign(payload, SECRET, { expiresIn: ttlSec })

  const setAuthCookies = (reply: FastifyReply, auth: AuthContext) => {
    const base = { path: "/", httpOnly: true, sameSite: "lax" as const }
    reply.setCookie("access_token", sign(auth, ACCESS_TTL_SEC), { ...base, maxAge: ACCESS_TTL_SEC })
    reply.setCookie("refresh_token", sign(auth, REFRESH_TTL_SEC), { ...base, maxAge: REFRESH_TTL_SEC })
  }

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const bearer = request.headers.authorization?.replace(/^Bearer /, "")
    const token = request.cookies.access_token ?? bearer
    if (!token) return reply.code(401).send({ error: "UNAUTHENTICATED" })
    try {
      const payload = jwt.verify(token, SECRET) as AuthContext
      request.auth = { userId: payload.userId, role: payload.role, employeeId: payload.employeeId }
    } catch {
      return reply.code(401).send({ error: "TOKEN_INVALID" })
    }
  }

  /** §2: capability + reach, resolved through the matrix — never a role name. */
  const requirePermission =
    (key: string, options: { write?: boolean } = {}) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scope = store.matrix[key]?.[request.auth.role] ?? "NONE"
      if (scope === "NONE") return reply.code(403).send({ error: "FORBIDDEN", permission: key })
      if (options.write && scope === "VIEW")
        return reply.code(403).send({ error: "READ_ONLY", permission: key })
    }

  const employeeById = (employeeId: string) =>
    store.employees.find((employee) => employee.id === employeeId)

  // Postgres is the source of truth for declared days; this cache keeps the
  // synchronous day-computation path fast and is refreshed on every write.
  // Seeded from the store so the calendar is never empty when Postgres is
  // absent (tests, or a DB outage) — declared days degrade to the last known
  // set rather than silently turning every holiday into a working day.
  let calendarDays: Record<string, CalendarDayRow> = Object.fromEntries(
    Object.entries(store.holidays).map(([date, name]) => [
      date,
      { date, name, type: "HOLIDAY" as const },
    ])
  )
  const refreshCalendar = async () => {
    const rows = await listCalendarDays().catch(() => null)
    if (!rows) return
    calendarDays = Object.fromEntries(rows.map((row) => [row.date, row]))
    // Keep the legacy store map in step for anything still reading it.
    store.holidays = Object.fromEntries(
      rows.filter((row) => row.type === "HOLIDAY").map((row) => [row.date, row.name])
    )
  }
  void refreshCalendar()

  const dayTypeFor = (date: string) => calendarDays[date]?.type ?? null

  const calendar = {
    isHoliday: (date: string) => dayTypeFor(date) === "HOLIDAY",
    isWeeklyOff: (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0,
  }

  const balancesFor = (employeeId: string) =>
    reduceLedger(
      store.ledger
        .filter((row) => row.employeeId === employeeId)
        .map((row) => ({ type: row.type, units: row.units }))
    )

  const priorLateMarks = (employeeId: string, month: string) =>
    store.punches.filter(
      (punch) =>
        punch.employeeId === employeeId &&
        punch.type === "IN" &&
        punch.businessDate.startsWith(month) &&
        punch.offsetMin > store.settings.lateGraceMinutes
    ).length

  // ---- health -------------------------------------------------------------
  app.get("/health", async () => ({ ok: true, uptimeSec: Math.round(process.uptime()) }))

  // ---- auth ---------------------------------------------------------------
  // §8.6 account lockout: 5 failures locks the email for 15 minutes. Tracked
  // per identifier (not per IP) so a distributed guesser still locks out, and
  // cleared on success.
  const failedLogins = new Map<string, { count: number; lockedUntil: number }>()
  const LOCK_AFTER = 5
  const LOCK_MS = 15 * 60 * 1000

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      const email = parsed.data.email.toLowerCase()

      const lock = failedLogins.get(email)
      if (lock && lock.lockedUntil > Date.now()) {
        return reply.code(423).send({
          error: "ACCOUNT_LOCKED",
          retryAfterSec: Math.ceil((lock.lockedUntil - Date.now()) / 1000),
        })
      }

      const user = store.users.find((candidate) => candidate.email === email)
      if (!user || !bcrypt.compareSync(parsed.data.password, user.passwordHash)) {
        const next = { count: (lock?.count ?? 0) + 1, lockedUntil: 0 }
        if (next.count >= LOCK_AFTER) {
          next.lockedUntil = Date.now() + LOCK_MS
          next.count = 0
          recordAudit({
            actorId: "system",
            action: "auth.lockout",
            entity: "users",
            entityId: email,
            ip: request.ip,
          })
        }
        failedLogins.set(email, next)
        return reply.code(401).send({ error: "INVALID_CREDENTIALS" })
      }

      failedLogins.delete(email)
      const auth: AuthContext = { userId: user.id, role: user.role, employeeId: user.employeeId }
      setAuthCookies(reply, auth)
      return {
        user: { id: user.id, name: user.name, email: user.email, role: user.role, employeeId: user.employeeId },
      }
    }
  )

  app.post("/auth/refresh", async (request, reply) => {
    const token = request.cookies.refresh_token
    if (!token) return reply.code(401).send({ error: "UNAUTHENTICATED" })
    try {
      const payload = jwt.verify(token, SECRET) as AuthContext
      const auth = { userId: payload.userId, role: payload.role, employeeId: payload.employeeId }
      setAuthCookies(reply, auth)
      return { ok: true }
    } catch {
      return reply.code(401).send({ error: "TOKEN_INVALID" })
    }
  })

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie("access_token", { path: "/" })
    reply.clearCookie("refresh_token", { path: "/" })
    return { ok: true }
  })

  app.get("/auth/me", { preHandler: [authenticate] }, async (request, reply) => {
    const user = store.users.find((candidate) => candidate.id === request.auth.userId)
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" })
    // Never serialise the credential — §11: no field a role isn't permitted
    // to see leaves the API, and nobody is permitted to see this one.
    const { passwordHash: _, ...safeUser } = user
    const permissions = Object.fromEntries(
      Object.entries(store.matrix).map(([key, grants]) => [key, grants[request.auth.role]])
    )
    return { user: safeUser, permissions, branding: store.branding }
  })

  // ---- employees ----------------------------------------------------------
  app.get(
    "/employees",
    { preHandler: [authenticate, requirePermission("employee.manage")] },
    async () => ({
      employees: store.employees.map((employee) => ({
        ...employee,
        shiftName:
          store.shifts.find((shift) => shift.id === employee.shiftId)?.name ?? employee.shiftId,
        managerName:
          store.employees.find((candidate) => candidate.id === employee.managerId)?.name ?? null,
      })),
    })
  )

  const employeeCreateSchema = z.object({
    code: z.string().min(3),
    name: z.string().min(2),
    email: z.email(),
    department: z.string().min(1),
    branchId: z.string().min(1),
    shiftId: z.string().min(1),
    isFieldEmployee: z.boolean().default(false),
  })

  app.post(
    "/employees",
    { preHandler: [authenticate, requirePermission("employee.manage", { write: true })] },
    async (request, reply) => {
      const parsed = employeeCreateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const employee: StoredEmployee = { id: id(store, "e"), managerId: null, ...parsed.data }
      store.employees.push(employee)
      recordAudit({
        actorId: request.auth.userId,
        action: "employee.create",
        entity: "employees",
        entityId: employee.id,
        after: employee,
        ip: request.ip,
      })
      return reply.code(201).send({ employee })
    }
  )

  // ---- settings & permissions & branding ----------------------------------
  app.get("/settings", { preHandler: [authenticate] }, async () => ({ settings: store.settings }))

  app.put(
    "/settings",
    { preHandler: [authenticate, requirePermission("config.manage", { write: true })] },
    async (request, reply) => {
      const merged = attendanceSettingsSchema.safeParse({ ...store.settings, ...(request.body as object) })
      if (!merged.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: merged.error.issues })
      const before = store.settings
      store.settings = merged.data
      recordAudit({
        actorId: request.auth.userId,
        action: "settings.update",
        entity: "settings",
        entityId: "company",
        before,
        after: store.settings,
        ip: request.ip,
      })
      return { settings: store.settings }
    }
  )

  app.get(
    "/permissions",
    { preHandler: [authenticate, requirePermission("config.manage")] },
    async () => ({ matrix: store.matrix })
  )

  app.put(
    "/permissions",
    { preHandler: [authenticate, requirePermission("config.manage", { write: true })] },
    async (request, reply) => {
      const matrixSchema = z.record(z.string(), z.record(z.string(), scopeSchema))
      const parsed = matrixSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      const beforeMatrix = store.matrix
      store.matrix = parsed.data as typeof store.matrix
      recordAudit({
        actorId: request.auth.userId,
        action: "permissions.update",
        entity: "role_permissions",
        entityId: "matrix",
        before: beforeMatrix,
        after: store.matrix,
        ip: request.ip,
      })
      return { matrix: store.matrix }
    }
  )

  // ---- departments (Postgres) --------------------------------------------
  app.get("/departments", { preHandler: [authenticate] }, async (_request, reply) => {
    const rows = await listDepartments().catch(() => null)
    if (rows === null) return reply.code(503).send({ error: "DB_UNAVAILABLE" })
    return { departments: rows }
  })

  app.post(
    "/departments",
    { preHandler: [authenticate, requirePermission("employee.manage", { write: true })] },
    async (request, reply) => {
      const parsed = departmentSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      try {
        const department = await createDepartment(parsed.data)
        recordAudit({
          actorId: request.auth.userId,
          action: "department.create",
          entity: "departments",
          entityId: department.id,
          after: department,
          ip: request.ip,
        })
        return reply.code(201).send({ department })
      } catch (error) {
        // Unique violation on (company, code) or (company, name).
        if ((error as { code?: string }).code === "P2002") {
          return reply.code(409).send({ error: "DEPARTMENT_EXISTS" })
        }
        return reply.code(503).send({ error: "DB_UNAVAILABLE" })
      }
    }
  )

  app.patch(
    "/departments/:id",
    { preHandler: [authenticate, requirePermission("employee.manage", { write: true })] },
    async (request, reply) => {
      const parsed = departmentSchema
        .partial()
        .extend({ isActive: z.boolean().optional() })
        .safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      try {
        const department = await updateDepartment(
          (request.params as { id: string }).id,
          parsed.data
        )
        recordAudit({
          actorId: request.auth.userId,
          action: "department.update",
          entity: "departments",
          entityId: department.id,
          after: department,
          ip: request.ip,
        })
        return { department }
      } catch (error) {
        if ((error as { code?: string }).code === "P2002")
          return reply.code(409).send({ error: "DEPARTMENT_EXISTS" })
        return reply.code(503).send({ error: "DB_UNAVAILABLE" })
      }
    }
  )

  // ---- company calendar: holidays and declared half working days ----------
  app.get("/calendar", { preHandler: [authenticate] }, async (_request, reply) => {
    const rows = await listCalendarDays().catch(() => null)
    if (rows === null) return reply.code(503).send({ error: "DB_UNAVAILABLE" })
    return { days: rows }
  })

  app.put(
    "/calendar",
    { preHandler: [authenticate, requirePermission("config.manage", { write: true })] },
    async (request, reply) => {
      const parsed = calendarDaySchema.safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      try {
        const day = await setCalendarDay(parsed.data)
        await refreshCalendar()
        recordAudit({
          actorId: request.auth.userId,
          action: day.type === "HALF_DAY" ? "calendar.halfDay" : "calendar.holiday",
          entity: "holidays",
          entityId: day.date,
          after: day,
          ip: request.ip,
        })
        return { day }
      } catch {
        return reply.code(503).send({ error: "DB_UNAVAILABLE" })
      }
    }
  )

  app.delete(
    "/calendar/:date",
    { preHandler: [authenticate, requirePermission("config.manage", { write: true })] },
    async (request, reply) => {
      const { date } = request.params as { date: string }
      try {
        await clearCalendarDay(date)
        await refreshCalendar()
        recordAudit({
          actorId: request.auth.userId,
          action: "calendar.clear",
          entity: "holidays",
          entityId: date,
          ip: request.ip,
        })
        return { ok: true }
      } catch {
        return reply.code(503).send({ error: "DB_UNAVAILABLE" })
      }
    }
  )

  // ---- §7 exports: queued on Redis, built server-side ----------------------
  app.get(
    "/exports",
    { preHandler: [authenticate, requirePermission("reports.view")] },
    async () => ({ jobs: store.exportJobs.slice(0, 20) })
  )

  app.post(
    "/exports",
    { preHandler: [authenticate, requirePermission("reports.view")] },
    async (request, reply) => {
      const parsed = z
        .object({
          report: z.literal("daily-register"),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      const job = await enqueueExport(store, {
        ...parsed.data,
        requestedBy: request.auth.userId,
      })
      if (!job) return reply.code(503).send({ error: "QUEUE_UNAVAILABLE" })
      recordAudit({
        actorId: request.auth.userId,
        action: "export.enqueue",
        entity: "export_jobs",
        entityId: job.id,
        after: { report: job.report, date: job.params.date },
        ip: request.ip,
      })
      return reply.code(201).send({ job })
    }
  )

  app.get(
    "/exports/:id/download",
    { preHandler: [authenticate, requirePermission("reports.view")] },
    async (request, reply) => {
      const { id: jobId } = request.params as { id: string }
      const job = store.exportJobs.find((candidate) => candidate.id === jobId)
      if (!job || job.status !== "READY" || !options.exportsDir) {
        return reply.code(404).send({ error: "NOT_READY" })
      }
      const file = exportFileStream(options.exportsDir, jobId)
      if (!file) return reply.code(404).send({ error: "NOT_FOUND" })
      reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="${job.filename}"`)
        .header("content-length", file.size)
      return reply.send(file.stream)
    }
  )

  // ---- §6 payroll: lock -> run, never the other way round ------------------
  app.get(
    "/payroll",
    { preHandler: [authenticate, requirePermission("payroll.manage")] },
    async () => ({ locks: store.monthLocks, runs: store.payrollRuns })
  )

  app.post(
    "/payroll/locks",
    { preHandler: [authenticate, requirePermission("payroll.manage", { write: true })] },
    async (request, reply) => {
      const parsed = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      const { month } = parsed.data
      if (store.monthLocks.some((lock) => lock.month === month)) {
        return reply.code(409).send({ error: "ALREADY_LOCKED" })
      }
      const lock = {
        id: id(store, "lock"),
        month,
        lockedBy: request.auth.userId,
        lockedAt: new Date().toISOString(),
      }
      store.monthLocks.push(lock)
      // A8 in the real schema: payroll_runs.lockId is a non-null FK to this row.
      const db = prisma()
      if (db) {
        void db.attendanceMonthLock
          .upsert({
            where: { companyId_month: { companyId: "co_delta", month } },
            update: {},
            create: { id: lock.id, companyId: "co_delta", month, lockedBy: lock.lockedBy },
          })
          .catch((error) => console.error("persist lock:", (error as Error).message))
      }
      recordAudit({
        actorId: request.auth.userId,
        action: "payroll.lock",
        entity: "attendance_month_locks",
        entityId: month,
        after: lock,
        ip: request.ip,
      })
      return reply.code(201).send({ lock })
    }
  )

  app.post(
    "/payroll/runs",
    { preHandler: [authenticate, requirePermission("payroll.manage", { write: true })] },
    async (request, reply) => {
      const parsed = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      const { month } = parsed.data

      // §11: payroll never reads unlocked attendance. Not a warning — a refusal.
      const lock = store.monthLocks.find((candidate) => candidate.month === month)
      if (!lock) return reply.code(409).send({ error: "MONTH_NOT_LOCKED" })

      const items = computeRunItems(store, month, calendarDays)
      const version =
        store.payrollRuns.filter((run) => run.month === month).length + 1
      const run = {
        id: id(store, "run"),
        month,
        version,
        status: "RELEASED" as const,
        lockId: lock.id,
        createdBy: request.auth.userId,
        createdAt: new Date().toISOString(),
        items,
        totalGrossPaise: items.reduce((sum, item) => sum + item.grossPaise, 0),
      }
      // Immutable once created — corrections are a new version, never an edit.
      store.payrollRuns.unshift(run)
      recordAudit({
        actorId: request.auth.userId,
        action: "payroll.run",
        entity: "payroll_runs",
        entityId: run.id,
        after: { month, version, totalGrossPaise: run.totalGrossPaise, items: items.length },
        ip: request.ip,
      })
      return reply.code(201).send({ run })
    }
  )

  app.get("/branding", async () => ({ branding: store.branding }))

  // §8.1 — served from Postgres. There is no update or delete route.
  app.get(
    "/audit",
    { preHandler: [authenticate, requirePermission("audit.view")] },
    async (_request, reply) => {
      const rows = await auditPage(200).catch(() => null)
      if (rows === null) return reply.code(503).send({ error: "DB_UNAVAILABLE" })
      const actorName = (actorId: string) =>
        store.users.find((candidate) => candidate.id === actorId)?.name ?? actorId
      return {
        rows: rows.map((row) => ({
          id: row.id,
          at: row.at,
          actorId: row.actorId,
          actor: actorName(row.actorId),
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          before: row.beforeJson,
          after: row.afterJson,
          ip: row.ip,
        })),
      }
    }
  )

  // White-label is admin-only ("that can only be done by admin" — enforced via
  // config.manage, which only ADMIN holds at write scope).
  app.put(
    "/branding",
    { preHandler: [authenticate, requirePermission("config.manage", { write: true })] },
    async (request, reply) => {
      const parsed = brandingSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const beforeBranding = store.branding
      store.branding = parsed.data
      recordAudit({
        actorId: request.auth.userId,
        action: "branding.update",
        entity: "companies",
        entityId: "co_delta",
        before: { companyName: beforeBranding.companyName },
        after: { companyName: store.branding.companyName },
        ip: request.ip,
      })
      return { branding: store.branding }
    }
  )

  // ---- punches ------------------------------------------------------------
  app.post(
    "/punches",
    {
      preHandler: [authenticate, requirePermission("punch.self")],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = punchBodySchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const body = parsed.data

      // punch.self is SELF-scoped for every role: nobody punches for others.
      if (body.employeeId !== request.auth.employeeId) {
        return reply.code(403).send({ error: "PUNCH_SELF_ONLY" })
      }

      const existing = store.punches.find((punch) => punch.idempotencyKey === body.idempotencyKey)
      if (existing) return reply.code(200).send({ punch: existing, idempotent: true })

      const employee = employeeById(body.employeeId)
      if (!employee) return reply.code(404).send({ error: "EMPLOYEE_NOT_FOUND" })
      const shift = store.shifts.find((candidate) => candidate.id === employee.shiftId)!
      const branch = store.branches.find((candidate) => candidate.id === employee.branchId)!

      const [dateISO, clock] = body.at.split("T")
      const [hours, minutes] = clock.split(":").map(Number)
      const minutesOfDay = hours * 60 + minutes

      const businessDate = resolveBusinessDate(dateISO, minutesOfDay, shift, store.settings)
      const offsetMin = offsetFromShiftStart(minutesOfDay, shift, store.settings)

      const previous = store.punches
        .filter((punch) => punch.employeeId === employee.id && punch.businessDate === businessDate)
        .at(-1)
      if (previous && Math.abs(offsetMin - previous.offsetMin) < store.settings.minPunchGapMinutes) {
        return reply.code(409).send({ error: "DUPLICATE_PUNCH", gapMinutes: store.settings.minPunchGapMinutes })
      }

      const flags: PunchFlag[] = []
      const windowFlag = punchWindowFlag(
        body.type === "OUT" ? "OUT" : "IN",
        offsetMin,
        shift,
        store.settings
      )
      if (windowFlag !== "ON_TIME") flags.push(windowFlag)

      if (!employee.isFieldEmployee) {
        if (body.lat === undefined || body.lng === undefined) {
          // Location denied or unavailable: the punch stands, the location
          // claim doesn't — same approval route as a fence breach.
          flags.push("OUT_OF_GEOFENCE")
        } else {
          const geofence = checkGeofence(
            { lat: body.lat, lng: body.lng },
            { lat: branch.lat, lng: branch.lng },
            store.settings.geofenceRadiusM,
            body.accuracyM
          )
          if (!geofence.inside) flags.push("OUT_OF_GEOFENCE")
        }
      }

      // §3: the hard block exists only as an explicit, off-by-default toggle.
      if (
        store.settings.hardBlockOutsideWindow &&
        (windowFlag === "EARLY" || windowFlag === "LATE")
      ) {
        return reply.code(422).send({ error: "OUTSIDE_WINDOW", flag: windowFlag })
      }

      // §3 offline queue: recorded with the device timestamp, flagged, and
      // the sync delay kept visible to HR.
      let syncDeltaSec: number | undefined
      if (body.queuedOffline) {
        flags.push("OFFLINE_SYNCED")
        syncDeltaSec = Math.max(
          0,
          Math.round((Date.now() - new Date(`${body.at}:00`).getTime()) / 1000)
        )
      }

      if (flags.length === 0) flags.push("ON_TIME")

      const punch = {
        id: id(store, "p"),
        employeeId: employee.id,
        type: body.type,
        businessDate,
        offsetMin,
        at: body.at,
        lat: body.lat,
        lng: body.lng,
        accuracyM: body.accuracyM,
        dayPart: body.dayPart,
        flags,
        idempotencyKey: body.idempotencyKey,
        selfieThumb: body.selfieThumb,
        selfieView: body.selfieView,
        syncDeltaSec,
      }
      store.punches.push(punch)
      persistPunch(punch)
      recordAudit({
        actorId: request.auth.userId,
        action: `punch.${body.type.toLowerCase()}`,
        entity: "punches",
        entityId: punch.id,
        after: { businessDate, offsetMin, flags, dayPart: body.dayPart },
        ip: request.ip,
      })

      const needsApproval = flags.some((flag) => flag !== "ON_TIME")
      if (needsApproval) {
        store.approvals.push({
          id: id(store, "req"),
          kind: "REGULARISATION",
          employeeId: employee.id,
          subject: `Punch ${body.type} flagged ${flags.join(", ")}`,
          detail: `at ${body.at} · offset ${offsetMin}m from shift start`,
          dateFrom: businessDate,
          dateTo: businessDate,
          units: 0,
          status: "PENDING",
          level: 1,
          createdAt: new Date().toISOString(),
        })
        persistApproval(store.approvals.at(-1)!)
      }

      const evaluation = evaluateLate(
        Math.max(offsetMin, 0),
        priorLateMarks(employee.id, businessDate.slice(0, 7)),
        store.settings
      )

      return reply.code(201).send({ punch, flags, needsApproval, evaluation })
    }
  )

  // ---- attendance days (the engine, live) ---------------------------------
  app.get(
    "/attendance/days",
    { preHandler: [authenticate, requirePermission("reports.view")] },
    async (request) => {
      const { date } = request.query as { date?: string }
      const targetDate = date ?? new Date().toISOString().slice(0, 10)
      const scope = store.matrix["reports.view"][request.auth.role]

      const rows = store.employees
        .filter((employee) => scopeReaches(scope, employee, request.auth, false))
        .map((employee) => {
          const shift = store.shifts.find((candidate) => candidate.id === employee.shiftId)!
          const punches = store.punches
            .filter((punch) => punch.employeeId === employee.id && punch.businessDate === targetDate)
            .map((punch) => ({ type: punch.type, offsetMin: punch.offsetMin }))

          const approvedLeave = store.approvals.find(
            (approval) =>
              approval.kind === "LEAVE" &&
              approval.status === "APPROVED" &&
              approval.employeeId === employee.id &&
              approval.dateFrom <= targetDate &&
              targetDate <= approval.dateTo
          )

          const result = computeAttendanceDay({
            shift,
            dayKind: calendar.isHoliday(targetDate)
              ? "HOLIDAY"
              : calendar.isWeeklyOff(targetDate)
                ? "WEEKLY_OFF"
                : dayTypeFor(targetDate) === "HALF_DAY"
                  ? "HALF_DAY"
                  : "WORKING",
            leave: approvedLeave
              ? { part: approvedLeave.leavePart ?? "FULL", isPaid: approvedLeave.leaveType !== "LOP" }
              : null,
            punches,
            explicitDayPart: store.punches.find(
              (punch) => punch.employeeId === employee.id && punch.businessDate === targetDate
            )?.dayPart,
            priorLateMarks: priorLateMarks(employee.id, targetDate.slice(0, 7)),
            settings: store.settings,
          })

          const inStored = store.punches.find(
            (punch) =>
              punch.employeeId === employee.id &&
              punch.businessDate === targetDate &&
              punch.type === "IN"
          )
          const inPunch = punches.find((punch) => punch.type === "IN")
          const outPunches = punches.filter((punch) => punch.type === "OUT")
          const toClock = (offset: number) => minutesToClock(shift.startMin + offset)
          return {
            employeeId: employee.id,
            code: employee.code,
            name: employee.name,
            department: employee.department,
            shiftName: shift.name,
            firstInAt: inPunch ? toClock(inPunch.offsetMin) : null,
            selfieThumb: inStored?.selfieThumb ?? null,
            selfieView: inStored?.selfieView ?? null,
            syncDeltaSec: inStored?.syncDeltaSec ?? null,
            lastOutAt: outPunches.length > 0 ? toClock(outPunches.at(-1)!.offsetMin) : null,
            ...result,
          }
        })

      return { date: targetDate, rows }
    }
  )

  // ---- leave --------------------------------------------------------------
  app.get("/leave/balances/:employeeId", { preHandler: [authenticate] }, async (request, reply) => {
    const { employeeId } = request.params as { employeeId: string }
    const target = employeeById(employeeId)
    if (!target) return reply.code(404).send({ error: "EMPLOYEE_NOT_FOUND" })
    if (employeeId !== request.auth.employeeId) {
      const scope = store.matrix["reports.view"][request.auth.role]
      if (!scopeReaches(scope, target, request.auth, false) || scope === "SELF") {
        return reply.code(403).send({ error: "FORBIDDEN" })
      }
    }
    return { employeeId, balances: balancesFor(employeeId) }
  })

  app.post(
    "/leave/apply",
    { preHandler: [authenticate, requirePermission("punch.self")] },
    async (request, reply) => {
      const parsed = leaveApplySchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const body = parsed.data
      if (body.to < body.from) return reply.code(400).send({ error: "RANGE_INVERTED" })

      const units = countLeaveUnits(body.from, body.to, body.part, calendar, store.settings.sandwichLeave)
      if (units <= 0) return reply.code(422).send({ error: "NO_WORKING_DAYS_IN_RANGE" })

      const balance = balancesFor(request.auth.employeeId)[body.type] ?? 0
      if (body.type !== "LOP" && balance < units) {
        return reply.code(422).send({ error: "INSUFFICIENT_BALANCE", balance, requested: units })
      }

      const approval = {
        id: id(store, "req"),
        kind: "LEAVE" as const,
        employeeId: request.auth.employeeId,
        subject: `${body.type} · ${units} day(s)`,
        detail: body.reason,
        dateFrom: body.from,
        dateTo: body.to,
        units,
        leaveType: body.type,
        leavePart: body.part,
        status: "PENDING" as const,
        level: 1 as const,
        createdAt: new Date().toISOString(),
      }
      store.approvals.push(approval)
      persistApproval(approval)
      return reply.code(201).send({ approval, units })
    }
  )

  // ---- approvals ----------------------------------------------------------
  app.get("/approvals", { preHandler: [authenticate] }, async (request) => {
    const leaveScope = store.matrix["leave.approve"][request.auth.role]
    const attendanceScope = store.matrix["attendance.approve"][request.auth.role]
    const pending = store.approvals.filter((approval) => {
      if (approval.employeeId === request.auth.employeeId) return true
      const employee = employeeById(approval.employeeId)
      if (!employee) return false
      const scope = approval.kind === "LEAVE" ? leaveScope : attendanceScope
      return scopeReaches(scope, employee, request.auth, false)
    })
    const enriched = pending.map((approval) => {
      const employee = employeeById(approval.employeeId)
      return {
        ...approval,
        employeeName: employee?.name ?? approval.employeeId,
        employeeCode: employee?.code ?? "",
        department: employee?.department ?? "",
      }
    })
    return { approvals: enriched }
  })

  app.post("/approvals/:id/decide", { preHandler: [authenticate] }, async (request, reply) => {
    const { id: approvalId } = request.params as { id: string }
    const parsed = decideSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })

    const approval = store.approvals.find((candidate) => candidate.id === approvalId)
    if (!approval) return reply.code(404).send({ error: "NOT_FOUND" })
    if (approval.status !== "PENDING") return reply.code(409).send({ error: "ALREADY_DECIDED" })

    const permissionKey = approval.kind === "LEAVE" ? "leave.approve" : "attendance.approve"
    const scope = store.matrix[permissionKey][request.auth.role]
    const employee = employeeById(approval.employeeId)!
    if (scope === "NONE" || scope === "VIEW" || !scopeReaches(scope, employee, request.auth, true)) {
      return reply.code(403).send({ error: "FORBIDDEN", permission: permissionKey })
    }
    // Approving your own request is never allowed, whatever the scope.
    if (approval.employeeId === request.auth.employeeId) {
      return reply.code(403).send({ error: "CANNOT_DECIDE_OWN" })
    }

    const beforeApproval = { status: approval.status }
    approval.status = parsed.data.action === "APPROVE" ? "APPROVED" : "REJECTED"
    approval.decidedBy = request.auth.userId
    approval.remarks = parsed.data.remarks
    persistApprovalDecision(approval)
    recordAudit({
      actorId: request.auth.userId,
      action: `approval.${parsed.data.action.toLowerCase()}`,
      entity: "approval_requests",
      entityId: approval.id,
      before: beforeApproval,
      after: { status: approval.status, remarks: approval.remarks },
      ip: request.ip,
    })

    if (approval.status === "APPROVED" && approval.kind === "LEAVE" && approval.leaveType) {
      store.ledger.push({
        id: id(store, "l"),
        employeeId: approval.employeeId,
        type: approval.leaveType,
        txnType: "AVAIL",
        units: -approval.units,
        date: approval.dateFrom,
        remarks: `${approval.id} approved`,
      })
      persistLedgerEntry(store.ledger.at(-1)!)
    }

    return { approval }
  })

  registerProcurementRoutes(app, store, { authenticate, requirePermission })
  registerSalesRoutes(app, store, { authenticate, requirePermission })
  registerOpsRoutes(app, store, { authenticate, requirePermission })

  return app
}
