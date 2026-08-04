import cookie from "@fastify/cookie"
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
  offsetFromShiftStart,
  punchWindowFlag,
  reduceLedger,
  resolveBusinessDate,
  scopeSchema,
  type PunchFlag,
  type Role,
  type Scope,
} from "@attendance/shared"

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
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().nonnegative().default(0),
  dayPart: z.enum(["FULL", "FIRST_HALF", "SECOND_HALF"]).default("FULL"),
  idempotencyKey: z.string().min(8),
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

const brandingSchema = z.object({
  companyName: z.string().min(1).max(80),
  logoDataUrl: z.string().startsWith("data:image/").max(300_000).nullable(),
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

export function buildServer(store: Store = seedStore()) {
  const app = Fastify({ logger: false })

  app.register(cors, { origin: true, credentials: true })
  app.register(cookie)

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

  const calendar = {
    isHoliday: (date: string) => Boolean(store.holidays[date]),
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
  app.post("/auth/login", async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" })
    const user = store.users.find((candidate) => candidate.email === parsed.data.email)
    if (!user || !bcrypt.compareSync(parsed.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" })
    }
    const auth: AuthContext = { userId: user.id, role: user.role, employeeId: user.employeeId }
    setAuthCookies(reply, auth)
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, employeeId: user.employeeId },
    }
  })

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
    async () => ({ employees: store.employees })
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
      store.settings = merged.data
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
      store.matrix = parsed.data as typeof store.matrix
      return { matrix: store.matrix }
    }
  )

  app.get("/branding", async () => ({ branding: store.branding }))

  // White-label is admin-only ("that can only be done by admin" — enforced via
  // config.manage, which only ADMIN holds at write scope).
  app.put(
    "/branding",
    { preHandler: [authenticate, requirePermission("config.manage", { write: true })] },
    async (request, reply) => {
      const parsed = brandingSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", issues: parsed.error.issues })
      store.branding = parsed.data
      return { branding: store.branding }
    }
  )

  // ---- punches ------------------------------------------------------------
  app.post(
    "/punches",
    { preHandler: [authenticate, requirePermission("punch.self")] },
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
        const geofence = checkGeofence(
          { lat: body.lat, lng: body.lng },
          { lat: branch.lat, lng: branch.lng },
          store.settings.geofenceRadiusM,
          body.accuracyM
        )
        if (!geofence.inside) flags.push("OUT_OF_GEOFENCE")
      }

      // §3: the hard block exists only as an explicit, off-by-default toggle.
      if (
        store.settings.hardBlockOutsideWindow &&
        (windowFlag === "EARLY" || windowFlag === "LATE")
      ) {
        return reply.code(422).send({ error: "OUTSIDE_WINDOW", flag: windowFlag })
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
      }
      store.punches.push(punch)

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
        })
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

          return { employeeId: employee.id, code: employee.code, name: employee.name, ...result }
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
      }
      store.approvals.push(approval)
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
    return { approvals: pending }
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

    approval.status = parsed.data.action === "APPROVE" ? "APPROVED" : "REJECTED"
    approval.decidedBy = request.auth.userId
    approval.remarks = parsed.data.remarks

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
    }

    return { approval }
  })

  return app
}
