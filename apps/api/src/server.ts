import cookie from "@fastify/cookie"
import rateLimit from "@fastify/rate-limit"
import cors from "@fastify/cors"
import helmet from "@fastify/helmet"
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify"
import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"
import * as z from "zod"
import {
  attendanceSettingsSchema,
  bankDetailsSchema,
  buildBankTransferCsv,
  buildPayrollJournal,
  checkGeofence,
  computeAttendanceDay,
  countLeaveUnits,
  evaluateLate,
  minutesToClock,
  offsetFromShiftStart,
  punchWindowFlag,
  reduceLedger,
  regularisationPunches,
  regularisationRequestSchema,
  regularisationSubject,
  resolveBusinessDate,
  scopeSchema,
  shiftSpecSchema,
  splitForDisbursement,
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

const IS_PRODUCTION = process.env.NODE_ENV === "production"

/**
 * The signing secret is the whole authentication system. A deployment that
 * forgot to set it would issue tokens anyone with the source could forge, so
 * production refuses to boot rather than run insecure — a crash at start is
 * loud and fixable; a silent default is neither.
 */
function resolveSecret(): string {
  const configured = process.env.JWT_ACCESS_SECRET
  if (IS_PRODUCTION) {
    if (!configured || configured.length < 32)
      throw new Error(
        "JWT_ACCESS_SECRET must be set to at least 32 characters in production. " +
          "Generate one with: openssl rand -base64 48"
      )
    return configured
  }
  return configured ?? "dev-only-secret-change-me"
}

const SECRET = resolveSecret()

/**
 * Browsers may only send credentialed requests to an origin the server names
 * explicitly — reflecting whatever Origin arrived is the same as allowing all
 * of them. In development the Vite ports are the allowlist; in production
 * CORS_ORIGINS carries the real ones.
 */
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ??
  "http://localhost:5173,http://localhost:5174,http://localhost:5177"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

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

/** Last four digits only — enough to confirm, useless if the log leaks. */
const maskAccount = (accountNumber: string) =>
  accountNumber.length <= 4 ? "****" : `****${accountNumber.slice(-4)}`

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

  // Same-origin API responses carry no HTML, but the headers cost nothing and
  // close off sniffing, framing and referrer leakage. CSP is left to whatever
  // serves the SPA — setting it here would only govern JSON.
  app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })
  app.register(cors, {
    origin: (origin, callback) => {
      // No Origin header: same-origin, curl, or a native app — not a CORS case.
      if (!origin) return callback(null, true)
      callback(null, ALLOWED_ORIGINS.includes(origin))
    },
    credentials: true,
  })
  app.register(cookie)
  // §8.6: global ceiling; auth and punch carry tighter per-route limits below.
  app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" })

  const sign = (payload: AuthContext, ttlSec: number) =>
    jwt.sign(payload, SECRET, { expiresIn: ttlSec })

  const setAuthCookies = (reply: FastifyReply, auth: AuthContext) => {
    // `secure` only in production: localhost development is plain HTTP, and a
    // secure cookie there would simply never be stored.
    const base = {
      path: "/",
      httpOnly: true,
      sameSite: "lax" as const,
      secure: IS_PRODUCTION,
    }
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

  /**
   * Holiday beats weekly off beats declared half day. One helper, because a
   * second copy of this ladder is a second place for the roster and the
   * register to disagree about what a day is.
   */
  const dayKindFor = (date: string): "HOLIDAY" | "WEEKLY_OFF" | "HALF_DAY" | "WORKING" =>
    calendar.isHoliday(date)
      ? "HOLIDAY"
      : calendar.isWeeklyOff(date)
        ? "WEEKLY_OFF"
        : dayTypeFor(date) === "HALF_DAY"
          ? "HALF_DAY"
          : "WORKING"

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

  /**
   * Until this existed there was no way to change a password at all: the four
   * seeded logins were permanent and their passwords are in the repo. Anyone
   * signed in may change their own; nobody may change another's here.
   */
  const passwordChangeSchema = z.object({
    currentPassword: z.string().min(1),
    // Long enough to survive the offline attack a stolen hash enables.
    newPassword: z.string().min(10).max(200),
  })

  app.post(
    "/auth/change-password",
    {
      preHandler: [authenticate],
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = passwordChangeSchema.safeParse(request.body)
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "BAD_REQUEST", detail: "New password must be at least 10 characters." })
      const user = store.users.find((candidate) => candidate.id === request.auth.userId)
      if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" })
      if (!bcrypt.compareSync(parsed.data.currentPassword, user.passwordHash))
        return reply.code(403).send({ error: "WRONG_PASSWORD" })
      if (bcrypt.compareSync(parsed.data.newPassword, user.passwordHash))
        return reply.code(422).send({ error: "SAME_PASSWORD" })

      user.passwordHash = bcrypt.hashSync(parsed.data.newPassword, 12)
      // The hash itself is never logged — only that a change happened.
      recordAudit({
        actorId: user.id,
        action: "auth.password_change",
        entity: "users",
        entityId: user.id,
        ip: request.ip,
      })
      return { ok: true }
    }
  )

  /** Admin-side reset for someone locked out. Returns nothing about the old one. */
  app.post(
    "/users/:id/reset-password",
    { preHandler: [authenticate, requirePermission("config.manage", { write: true })] },
    async (request, reply) => {
      const parsed = z
        .object({ newPassword: z.string().min(10).max(200) })
        .safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      const target = store.users.find(
        (candidate) => candidate.id === (request.params as { id: string }).id
      )
      if (!target) return reply.code(404).send({ error: "NOT_FOUND" })

      target.passwordHash = bcrypt.hashSync(parsed.data.newPassword, 12)
      failedLogins.delete(target.email)
      recordAudit({
        actorId: request.auth.userId,
        action: "auth.password_reset",
        entity: "users",
        entityId: target.id,
        ip: request.ip,
      })
      return { ok: true }
    }
  )

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
      // Same referential guards as PATCH: a dangling shiftId reaches the day
      // computation as `undefined` and crashes the register and payroll for
      // everyone, not just this employee.
      if (!store.shifts.some((shift) => shift.id === parsed.data.shiftId))
        return reply.code(422).send({ error: "UNKNOWN_SHIFT" })
      if (!store.branches.some((branch) => branch.id === parsed.data.branchId))
        return reply.code(422).send({ error: "UNKNOWN_BRANCH" })
      if (store.employees.some((existing) => existing.code === parsed.data.code))
        return reply.code(409).send({ error: "DUPLICATE_CODE" })
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

  const employeeUpdateSchema = employeeCreateSchema
    .omit({ code: true })
    .partial()
    .extend({ managerId: z.string().nullable().optional() })

  app.patch(
    "/employees/:id",
    { preHandler: [authenticate, requirePermission("employee.manage", { write: true })] },
    async (request, reply) => {
      const employee = store.employees.find(
        (candidate) => candidate.id === (request.params as { id: string }).id
      )
      if (!employee) return reply.code(404).send({ error: "NOT_FOUND" })
      const parsed = employeeUpdateSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      // Referential guards — a typo'd shift or manager id must not corrupt the roster.
      if (parsed.data.shiftId && !store.shifts.some((shift) => shift.id === parsed.data.shiftId))
        return reply.code(422).send({ error: "UNKNOWN_SHIFT" })
      if (
        parsed.data.managerId &&
        (parsed.data.managerId === employee.id ||
          !store.employees.some((candidate) => candidate.id === parsed.data.managerId))
      )
        return reply.code(422).send({ error: "BAD_MANAGER" })
      const before = { ...employee }
      Object.assign(employee, parsed.data)
      recordAudit({
        actorId: request.auth.userId,
        action: "employee.update",
        entity: "employees",
        entityId: employee.id,
        before,
        after: employee,
        ip: request.ip,
      })
      return { employee }
    }
  )

  // ---- shifts --------------------------------------------------------------
  // No DELETE by design: employees reference shiftId, so shifts retire by
  // falling out of use — the departments pattern, not a hard delete.
  app.get("/shifts", { preHandler: [authenticate] }, async () => ({ shifts: store.shifts }))

  app.post(
    "/shifts",
    { preHandler: [authenticate, requirePermission("config.manage", { write: true })] },
    async (request, reply) => {
      const parsed = shiftSpecSchema.omit({ id: true }).safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const shift = { id: id(store, "sh"), ...parsed.data }
      store.shifts.push(shift)
      recordAudit({
        actorId: request.auth.userId,
        action: "shift.create",
        entity: "shifts",
        entityId: shift.id,
        after: shift,
        ip: request.ip,
      })
      return reply.code(201).send({ shift })
    }
  )

  app.patch(
    "/shifts/:id",
    { preHandler: [authenticate, requirePermission("config.manage", { write: true })] },
    async (request, reply) => {
      const shift = store.shifts.find(
        (candidate) => candidate.id === (request.params as { id: string }).id
      )
      if (!shift) return reply.code(404).send({ error: "NOT_FOUND" })
      const parsed = shiftSpecSchema.omit({ id: true }).partial().safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const before = { ...shift }
      Object.assign(shift, parsed.data)
      recordAudit({
        actorId: request.auth.userId,
        action: "shift.update",
        entity: "shifts",
        entityId: shift.id,
        before,
        after: shift,
        ip: request.ip,
      })
      return { shift }
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

  // The accounting hand-off: a released run downloads as a balanced Tally
  // journal voucher (Gateway of Tally → Import Data, or POST to :9000).
  app.get(
    "/payroll/runs/:id/tally.xml",
    { preHandler: [authenticate, requirePermission("payroll.manage")] },
    async (request, reply) => {
      const run = store.payrollRuns.find(
        (candidate) => candidate.id === (request.params as { id: string }).id
      )
      if (!run) return reply.code(404).send({ error: "NOT_FOUND" })
      try {
        const xml = buildPayrollJournal({
          company: store.settings.tallyCompanyName || store.branding.companyName,
          month: run.month,
          items: run.items,
          expenseLedger: store.settings.tallySalaryExpenseLedger,
          payableLedger: store.settings.tallySalaryPayableLedger,
          perEmployeeLedgers: store.settings.tallyPerEmployeeLedgers,
        })
        recordAudit({
          actorId: request.auth.userId,
          action: "payroll.tally_export",
          entity: "payroll_runs",
          entityId: run.id,
          after: { month: run.month, version: run.version },
          ip: request.ip,
        })
        return reply
          .header("content-type", "application/xml; charset=utf-8")
          .header(
            "content-disposition",
            `attachment; filename="Tally_Salary_${run.month}_v${run.version}.xml"`
          )
          .send(xml)
      } catch (error) {
        // e.g. an all-zero month — refuse honestly rather than emit bad books.
        return reply.code(422).send({ error: "NO_VOUCHER", detail: (error as Error).message })
      }
    }
  )

  // ---- bank details & disbursement ---------------------------------------
  // Bank details are payroll data, not employee data: they gate money, so
  // they sit behind payroll.manage rather than employee.manage.
  app.get(
    "/salaries",
    { preHandler: [authenticate, requirePermission("payroll.manage")] },
    async () => ({
      salaries: store.salaries.map((salary) => ({
        ...salary,
        // Never ship a full account number to a list view.
        bank: salary.bank
          ? { ...salary.bank, accountNumber: maskAccount(salary.bank.accountNumber) }
          : null,
      })),
    })
  )

  app.put(
    "/salaries/:employeeId/bank",
    { preHandler: [authenticate, requirePermission("payroll.manage", { write: true })] },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string }
      if (!employeeById(employeeId)) return reply.code(404).send({ error: "EMPLOYEE_NOT_FOUND" })
      const parsed = bankDetailsSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })

      const salary = store.salaries.find((candidate) => candidate.employeeId === employeeId)
      if (!salary) return reply.code(404).send({ error: "NO_SALARY_RECORD" })
      const before = salary.bank ? maskAccount(salary.bank.accountNumber) : null
      salary.bank = parsed.data
      // The audit records that details changed and the masked tail only —
      // an append-only log is the last place a full account number belongs.
      recordAudit({
        actorId: request.auth.userId,
        action: "salary.bank_update",
        entity: "salaries",
        entityId: employeeId,
        before: { accountNumber: before },
        after: { accountNumber: maskAccount(parsed.data.accountNumber), ifsc: parsed.data.ifsc },
        ip: request.ip,
      })
      return { ok: true }
    }
  )

  /** The bank upload for a released run, plus who could not be paid and why. */
  app.get(
    "/payroll/runs/:id/bank-transfer.csv",
    { preHandler: [authenticate, requirePermission("payroll.manage")] },
    async (request, reply) => {
      const run = store.payrollRuns.find(
        (candidate) => candidate.id === (request.params as { id: string }).id
      )
      if (!run) return reply.code(404).send({ error: "NOT_FOUND" })

      const split = splitForDisbursement(
        run.items.map((item) => {
          const salary = store.salaries.find(
            (candidate) => candidate.employeeId === item.employeeId
          )
          return {
            employeeId: item.employeeId,
            code: item.code,
            name: item.name,
            amountPaise: item.grossPaise,
            bank: salary?.bank ?? null,
          }
        })
      )
      if (split.payable.length === 0)
        return reply.code(422).send({
          error: "NOBODY_PAYABLE",
          held: split.held.map((entry) => ({ code: entry.row.code, reason: entry.reason })),
        })

      recordAudit({
        actorId: request.auth.userId,
        action: "payroll.bank_export",
        entity: "payroll_runs",
        entityId: run.id,
        after: { month: run.month, paid: split.payable.length, held: split.held.length },
        ip: request.ip,
      })
      const csv = buildBankTransferCsv(split, {
        month: run.month,
        debitAccount: store.settings.payrollDebitAccount,
      })
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="BankTransfer_${run.month}_v${run.version}.csv"`
        )
        // The held list travels in a header so the UI can warn without a
        // second request; the file itself stays a clean bank upload.
        .header("x-held-count", String(split.held.length))
        .send(csv)
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
            dayKind: dayKindFor(targetDate),
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

  /**
   * §3 regularisation: the employee's own route to fix a day the machine got
   * wrong. Raising one changes nothing — approval is what writes punches, and
   * it appends rather than edits (see the decide route).
   */
  app.post(
    "/regularisations",
    { preHandler: [authenticate, requirePermission("punch.self")] },
    async (request, reply) => {
      const parsed = regularisationRequestSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      const body = parsed.data

      // A future date has nothing to correct yet.
      const today = new Date().toISOString().slice(0, 10)
      if (body.date > today) return reply.code(422).send({ error: "FUTURE_DATE" })

      // A locked month is closed for payroll; corrections there are an
      // adjustment run, not a silent rewrite of a paid period.
      if (store.monthLocks.some((lock) => lock.month === body.date.slice(0, 7)))
        return reply.code(409).send({ error: "MONTH_LOCKED" })

      // One open request per day: two pending corrections for the same day
      // would apply twice and double the worked hours.
      const duplicate = store.approvals.find(
        (approval) =>
          approval.kind === "REGULARISATION" &&
          approval.employeeId === request.auth.employeeId &&
          approval.dateFrom === body.date &&
          approval.status === "PENDING"
      )
      if (duplicate) return reply.code(409).send({ error: "ALREADY_PENDING" })

      const approval = {
        id: id(store, "req"),
        kind: "REGULARISATION" as const,
        employeeId: request.auth.employeeId,
        subject: regularisationSubject(body),
        detail: body.note,
        dateFrom: body.date,
        dateTo: body.date,
        units: 0,
        status: "PENDING" as const,
        level: 1 as const,
        createdAt: new Date().toISOString(),
        // Carried so the decide route can rebuild the punches verbatim.
        regularisation: { inTime: body.inTime, outTime: body.outTime, reason: body.reason },
      }
      store.approvals.push(approval)
      persistApproval(approval)
      recordAudit({
        actorId: request.auth.userId,
        action: "regularisation.raise",
        entity: "approval_requests",
        entityId: approval.id,
        after: { date: body.date, reason: body.reason, in: body.inTime, out: body.outTime },
        ip: request.ip,
      })
      return reply.code(201).send({ approval })
    }
  )

  /**
   * Claim the overtime a day already earned. The claim cannot invent minutes:
   * it is measured against what the engine computed from real punches, so the
   * approval decision is only ever "yes, pay this" — never "how much?".
   */
  app.post(
    "/overtime/claims",
    { preHandler: [authenticate, requirePermission("punch.self")] },
    async (request, reply) => {
      const parsed = z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          note: z.string().max(300).default(""),
        })
        .safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
      const { date, note } = parsed.data

      if (!store.settings.otEnabled)
        return reply.code(422).send({ error: "OT_DISABLED" })
      if (date > new Date().toISOString().slice(0, 10))
        return reply.code(422).send({ error: "FUTURE_DATE" })
      if (store.monthLocks.some((lock) => lock.month === date.slice(0, 7)))
        return reply.code(409).send({ error: "MONTH_LOCKED" })

      const employee = employeeById(request.auth.employeeId)!
      const shift = store.shifts.find((candidate) => candidate.id === employee.shiftId)!
      const day = computeAttendanceDay({
        shift,
        dayKind: dayKindFor(date),
        leave: null,
        punches: store.punches
          .filter(
            (punch) => punch.employeeId === employee.id && punch.businessDate === date
          )
          .map((punch) => ({ type: punch.type, offsetMin: punch.offsetMin })),
        priorLateMarks: 0,
        settings: store.settings,
      })
      if (day.otMinutes <= 0)
        return reply.code(422).send({ error: "NO_OVERTIME_ON_DAY" })

      const duplicate = store.approvals.find(
        (approval) =>
          approval.kind === "OVERTIME" &&
          approval.employeeId === employee.id &&
          approval.dateFrom === date &&
          approval.status !== "REJECTED"
      )
      if (duplicate) return reply.code(409).send({ error: "ALREADY_CLAIMED" })

      const hours = (day.otMinutes / 60).toFixed(2)
      const approval = {
        id: id(store, "req"),
        kind: "OVERTIME" as const,
        employeeId: employee.id,
        subject: `Overtime ${hours} h`,
        detail: note || `${day.otMinutes} minutes past shift end`,
        dateFrom: date,
        dateTo: date,
        // Minutes, so payroll multiplies without re-deriving anything.
        units: day.otMinutes,
        status: "PENDING" as const,
        level: 1 as const,
        createdAt: new Date().toISOString(),
      }
      store.approvals.push(approval)
      persistApproval(approval)
      recordAudit({
        actorId: request.auth.userId,
        action: "overtime.claim",
        entity: "approval_requests",
        entityId: approval.id,
        after: { date, minutes: day.otMinutes },
        ip: request.ip,
      })
      return reply.code(201).send({ approval, otMinutes: day.otMinutes })
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

    // Balance is re-checked at APPROVAL, not just at apply. Two requests can
    // each pass the apply-time check and then both be approved; the resulting
    // debit drives the ledger negative, and reduceLedger throws on a negative
    // balance — which would 500 this employee's balance and apply routes for
    // good. Refusing here keeps the ledger a valid document.
    if (
      parsed.data.action === "APPROVE" &&
      approval.kind === "LEAVE" &&
      approval.leaveType &&
      approval.leaveType !== "LOP"
    ) {
      const available = balancesFor(approval.employeeId)[approval.leaveType] ?? 0
      if (approval.units > available) {
        return reply.code(409).send({
          error: "INSUFFICIENT_BALANCE",
          detail: `${approval.leaveType}: ${available} available, ${approval.units} requested. Balance changed since the request was raised.`,
        })
      }
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

    /**
     * An approved regularisation appends punches — it never edits or deletes
     * one. The register recomputes from punches, so the corrected day falls
     * out automatically, and what the device actually recorded survives beside
     * the correction. That pair is the whole value of the audit trail when
     * someone disputes a payslip months later.
     */
    if (approval.status === "APPROVED" && approval.kind === "REGULARISATION" && approval.regularisation) {
      const employee = employeeById(approval.employeeId)!
      const shift = store.shifts.find((candidate) => candidate.id === employee.shiftId)
      if (!shift) return reply.code(422).send({ error: "UNKNOWN_SHIFT" })

      const punches = regularisationPunches(
        {
          date: approval.dateFrom,
          reason: approval.regularisation.reason,
          inTime: approval.regularisation.inTime,
          outTime: approval.regularisation.outTime,
          note: approval.detail,
        },
        shift.startMin
      )
      for (const punch of punches) {
        const stored = {
          id: id(store, "p"),
          employeeId: approval.employeeId,
          type: punch.type,
          businessDate: approval.dateFrom,
          offsetMin: punch.offsetMin,
          at: `${approval.dateFrom}T${punch.clock}`,
          accuracyM: 0,
          dayPart: "FULL" as const,
          flags: ["REGULARISED" as const],
          // Deterministic, so replaying this decision cannot double-write.
          idempotencyKey: `reg_${approval.id}_${punch.type}`,
        }
        if (store.punches.some((existing) => existing.idempotencyKey === stored.idempotencyKey))
          continue
        store.punches.push(stored)
        persistPunch(stored)
      }
      recordAudit({
        actorId: request.auth.userId,
        action: "regularisation.apply",
        entity: "punches",
        entityId: approval.id,
        after: { date: approval.dateFrom, punches: punches.length },
        ip: request.ip,
      })
    }

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
