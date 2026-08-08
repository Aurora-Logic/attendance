import { beforeEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { buildServer } from "../src/server"
import { seedStore, type Store } from "../src/store"
import { runNightlyClose } from "../src/nightly"

let store: Store
let app: FastifyInstance

beforeEach(async () => {
  store = seedStore()
  app = buildServer(store)
  await app.ready()
})

const login = async (email: string, password: string) => {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  })
  const cookies = response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
  return { response, cookies }
}

const asAdmin = () => login("admin@delta.dev", "Admin@123")
const asHr = () => login("hr@delta.dev", "Hr@12345")
const asOps = () => login("ops@delta.dev", "Ops@1234")
const asEmployee = () => login("employee@delta.dev", "Emp@1234")

const punchBody = (over: Record<string, unknown> = {}) => ({
  employeeId: "e4",
  type: "IN",
  at: "2026-08-04T09:05",
  lat: 19.076,
  lng: 72.8777,
  accuracyM: 10,
  dayPart: "FULL",
  idempotencyKey: "key-0000001",
  ...over,
})

describe("auth", () => {
  it("health needs no auth", async () => {
    const response = await app.inject({ method: "GET", url: "/health" })
    expect(response.statusCode).toBe(200)
  })

  it("wrong password → 401", async () => {
    const { response } = await login("admin@delta.dev", "nope")
    expect(response.statusCode).toBe(401)
  })

  it("login sets httpOnly access + refresh cookies and returns the user", async () => {
    const { response } = await asAdmin()
    expect(response.statusCode).toBe(200)
    const names = response.cookies.map((cookie) => cookie.name)
    expect(names).toContain("access_token")
    expect(names).toContain("refresh_token")
    expect(response.cookies.every((cookie) => cookie.httpOnly)).toBe(true)
    expect(response.json().user.role).toBe("ADMIN")
  })

  it("/auth/me without a token → 401; with → role + permissions map", async () => {
    expect((await app.inject({ method: "GET", url: "/auth/me" })).statusCode).toBe(401)
    const { cookies } = await asEmployee()
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: cookies } })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.role).toBe("EMPLOYEE")
    expect(me.json().permissions["employee.manage"]).toBe("NONE")
  })

  it("no response ever contains a password hash", async () => {
    const { response, cookies } = await asAdmin()
    expect(response.body).not.toContain("passwordHash")
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: cookies } })
    expect(me.body).not.toContain("passwordHash")
    expect(me.body).not.toContain("$2b$")
  })
})

describe("RBAC — matrix-driven, no role names in routes", () => {
  it("EMPLOYEE cannot list employees; ADMIN can", async () => {
    const employee = await asEmployee()
    const admin = await asAdmin()
    expect(
      (await app.inject({ method: "GET", url: "/employees", headers: { cookie: employee.cookies } }))
        .statusCode
    ).toBe(403)
    const ok = await app.inject({ method: "GET", url: "/employees", headers: { cookie: admin.cookies } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().employees.length).toBeGreaterThanOrEqual(6)
  })

  it("HR (VIEW on config) can read settings but not write them", async () => {
    const hr = await asHr()
    const read = await app.inject({ method: "GET", url: "/settings", headers: { cookie: hr.cookies } })
    expect(read.statusCode).toBe(200)
    const write = await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { cookie: hr.cookies },
      payload: { lateGraceMinutes: 20 },
    })
    expect(write.statusCode).toBe(403)
  })

  it("ADMIN settings write persists and invalid values are rejected", async () => {
    const admin = await asAdmin()
    const ok = await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { cookie: admin.cookies },
      payload: { lateGraceMinutes: 20 },
    })
    expect(ok.statusCode).toBe(200)
    expect(store.settings.lateGraceMinutes).toBe(20)

    const bad = await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { cookie: admin.cookies },
      payload: { lateGraceMinutes: -5 },
    })
    expect(bad.statusCode).toBe(400)
  })

  it("white-label branding is admin-only", async () => {
    const hr = await asHr()
    const admin = await asAdmin()
    const branding = { companyName: "Aurora Logic", logoDataUrl: "data:image/png;base64,AAAA" }
    expect(
      (await app.inject({ method: "PUT", url: "/branding", headers: { cookie: hr.cookies }, payload: branding }))
        .statusCode
    ).toBe(403)
    const ok = await app.inject({
      method: "PUT",
      url: "/branding",
      headers: { cookie: admin.cookies },
      payload: branding,
    })
    expect(ok.statusCode).toBe(200)
    expect((await app.inject({ method: "GET", url: "/branding" })).json().branding.companyName).toBe(
      "Aurora Logic"
    )
  })
})

describe("punches — §3 core flow", () => {
  it("punching for someone else is refused even by admin (SELF scope)", async () => {
    const admin = await asAdmin()
    const response = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: admin.cookies },
      payload: punchBody(), // e4 is not admin's employee record
    })
    expect(response.statusCode).toBe(403)
  })

  it("on-time punch inside the geofence → 201, ON_TIME, no approval", async () => {
    const employee = await asEmployee()
    const response = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody(),
    })
    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.punch.flags).toEqual(["ON_TIME"])
    expect(body.needsApproval).toBe(false)
    expect(body.punch.businessDate).toBe("2026-08-04")
  })

  it("the same idempotency key never creates a second punch", async () => {
    const employee = await asEmployee()
    const first = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody(),
    })
    const second = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody(),
    })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)
    expect(second.json().idempotent).toBe(true)
    expect(store.punches).toHaveLength(1)
  })

  it("a second punch inside the minimum gap is refused as a duplicate", async () => {
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody(),
    })
    const duplicate = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ at: "2026-08-04T09:06", idempotencyKey: "key-0000002" }),
    })
    expect(duplicate.statusCode).toBe(409)
  })

  it("a late punch is RECORDED and flagged for approval — never rejected", async () => {
    const employee = await asEmployee()
    const response = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ at: "2026-08-04T09:40" }),
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().punch.flags).toContain("LATE")
    expect(response.json().needsApproval).toBe(true)
    expect(store.approvals.some((approval) => approval.kind === "REGULARISATION")).toBe(true)
  })

  it("outside the geofence is flagged, not blocked; field employees are exempt", async () => {
    const employee = await asEmployee()
    const far = { lat: 19.2, lng: 73.0 }
    const flagged = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ ...far }),
    })
    expect(flagged.statusCode).toBe(201)
    expect(flagged.json().punch.flags).toContain("OUT_OF_GEOFENCE")

    // Meera (e5) is a field employee — same coordinates, no flag.
    store.users.push({
      id: "u5",
      name: "Meera Joshi",
      email: "meera@delta.dev",
      passwordHash: store.users[3].passwordHash, // Emp@1234
      role: "EMPLOYEE",
      employeeId: "e5",
    })
    const meera = await login("meera@delta.dev", "Emp@1234")
    const exempt = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: meera.cookies },
      payload: punchBody({ ...far, employeeId: "e5", idempotencyKey: "key-0000009" }),
    })
    expect(exempt.statusCode).toBe(201)
    expect(exempt.json().punch.flags).not.toContain("OUT_OF_GEOFENCE")
  })

  it("hard block refuses out-of-window punches only when the admin turned it on", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { cookie: admin.cookies },
      payload: { hardBlockOutsideWindow: true },
    })
    const employee = await asEmployee()
    const response = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ at: "2026-08-04T09:40" }),
    })
    expect(response.statusCode).toBe(422)
    expect(store.punches).toHaveLength(0)
  })

  it("stores the selfie derivatives and serves the thumb on the day row", async () => {
    const employee = await asEmployee()
    const response = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({
        at: "2026-08-04T09:00",
        idempotencyKey: "key-selfie-01",
        selfieThumb: "data:image/webp;base64,dGh1bWI=",
        selfieView: "data:image/webp;base64,dmlldw==",
      }),
    })
    expect(response.statusCode).toBe(201)

    const admin = await asAdmin()
    const days = await app.inject({
      method: "GET",
      url: "/attendance/days?date=2026-08-04",
      headers: { cookie: admin.cookies },
    })
    const row = days.json().rows.find((entry: { code: string }) => entry.code === "DLT0004")
    expect(row.selfieThumb).toBe("data:image/webp;base64,dGh1bWI=")
  })

  it("rejects an oversized selfie instead of storing a raw camera frame", async () => {
    const employee = await asEmployee()
    const response = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({
        idempotencyKey: "key-selfie-02",
        selfieThumb: `data:image/webp;base64,${"A".repeat(40_000)}`,
      }),
    })
    expect(response.statusCode).toBe(400)
    expect(store.punches).toHaveLength(0)
  })

  it("an offline-queued punch is flagged OFFLINE_SYNCED with the sync delay recorded", async () => {
    const employee = await asEmployee()
    const response = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({
        at: "2026-08-04T09:00",
        idempotencyKey: "key-offline-01",
        queuedOffline: true,
      }),
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().punch.flags).toContain("OFFLINE_SYNCED")
    expect(response.json().punch.syncDeltaSec).toBeGreaterThanOrEqual(0)
    expect(response.json().needsApproval).toBe(true)
  })

  it("a 01:05 punch on a night shift lands on the previous business date", async () => {
    store.users.push({
      id: "u6",
      name: "Aditya Rao",
      email: "aditya@delta.dev",
      passwordHash: store.users[3].passwordHash,
      role: "EMPLOYEE",
      employeeId: "e6",
    })
    const aditya = await login("aditya@delta.dev", "Emp@1234")
    const response = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: aditya.cookies },
      payload: punchBody({ employeeId: "e6", at: "2026-08-05T01:05", idempotencyKey: "key-0000011" }),
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().punch.businessDate).toBe("2026-08-04")
  })
})

describe("attendance days — the engine served live", () => {
  it("computes PRESENT 1.0 from a full punched day", async () => {
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ at: "2026-08-04T09:00", idempotencyKey: "key-0000021" }),
    })
    await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ type: "OUT", at: "2026-08-04T18:05", idempotencyKey: "key-0000022" }),
    })

    const admin = await asAdmin()
    const response = await app.inject({
      method: "GET",
      url: "/attendance/days?date=2026-08-04",
      headers: { cookie: admin.cookies },
    })
    expect(response.statusCode).toBe(200)
    const row = response.json().rows.find((entry: { code: string }) => entry.code === "DLT0004")
    expect(row.status).toBe("PRESENT")
    expect(row.payableUnits).toBe(1)
  })

  it("a holiday is paid for everyone with no punches", async () => {
    const admin = await asAdmin()
    const response = await app.inject({
      method: "GET",
      url: "/attendance/days?date=2026-08-15",
      headers: { cookie: admin.cookies },
    })
    for (const row of response.json().rows) {
      expect(row.status).toBe("HOLIDAY")
      expect(row.payableUnits).toBe(1)
    }
  })
})

describe("leave — apply, balance guard, approve", () => {
  it("applying beyond the balance is refused with the numbers", async () => {
    const employee = await asEmployee()
    const response = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-08-03", to: "2026-08-14", part: "FULL" },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().error).toBe("INSUFFICIENT_BALANCE")
  })

  it("a valid application goes to PENDING with sandwich-aware units", async () => {
    const employee = await asEmployee()
    // Fri 7th → Mon 10th, sandwich off by default → 3 units, not 4.
    const response = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-08-07", to: "2026-08-10", part: "FULL" },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().units).toBe(3)
    expect(response.json().approval.status).toBe("PENDING")
  })

  it("the reporting manager can approve their report's leave; the balance moves", async () => {
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-08-05", to: "2026-08-06", part: "FULL" },
    })
    const approvalId = applied.json().approval.id

    const ops = await asOps() // e3 manages e4
    const decided = await app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: ops.cookies },
      payload: { action: "APPROVE", remarks: "Covered by the shift supervisor" },
    })
    expect(decided.statusCode).toBe(200)

    const balances = await app.inject({
      method: "GET",
      url: "/leave/balances/e4",
      headers: { cookie: ops.cookies },
    })
    expect(balances.json().balances.CL).toBe(5) // 7 − 2
  })

  it("OWN_TEAM does not reach an employee outside the approver's team", async () => {
    // e2 (HR person as an *employee*) reports to e1, not e3.
    const hr = await asHr()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: hr.cookies },
      payload: { type: "LOP", from: "2026-08-05", to: "2026-08-05", part: "FULL" },
    })
    const approvalId = applied.json().approval.id

    const ops = await asOps()
    const decided = await app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: ops.cookies },
      payload: { action: "APPROVE" },
    })
    expect(decided.statusCode).toBe(403)
  })

  it("nobody approves their own request, whatever their scope", async () => {
    const admin = await asAdmin()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: admin.cookies },
      payload: { type: "LOP", from: "2026-08-05", to: "2026-08-05", part: "FULL" },
    })
    const approvalId = applied.json().approval.id
    const decided = await app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: admin.cookies },
      payload: { action: "APPROVE" },
    })
    expect(decided.statusCode).toBe(403)
    expect(decided.json().error).toBe("CANNOT_DECIDE_OWN")
  })

  it("deciding twice is a conflict", async () => {
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-08-05", to: "2026-08-05", part: "FULL" },
    })
    const approvalId = applied.json().approval.id
    const ops = await asOps()
    await app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: ops.cookies },
      payload: { action: "REJECT", remarks: "Month-end" },
    })
    const again = await app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: ops.cookies },
      payload: { action: "APPROVE" },
    })
    expect(again.statusCode).toBe(409)
  })
})

describe("nightly close — §3 missed punch-out", () => {
  it("raises one regularisation per open day, idempotently", async () => {
    const { runNightlyClose } = await import("../src/nightly")
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ at: "2026-08-04T09:00", idempotencyKey: "key-nightly-1" }),
    })

    const first = runNightlyClose(store, "2026-08-04")
    expect(first.closed).toEqual(["e4"])
    const second = runNightlyClose(store, "2026-08-04")
    expect(second.closed).toEqual([])
    expect(
      store.approvals.filter((approval) => approval.subject.startsWith("Missed punch-out"))
    ).toHaveLength(1)
  })

  it("a completed day is left alone", async () => {
    const { runNightlyClose } = await import("../src/nightly")
    const employee = await asEmployee()
    for (const [type, at, key] of [
      ["IN", "2026-08-04T09:00", "key-nightly-2"],
      ["OUT", "2026-08-04T18:00", "key-nightly-3"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/punches",
        headers: { cookie: employee.cookies },
        payload: punchBody({ type, at, idempotencyKey: key }),
      })
    }
    expect(runNightlyClose(store, "2026-08-04").closed).toEqual([])
  })
})

describe("§8.6 hardening", () => {
  it("five failed logins lock the account; the right password is then refused too", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await login("employee@delta.dev", "wrong-password")
    }
    const locked = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "employee@delta.dev", password: "Emp@1234" },
    })
    expect(locked.statusCode).toBe(423)
    expect(locked.json().retryAfterSec).toBeGreaterThan(0)
  })

  it("a success clears the failure counter", async () => {
    await login("employee@delta.dev", "wrong-password")
    await login("employee@delta.dev", "wrong-password")
    const ok = await login("employee@delta.dev", "Emp@1234")
    expect(ok.response.statusCode).toBe(200)
    for (let attempt = 0; attempt < 4; attempt++) {
      await login("employee@delta.dev", "wrong-password")
    }
    // 4 fresh failures after the reset: still not locked.
    const stillOpen = await login("employee@delta.dev", "Emp@1234")
    expect(stillOpen.response.statusCode).toBe(200)
  })
})

describe("§6 payroll — lock then run, exact paise", () => {
  it("running an unlocked month is refused outright", async () => {
    const admin = await asAdmin()
    const response = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe("MONTH_NOT_LOCKED")
  })

  it("lock → run computes exact per-day maths; locking twice is a conflict", async () => {
    const admin = await asAdmin()
    const locked = await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })
    expect(locked.statusCode).toBe(201)
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/payroll/locks",
          headers: { cookie: admin.cookies },
          payload: { month: "2026-09" },
        })
      ).statusCode
    ).toBe(409)

    const run = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })
    expect(run.statusCode).toBe(201)
    const body = run.json().run

    // Sept 2026 with no punches: only the 4 Sundays are payable (paid weekly
    // offs); every working day is ABSENT. Kabir: ₹26,000 FIXED_26 → ₹1,000/day
    // → exactly ₹4,000.00.
    const kabir = body.items.find((item: { code: string }) => item.code === "DLT0004")
    expect(kabir.payableDays).toBe(4)
    expect(kabir.perDayPaise).toBe(100_000)
    expect(kabir.earnedPaise).toBe(400_000)
    expect(kabir.grossPaise).toBe(400_000)
    expect(body.totalGrossPaise).toBe(
      body.items.reduce((sum: number, item: { grossPaise: number }) => sum + item.grossPaise, 0)
    )
  })

  it("a rerun is a new immutable version, and EMPLOYEE cannot touch payroll", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })
    await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })
    const second = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })
    expect(second.json().run.version).toBe(2)

    const employee = await asEmployee()
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/payroll",
          headers: { cookie: employee.cookies },
        })
      ).statusCode
    ).toBe(403)
  })
})

describe("employees & shifts — full CRUD surface", () => {
  it("PATCH /employees/:id updates fields, guards references, audits", async () => {
    const admin = await asAdmin()
    const ok = await app.inject({
      method: "PATCH",
      url: "/employees/e4",
      headers: { cookie: admin.cookies },
      payload: { department: "Finance", shiftId: "night" },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().employee).toMatchObject({ id: "e4", department: "Finance", shiftId: "night" })

    const badShift = await app.inject({
      method: "PATCH",
      url: "/employees/e4",
      headers: { cookie: admin.cookies },
      payload: { shiftId: "ghost" },
    })
    expect(badShift.statusCode).toBe(422)
    expect(badShift.json().error).toBe("UNKNOWN_SHIFT")

    const selfManager = await app.inject({
      method: "PATCH",
      url: "/employees/e4",
      headers: { cookie: admin.cookies },
      payload: { managerId: "e4" },
    })
    expect(selfManager.statusCode).toBe(422)
    expect(selfManager.json().error).toBe("BAD_MANAGER")

    expect(
      (await app.inject({ method: "PATCH", url: "/employees/missing", headers: { cookie: admin.cookies }, payload: {} }))
        .statusCode
    ).toBe(404)
  })

  it("employee PATCH requires employee.manage write — EMPLOYEE role is refused", async () => {
    const employee = await asEmployee()
    const denied = await app.inject({
      method: "PATCH",
      url: "/employees/e4",
      headers: { cookie: employee.cookies },
      payload: { department: "Finance" },
    })
    expect(denied.statusCode).toBe(403)
  })

  it("GET /shifts lists for any signed-in user; create/update are config.manage writes", async () => {
    const employee = await asEmployee()
    const list = await app.inject({ method: "GET", url: "/shifts", headers: { cookie: employee.cookies } })
    expect(list.statusCode).toBe(200)
    expect(list.json().shifts.map((shift: { id: string }) => shift.id)).toContain("gen")

    const deniedCreate = await app.inject({
      method: "POST",
      url: "/shifts",
      headers: { cookie: employee.cookies },
      payload: { name: "Evening", short: "E", startMin: 840, endMin: 1320, breakMin: 30 },
    })
    expect(deniedCreate.statusCode).toBe(403)

    const admin = await asAdmin()
    const created = await app.inject({
      method: "POST",
      url: "/shifts",
      headers: { cookie: admin.cookies },
      payload: { name: "Evening", short: "E", startMin: 840, endMin: 1320, breakMin: 30 },
    })
    expect(created.statusCode).toBe(201)
    const shiftId = created.json().shift.id

    const updated = await app.inject({
      method: "PATCH",
      url: `/shifts/${shiftId}`,
      headers: { cookie: admin.cookies },
      payload: { breakMin: 45 },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().shift.breakMin).toBe(45)

    // The new shift is immediately usable as an employee reference.
    const assign = await app.inject({
      method: "PATCH",
      url: "/employees/e4",
      headers: { cookie: admin.cookies },
      payload: { shiftId },
    })
    expect(assign.statusCode).toBe(200)
    expect(assign.json().employee.shiftId).toBe(shiftId)
  })

  it("shift POST rejects a malformed spec (minutes out of range)", async () => {
    const admin = await asAdmin()
    const bad = await app.inject({
      method: "POST",
      url: "/shifts",
      headers: { cookie: admin.cookies },
      payload: { name: "Broken", short: "B", startMin: 2000, endMin: 1080 },
    })
    expect(bad.statusCode).toBe(400)
  })
})

describe("Tally export — balanced journal from a released run", () => {
  it("locks, runs, then downloads a balanced voucher XML; guards work", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })
    const runResponse = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })
    expect(runResponse.statusCode).toBe(201)
    const runId = runResponse.json().run.id

    const xml = await app.inject({
      method: "GET",
      url: `/payroll/runs/${runId}/tally.xml`,
      headers: { cookie: admin.cookies },
    })
    expect(xml.statusCode).toBe(200)
    expect(xml.headers["content-type"]).toContain("application/xml")
    expect(xml.headers["content-disposition"]).toContain("Tally_Salary_2026-09")
    const body = xml.body
    expect(body).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>")
    expect(body).toContain('VCHTYPE="Journal"')
    // Balanced: the debit is the negated sum of the credit side.
    const amounts = [...body.matchAll(/<AMOUNT>(-?\d+\.\d{2})<\/AMOUNT>/g)].map((m) => Number(m[1]))
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 5)

    expect(
      (await app.inject({ method: "GET", url: "/payroll/runs/ghost/tally.xml", headers: { cookie: admin.cookies } }))
        .statusCode
    ).toBe(404)
    const employee = await asEmployee()
    expect(
      (await app.inject({ method: "GET", url: `/payroll/runs/${runId}/tally.xml`, headers: { cookie: employee.cookies } }))
        .statusCode
    ).toBe(403)
  })
})

describe("password lifecycle — the seeded logins are no longer permanent", () => {
  it("changes own password, invalidates the old one, and never leaks the hash", async () => {
    const admin = await asAdmin()
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie: admin.cookies },
      payload: { currentPassword: "NotMyPassword", newPassword: "a-much-longer-secret" },
    })
    expect(wrong.statusCode).toBe(403)

    const short = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie: admin.cookies },
      payload: { currentPassword: "Admin@123", newPassword: "short" },
    })
    expect(short.statusCode).toBe(400)

    const changed = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie: admin.cookies },
      payload: { currentPassword: "Admin@123", newPassword: "correct-horse-battery" },
    })
    expect(changed.statusCode).toBe(200)
    expect(JSON.stringify(changed.json())).not.toContain("$2")

    expect((await login("admin@delta.dev", "Admin@123")).response.statusCode).toBe(401)
    expect((await login("admin@delta.dev", "correct-horse-battery")).response.statusCode).toBe(200)
  })

  it("anonymous cannot change a password; a plain employee cannot reset someone else's", async () => {
    expect(
      (await app.inject({ method: "POST", url: "/auth/change-password", payload: {} })).statusCode
    ).toBe(401)
    const employee = await asEmployee()
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/users/u1/reset-password",
          headers: { cookie: employee.cookies },
          payload: { newPassword: "another-long-password" },
        })
      ).statusCode
    ).toBe(403)
  })

  it("admin resets a locked-out user's password and clears the lockout", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await login("employee@delta.dev", "wrong-password")
    }
    expect((await login("employee@delta.dev", "Emp@1234")).response.statusCode).toBe(423)

    const admin = await asAdmin()
    const target = store.users.find((user) => user.email === "employee@delta.dev")!
    const reset = await app.inject({
      method: "POST",
      url: `/users/${target.id}/reset-password`,
      headers: { cookie: admin.cookies },
      payload: { newPassword: "issued-by-admin-2026" },
    })
    expect(reset.statusCode).toBe(200)
    expect((await login("employee@delta.dev", "issued-by-admin-2026")).response.statusCode).toBe(200)
  })
})

describe("referential guards on employee creation", () => {
  it("refuses an unknown shift, an unknown branch and a duplicate code", async () => {
    const admin = await asAdmin()
    const base = {
      code: "DLT9001",
      name: "New Hire",
      email: "new.hire@delta.dev",
      department: "Operations",
      branchId: "b1",
      shiftId: "gen",
      isFieldEmployee: false,
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/employees",
          headers: { cookie: admin.cookies },
          payload: { ...base, shiftId: "ghost" },
        })
      ).json().error
    ).toBe("UNKNOWN_SHIFT")
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/employees",
          headers: { cookie: admin.cookies },
          payload: { ...base, branchId: "ghost" },
        })
      ).json().error
    ).toBe("UNKNOWN_BRANCH")

    const created = await app.inject({
      method: "POST",
      url: "/employees",
      headers: { cookie: admin.cookies },
      payload: base,
    })
    expect(created.statusCode).toBe(201)
    const duplicate = await app.inject({
      method: "POST",
      url: "/employees",
      headers: { cookie: admin.cookies },
      payload: { ...base, email: "other@delta.dev" },
    })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error).toBe("DUPLICATE_CODE")
  })
})

describe("leave balance is re-checked at approval, not only at apply", () => {
  it("refuses the second approval instead of driving the ledger negative", async () => {
    const employee = await asEmployee()
    const target = store.employees.find((row) => row.id === "e4")!

    // Trim the CL balance to exactly one day so two single-day requests are
    // each individually affordable but not both — the race the guard exists for.
    const available = store.ledger
      .filter((row) => row.employeeId === target.id && row.type === "CL")
      .reduce((sum, row) => sum + row.units, 0)
    expect(available).toBeGreaterThan(1)
    store.ledger.push({
      id: "l_trim",
      employeeId: target.id,
      type: "CL",
      txnType: "ADJUST",
      units: -(available - 1),
      date: "2026-09-01",
      remarks: "test fixture",
    })

    const raise = async (date: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/leave/apply",
        headers: { cookie: employee.cookies },
        payload: { type: "CL", from: date, to: date, part: "FULL", reason: "test" },
      })
      expect(response.statusCode).toBe(201)
      return response.json().approval.id
    }
    // Mondays — never a weekly off, so each is exactly one leave unit.
    const first = await raise("2026-09-07")
    const second = await raise("2026-09-14")

    const manager = await asOps()
    const decide = (approvalId: string) =>
      app.inject({
        method: "POST",
        url: `/approvals/${approvalId}/decide`,
        headers: { cookie: manager.cookies },
        payload: { action: "APPROVE", remarks: "ok" },
      })

    expect((await decide(first)).statusCode).toBe(200)
    const overdrawn = await decide(second)
    expect(overdrawn.statusCode).toBe(409)
    expect(overdrawn.json().error).toBe("INSUFFICIENT_BALANCE")

    // The balance route still answers — the ledger was never poisoned.
    const balances = await app.inject({
      method: "GET",
      url: `/leave/balances/${target.id}`,
      headers: { cookie: manager.cookies },
    })
    expect(balances.statusCode).toBe(200)
    expect(balances.json().balances.CL).toBe(0)
  })
})

describe("salary disbursement — bank details and the transfer sheet", () => {
  const bank = {
    accountName: "Meera Joshi",
    accountNumber: "12345678901",
    ifsc: "ICIC0004321",
    bankName: "ICICI Bank",
    pan: "AAAPZ1234C",
    uan: "100200300401",
  }

  it("never returns a full account number, and validates before saving", async () => {
    const admin = await asAdmin()
    const listed = await app.inject({
      method: "GET",
      url: "/salaries",
      headers: { cookie: admin.cookies },
    })
    expect(listed.statusCode).toBe(200)
    const seeded = listed.json().salaries.find((row: { employeeId: string }) => row.employeeId === "e4")
    expect(seeded.bank.accountNumber).toBe("****7890")
    expect(JSON.stringify(listed.json())).not.toContain("50100234567890")

    const badIfsc = await app.inject({
      method: "PUT",
      url: "/salaries/e5/bank",
      headers: { cookie: admin.cookies },
      payload: { ...bank, ifsc: "ICIC1004321" },
    })
    expect(badIfsc.statusCode).toBe(400)

    const saved = await app.inject({
      method: "PUT",
      url: "/salaries/e5/bank",
      headers: { cookie: admin.cookies },
      payload: bank,
    })
    expect(saved.statusCode).toBe(200)
  })

  it("bank details are payroll-scoped — a plain employee cannot read or write them", async () => {
    const employee = await asEmployee()
    expect(
      (await app.inject({ method: "GET", url: "/salaries", headers: { cookie: employee.cookies } }))
        .statusCode
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/salaries/e5/bank",
          headers: { cookie: employee.cookies },
          payload: bank,
        })
      ).statusCode
    ).toBe(403)
  })

  it("builds a bank CSV for a released run and reports who was held back", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })
    const run = (
      await app.inject({
        method: "POST",
        url: "/payroll/runs",
        headers: { cookie: admin.cookies },
        payload: { month: "2026-09" },
      })
    ).json().run

    const csv = await app.inject({
      method: "GET",
      url: `/payroll/runs/${run.id}/bank-transfer.csv`,
      headers: { cookie: admin.cookies },
    })
    expect(csv.statusCode).toBe(200)
    expect(csv.headers["content-type"]).toContain("text/csv")
    expect(csv.headers["content-disposition"]).toContain("BankTransfer_2026-09")
    expect(csv.body).toContain('"Beneficiary Name"')
    expect(csv.body).toContain('"HDFC0001234"')
    // Everyone without bank details is held back, not silently dropped.
    expect(Number(csv.headers["x-held-count"])).toBeGreaterThan(0)

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/payroll/runs/ghost/bank-transfer.csv",
          headers: { cookie: admin.cookies },
        })
      ).statusCode
    ).toBe(404)
  })
})

describe("regularisation — the employee's route to fix a missed punch", () => {
  const raise = (cookie: string, body: object) =>
    app.inject({ method: "POST", url: "/regularisations", headers: { cookie }, payload: body })

  const valid = {
    date: "2026-08-07",
    reason: "MISSED_OUT",
    outTime: "18:30",
    note: "Phone battery died before I could punch out.",
  }

  it("raises a request, and raising it changes no attendance by itself", async () => {
    const employee = await asEmployee()
    const before = store.punches.length
    const raised = await raise(employee.cookies, valid)
    expect(raised.statusCode).toBe(201)
    expect(raised.json().approval.kind).toBe("REGULARISATION")
    expect(raised.json().approval.status).toBe("PENDING")
    expect(store.punches.length).toBe(before)
  })

  it("refuses an empty correction, a future date, and a second pending request", async () => {
    const employee = await asEmployee()
    expect((await raise(employee.cookies, { ...valid, outTime: undefined })).statusCode).toBe(400)
    expect((await raise(employee.cookies, { ...valid, note: "x" })).statusCode).toBe(400)

    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    expect((await raise(employee.cookies, { ...valid, date: future })).statusCode).toBe(422)

    expect((await raise(employee.cookies, valid)).statusCode).toBe(201)
    const second = await raise(employee.cookies, valid)
    expect(second.statusCode).toBe(409)
    expect(second.json().error).toBe("ALREADY_PENDING")
  })

  it("refuses to touch a locked month — a paid period is corrected by an adjustment run", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-07" },
    })
    const employee = await asEmployee()
    const locked = await raise(employee.cookies, { ...valid, date: "2026-07-15" })
    expect(locked.statusCode).toBe(409)
    expect(locked.json().error).toBe("MONTH_LOCKED")
  })

  it("approval appends REGULARISED punches — never edits, never double-writes", async () => {
    const employee = await asEmployee()
    const approvalId = (await raise(employee.cookies, { ...valid, inTime: "09:05" })).json().approval
      .id

    const manager = await asOps()
    const decided = await app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "verified with the gate log" },
    })
    expect(decided.statusCode).toBe(200)

    const written = store.punches.filter(
      (punch) => punch.businessDate === "2026-08-07" && punch.flags.includes("REGULARISED")
    )
    expect(written).toHaveLength(2)
    // 09:05 against a 09:00 shift start is +5; 18:30 is +570.
    expect(written.find((punch) => punch.type === "IN")!.offsetMin).toBe(5)
    expect(written.find((punch) => punch.type === "OUT")!.offsetMin).toBe(570)

    // The corrected day now computes from those punches.
    const register = await app.inject({
      method: "GET",
      url: "/attendance/days?date=2026-08-07",
      headers: { cookie: manager.cookies },
    })
    const row = register
      .json()
      .rows.find((candidate: { employeeId: string }) => candidate.employeeId === "e4")
    expect(row.firstInAt).toBe("09:05")
    expect(row.lastOutAt).toBe("18:30")

    // Deciding again is refused, so punches cannot be written twice.
    const twice = await app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "again" },
    })
    expect(twice.statusCode).toBe(409)
    expect(
      store.punches.filter((punch) => punch.flags.includes("REGULARISED")).length
    ).toBe(2)
  })

  it("a rejected regularisation writes nothing", async () => {
    const employee = await asEmployee()
    const approvalId = (await raise(employee.cookies, valid)).json().approval.id
    const manager = await asOps()
    await app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "REJECT", remarks: "no gate record" },
    })
    expect(store.punches.filter((punch) => punch.flags.includes("REGULARISED"))).toHaveLength(0)
  })

  it("nobody can approve their own regularisation", async () => {
    const employee = await asEmployee()
    const approvalId = (await raise(employee.cookies, valid)).json().approval.id
    const own = await app.inject({
      method: "POST",
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: employee.cookies },
      payload: { action: "APPROVE", remarks: "trust me" },
    })
    expect(own.statusCode).toBe(403)
  })
})

describe("overtime is paid only when approved", () => {
  // Past dates: a claim for a day that has not happened is refused, and these
  // tests are about the approval gate rather than that guard.
  const OT_DAY = "2026-08-05"
  const PLAIN_DAY = "2026-08-06"

  /** e4 is the employee account's own employeeId, so it may punch for itself. */
  const workLate = async (cookie: string, date: string) => {
    for (const [type, at, key] of [
      ["IN", `${date}T09:00`, `ot-in-${date}`],
      ["OUT", `${date}T21:00`, `ot-out-${date}`],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/punches",
        headers: { cookie },
        payload: punchBody({ type, at, idempotencyKey: key }),
      })
      expect([200, 201]).toContain(response.statusCode)
    }
  }

  const lockAndRun = async (cookie: string, month: string) => {
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie },
      payload: { month },
    })
    const run = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie },
      payload: { month },
    })
    expect(run.statusCode).toBe(201)
    return run
      .json()
      .run.items.find((candidate: { employeeId: string }) => candidate.employeeId === "e4")
  }

  it("a day records eligible overtime, but an unclaimed day pays none of it", async () => {
    const employee = await asEmployee()
    await workLate(employee.cookies, OT_DAY)

    const admin = await asAdmin()
    const register = await app.inject({
      method: "GET",
      url: `/attendance/days?date=${OT_DAY}`,
      headers: { cookie: admin.cookies },
    })
    const row = register
      .json()
      .rows.find((candidate: { employeeId: string }) => candidate.employeeId === "e4")
    expect(row.otMinutes).toBeGreaterThan(0)

    // Worked late, nobody approved it — payroll pays zero overtime.
    const item = await lockAndRun(admin.cookies, "2026-08")
    expect(item.otMinutes).toBe(0)
    expect(item.otPaise).toBe(0)
  })

  it("claiming then approving makes payroll pay exactly the approved minutes", async () => {
    const employee = await asEmployee()
    await workLate(employee.cookies, OT_DAY)

    const claim = await app.inject({
      method: "POST",
      url: "/overtime/claims",
      headers: { cookie: employee.cookies },
      payload: { date: OT_DAY, note: "month-end dispatch" },
    })
    expect(claim.statusCode).toBe(201)
    const claimedMinutes = claim.json().otMinutes
    expect(claimedMinutes).toBeGreaterThan(0)

    // A second claim for the same day is refused.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/overtime/claims",
          headers: { cookie: employee.cookies },
          payload: { date: OT_DAY },
        })
      ).statusCode
    ).toBe(409)

    const manager = await asOps()
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/approvals/${claim.json().approval.id}/decide`,
          headers: { cookie: manager.cookies },
          payload: { action: "APPROVE", remarks: "dispatch confirmed" },
        })
      ).statusCode
    ).toBe(200)

    const admin = await asAdmin()
    const item = await lockAndRun(admin.cookies, "2026-08")
    expect(item.otMinutes).toBe(claimedMinutes)
    expect(item.otPaise).toBeGreaterThan(0)
  })

  it("refuses a claim on a day with no overtime, a future date, and a locked month", async () => {
    const employee = await asEmployee()
    const noOt = await app.inject({
      method: "POST",
      url: "/overtime/claims",
      headers: { cookie: employee.cookies },
      payload: { date: PLAIN_DAY },
    })
    expect(noOt.statusCode).toBe(422)
    expect(noOt.json().error).toBe("NO_OVERTIME_ON_DAY")

    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const ahead = await app.inject({
      method: "POST",
      url: "/overtime/claims",
      headers: { cookie: employee.cookies },
      payload: { date: future },
    })
    expect(ahead.statusCode).toBe(422)
    expect(ahead.json().error).toBe("FUTURE_DATE")

    await workLate(employee.cookies, OT_DAY)
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-08" },
    })
    const locked = await app.inject({
      method: "POST",
      url: "/overtime/claims",
      headers: { cookie: employee.cookies },
      payload: { date: OT_DAY },
    })
    expect(locked.statusCode).toBe(409)
    expect(locked.json().error).toBe("MONTH_LOCKED")
  })

  it("with otRequiresApproval off, the old auto-pay behaviour returns", async () => {
    store.settings.otRequiresApproval = false
    const employee = await asEmployee()
    await workLate(employee.cookies, OT_DAY)

    const admin = await asAdmin()
    const item = await lockAndRun(admin.cookies, "2026-08")
    expect(item.otMinutes).toBeGreaterThan(0)
  })
})

describe("nightly close runs on the company's calendar and self-heals", () => {
  it("re-running a date creates nothing twice", async () => {
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ type: "IN", at: "2026-08-05T09:00", idempotencyKey: "close-in-1" }),
    })

    const first = runNightlyClose(store, "2026-08-05")
    expect(first.closed).toContain("e4")
    const raised = store.approvals.filter(
      (approval) =>
        approval.kind === "REGULARISATION" && approval.subject.startsWith("Missed punch-out")
    ).length

    const second = runNightlyClose(store, "2026-08-05")
    expect(second.closed).toHaveLength(0)
    expect(
      store.approvals.filter(
        (approval) =>
          approval.kind === "REGULARISATION" && approval.subject.startsWith("Missed punch-out")
      )
    ).toHaveLength(raised)
  })

  it("a day that was already closed out is left alone", async () => {
    const employee = await asEmployee()
    for (const [type, key] of [
      ["IN", "closed-in"],
      ["OUT", "closed-out"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/punches",
        headers: { cookie: employee.cookies },
        payload: punchBody({
          type,
          at: `2026-08-04T${type === "IN" ? "09:00" : "18:00"}`,
          idempotencyKey: key,
        }),
      })
    }
    expect(runNightlyClose(store, "2026-08-04").closed).not.toContain("e4")
  })
})
