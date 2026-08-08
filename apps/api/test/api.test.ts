import { beforeEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { buildServer } from "../src/server"
import { seedStore, type Store } from "../src/store"
import { escalateStaleApprovals, expireCompOff, runNightlyClose } from "../src/nightly"
import { makeNotifier } from "../src/notify"

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
  it("tells the employee once, and never files on their behalf", async () => {
    const { runNightlyClose } = await import("../src/nightly")
    const notify = makeNotifier(store)
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ at: "2026-08-04T09:00", idempotencyKey: "key-nightly-1" }),
    })

    const first = runNightlyClose(store, "2026-08-04", notify)
    expect(first.closed).toEqual(["e4"])
    const second = runNightlyClose(store, "2026-08-04", notify)
    expect(second.closed).toEqual([])

    const told = store.notifications.filter(
      (entry) => entry.employeeId === "e4" && entry.kind === "PUNCH_FLAGGED"
    )
    expect(told).toHaveLength(1)
    expect(told[0].body).toContain("2026-08-04")

    // Crucially it raises nothing: a placeholder approval blocked the employee
    // from filing the real correction, and carried no times to write anyway.
    expect(
      store.approvals.filter((approval) => approval.dateFrom === "2026-08-04")
    ).toHaveLength(0)

    // So the employee can still file their own.
    const raised = await app.inject({
      method: "POST",
      url: "/regularisations",
      headers: { cookie: employee.cookies },
      payload: {
        date: "2026-08-04",
        reason: "MISSED_OUT",
        outTime: "18:30",
        note: "forgot to punch out",
      },
    })
    expect(raised.statusCode).toBe(201)
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

    /**
     * Sept 2026 with no punches at all. The register still marks the 4 Sundays
     * payable — they are paid days — but every one of the 26 expected working
     * days was lost, so the whole salary is deducted and the month pays ₹0.
     *
     * This assertion used to read ₹4,000, on the reasoning that the Sundays
     * were "payable" and could be multiplied by the day rate. That is how the
     * overpay got in: paying for weekly offs an employee never earned by
     * working. Somebody absent all month is owed nothing, and a fully present
     * employee is owed exactly their contract — both now hold.
     */
    const kabir = body.items.find((item: { code: string }) => item.code === "DLT0004")
    expect(kabir.payableDays).toBe(4)
    expect(kabir.perDayPaise).toBe(100_000)
    expect(kabir.earnedPaise).toBe(0)
    expect(kabir.grossPaise).toBe(0)
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
    // Somebody has to have earned something: with no attendance at all every
    // salary deducts to zero and the route correctly refuses (NOBODY_PAYABLE).
    for (const employee of store.employees) {
      for (let day = 1; day <= 30; day++) {
        const date = `2026-09-${String(day).padStart(2, "0")}`
        for (const [type, offsetMin] of [
          ["IN", 0],
          ["OUT", 540],
        ] as const) {
          store.punches.push({
            id: `p_bank_${employee.id}_${date}_${type}`,
            employeeId: employee.id,
            type,
            businessDate: date,
            offsetMin,
            at: `${date}T09:00`,
            accuracyM: 0,
            dayPart: "FULL",
            flags: ["ON_TIME"],
            idempotencyKey: `bank_${employee.id}_${date}_${type}`,
          })
        }
      }
    }
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

    const notify = makeNotifier(store)
    const first = runNightlyClose(store, "2026-08-05", notify)
    expect(first.closed).toContain("e4")
    const told = () =>
      store.notifications.filter(
        (entry) => entry.kind === "PUNCH_FLAGGED" && entry.body.includes("2026-08-05")
      ).length
    expect(told()).toBe(1)

    const second = runNightlyClose(store, "2026-08-05", notify)
    expect(second.closed).toHaveLength(0)
    expect(told()).toBe(1)
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

describe("comp-off — earn a day back, spend it, and lose it if unused", () => {
  // 2026-08-02 is a Sunday: the seed's weekly off.
  const OFF_DAY = "2026-08-02"

  const workTheOffDay = async (cookie: string, hours: number) => {
    for (const [type, at, key] of [
      ["IN", `${OFF_DAY}T09:00`, "compoff-in-1"],
      ["OUT", `${OFF_DAY}T${String(9 + hours).padStart(2, "0")}:00`, "compoff-out-1"],
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

  it("a full day worked on a weekly off earns one credit, once approved", async () => {
    const employee = await asEmployee()
    await workTheOffDay(employee.cookies, 9)

    const claim = await app.inject({
      method: "POST",
      url: "/comp-off/claims",
      headers: { cookie: employee.cookies },
      payload: { date: OFF_DAY, note: "stock count" },
    })
    expect(claim.statusCode).toBe(201)
    expect(claim.json().credit).toBe(1)

    // Claiming alone credits nothing.
    expect(store.ledger.filter((row) => row.type === "COMP_OFF" && row.units > 0)).toHaveLength(0)

    const manager = await asOps()
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/approvals/${claim.json().approval.id}/decide`,
          headers: { cookie: manager.cookies },
          payload: { action: "APPROVE", remarks: "confirmed" },
        })
      ).statusCode
    ).toBe(200)

    const credit = store.ledger.find(
      (row) => row.employeeId === "e4" && row.type === "COMP_OFF" && row.units > 0
    )!
    expect(credit.units).toBe(1)
    // Dated the day that was worked, because expiry counts from there.
    expect(credit.date).toBe(OFF_DAY)
    expect(credit.txnType).toBe("COMP_OFF_CREDIT")

    const balances = await app.inject({
      method: "GET",
      url: "/leave/balances/e4",
      headers: { cookie: manager.cookies },
    })
    expect(balances.json().balances.COMP_OFF).toBe(1)
  })

  it("half a day worked earns half a credit", async () => {
    const employee = await asEmployee()
    await workTheOffDay(employee.cookies, 5)
    const claim = await app.inject({
      method: "POST",
      url: "/comp-off/claims",
      headers: { cookie: employee.cookies },
      payload: { date: OFF_DAY },
    })
    expect(claim.json().credit).toBe(0.5)
  })

  it("refuses a working day, too few hours, a future date, and a second claim", async () => {
    const employee = await asEmployee()
    // A Tuesday is a normal working day — nothing to give back.
    const working = await app.inject({
      method: "POST",
      url: "/comp-off/claims",
      headers: { cookie: employee.cookies },
      payload: { date: "2026-08-04" },
    })
    expect(working.statusCode).toBe(422)
    expect(working.json().error).toBe("NOT_AN_OFF_DAY")

    await workTheOffDay(employee.cookies, 2)
    const tooShort = await app.inject({
      method: "POST",
      url: "/comp-off/claims",
      headers: { cookie: employee.cookies },
      payload: { date: OFF_DAY },
    })
    expect(tooShort.statusCode).toBe(422)
    expect(tooShort.json().error).toBe("NOT_ENOUGH_HOURS")

    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/comp-off/claims",
          headers: { cookie: employee.cookies },
          payload: { date: future },
        })
      ).statusCode
    ).toBe(422)
  })

  it("an earned credit is spendable as leave, and the balance guard still holds", async () => {
    const employee = await asEmployee()
    await workTheOffDay(employee.cookies, 9)
    const claim = await app.inject({
      method: "POST",
      url: "/comp-off/claims",
      headers: { cookie: employee.cookies },
      payload: { date: OFF_DAY },
    })
    const manager = await asOps()
    await app.inject({
      method: "POST",
      url: `/approvals/${claim.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "ok" },
    })

    // Spend it: a Monday, so it is one whole leave unit.
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "COMP_OFF", from: "2026-08-10", to: "2026-08-10", part: "FULL", reason: "rest" },
    })
    expect(applied.statusCode).toBe(201)
    await app.inject({
      method: "POST",
      url: `/approvals/${applied.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "ok" },
    })

    const balances = await app.inject({
      method: "GET",
      url: "/leave/balances/e4",
      headers: { cookie: manager.cookies },
    })
    expect(balances.json().balances.COMP_OFF).toBe(0)

    // Spending a credit that is no longer there is refused at apply time.
    const overdrawn = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "COMP_OFF", from: "2026-08-11", to: "2026-08-11", part: "FULL", reason: "again" },
    })
    expect(overdrawn.statusCode).toBe(422)
    expect(overdrawn.json().error).toBe("INSUFFICIENT_BALANCE")
  })

  it("an unused credit expires, and the sweep never expires it twice", async () => {
    const employee = await asEmployee()
    await workTheOffDay(employee.cookies, 9)
    const claim = await app.inject({
      method: "POST",
      url: "/comp-off/claims",
      headers: { cookie: employee.cookies },
      payload: { date: OFF_DAY },
    })
    const manager = await asOps()
    await app.inject({
      method: "POST",
      url: `/approvals/${claim.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "ok" },
    })

    // Well past the 90-day window.
    const first = expireCompOff(store, "2026-12-31")
    expect(first.expired).toBe(1)
    const second = expireCompOff(store, "2026-12-31")
    expect(second.expired).toBe(0)

    const balances = await app.inject({
      method: "GET",
      url: "/leave/balances/e4",
      headers: { cookie: manager.cookies },
    })
    expect(balances.json().balances.COMP_OFF).toBe(0)
  })
})

describe("/me/requests — scoped to the caller", () => {
  it("returns only my own requests and never another employee's", async () => {
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "mine" },
    })

    // Somebody else's request, so isolation is proven rather than assumed.
    const admin = await asAdmin()
    const theirs = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: admin.cookies },
      // LOP: allowed to go negative, so this does not depend on the actor's balance.
      payload: { type: "LOP", from: "2026-09-08", to: "2026-09-08", part: "FULL", reason: "theirs" },
    })
    expect(theirs.statusCode).toBe(201)

    const mine = await app.inject({
      method: "GET",
      url: "/me/requests",
      headers: { cookie: employee.cookies },
    })
    expect(mine.statusCode).toBe(200)
    const requests = mine.json().requests
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.map((request: { id: string }) => request.id)).not.toContain(
      theirs.json().approval.id
    )
    for (const request of requests) {
      expect(store.approvals.find((approval) => approval.id === request.id)!.employeeId).toBe("e4")
    }
  })

  it("filters by kind, so the leave screen fetches only leave", async () => {
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "mine" },
    })
    await app.inject({
      method: "POST",
      url: "/regularisations",
      headers: { cookie: employee.cookies },
      payload: {
        date: "2026-08-05",
        reason: "MISSED_OUT",
        outTime: "18:30",
        note: "battery died before punch out",
      },
    })

    const leaveOnly = await app.inject({
      method: "GET",
      url: "/me/requests?kind=LEAVE",
      headers: { cookie: employee.cookies },
    })
    const kinds = new Set(leaveOnly.json().requests.map((r: { kind: string }) => r.kind))
    expect([...kinds]).toEqual(["LEAVE"])

    const all = await app.inject({
      method: "GET",
      url: "/me/requests",
      headers: { cookie: employee.cookies },
    })
    expect(new Set(all.json().requests.map((r: { kind: string }) => r.kind)).size).toBeGreaterThan(1)
  })

  it("requires a session", async () => {
    expect((await app.inject({ method: "GET", url: "/me/requests" })).statusCode).toBe(401)
  })
})

describe("notifications and escalation actually reach people", () => {
  const feedFor = async (cookie: string) =>
    (await app.inject({ method: "GET", url: "/notifications", headers: { cookie } })).json()

  it("raising a request notifies the approver, not the whole company", async () => {
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })

    // e4 reports to e3, whose account is ops@delta.dev.
    const manager = await asOps()
    const managerFeed = await feedFor(manager.cookies)
    expect(managerFeed.unread).toBeGreaterThan(0)
    expect(managerFeed.notifications[0].kind).toBe("APPROVAL_RAISED")
    expect(managerFeed.notifications[0].body).toContain("Kabir Singh")

    // The requester is not told about their own request.
    const ownFeed = await feedFor(employee.cookies)
    expect(
      ownFeed.notifications.filter((n: { kind: string }) => n.kind === "APPROVAL_RAISED")
    ).toHaveLength(0)
  })

  it("a decision notifies the person who was waiting", async () => {
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    const manager = await asOps()
    await app.inject({
      method: "POST",
      url: `/approvals/${applied.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "enjoy" },
    })

    const feed = await feedFor(employee.cookies)
    const decided = feed.notifications.find((n: { kind: string }) => n.kind === "APPROVAL_DECIDED")
    expect(decided).toBeDefined()
    expect(decided.title).toContain("approved")
    expect(decided.body).toContain("enjoy")
  })

  it("marks everything read, and one feed is never another's", async () => {
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    const manager = await asOps()
    expect((await feedFor(manager.cookies)).unread).toBeGreaterThan(0)

    const marked = await app.inject({
      method: "POST",
      url: "/notifications/read",
      headers: { cookie: manager.cookies },
      payload: {},
    })
    expect(marked.json().marked).toBeGreaterThan(0)
    expect((await feedFor(manager.cookies)).unread).toBe(0)

    // Marking read on one account never touches another's feed.
    const admin = await asAdmin()
    const adminFeed = await feedFor(admin.cookies)
    for (const entry of adminFeed.notifications) {
      expect(entry.employeeId).toBe("e1")
    }
  })

  it("requires a session", async () => {
    expect((await app.inject({ method: "GET", url: "/notifications" })).statusCode).toBe(401)
  })

  it("escalates a stale request to L2 once, and tells both sides", async () => {
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    const approvalId = applied.json().approval.id
    const notify = makeNotifier(store)

    // Not yet due.
    expect(escalateStaleApprovals(store, new Date().toISOString(), notify).escalated).toBe(0)

    // Two days later, the configured default.
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const first = escalateStaleApprovals(store, later, notify)
    expect(first.escalated).toBeGreaterThan(0)
    expect(first.autoApproved).toBe(0)
    expect(store.approvals.find((a) => a.id === approvalId)!.level).toBe(2)

    // The sweep runs hourly — it must not escalate the same thing again.
    expect(escalateStaleApprovals(store, later, notify).escalated).toBe(0)

    const hr = await login("hr@delta.dev", "Hr@12345")
    const hrFeed = await feedFor(hr.cookies)
    expect(
      hrFeed.notifications.some((n: { kind: string }) => n.kind === "APPROVAL_ESCALATED")
    ).toBe(true)
    const ownFeed = await feedFor(employee.cookies)
    expect(
      ownFeed.notifications.some((n: { kind: string }) => n.kind === "APPROVAL_ESCALATED")
    ).toBe(true)
  })

  it("auto-approves on escalation only when the company opted in", async () => {
    store.settings.autoApproveOnEscalation = true
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const result = escalateStaleApprovals(store, later, makeNotifier(store))
    expect(result.autoApproved).toBeGreaterThan(0)
    expect(store.approvals.find((a) => a.id === applied.json().approval.id)!.status).toBe(
      "APPROVED"
    )
  })
})

describe("permissions matrix cannot be broken or locked out", () => {
  it("a partial save keeps every other permission intact", async () => {
    const admin = await asAdmin()
    const before = JSON.parse(JSON.stringify(store.matrix))

    // A stale tab sends one permission only — everything else must survive.
    const saved = await app.inject({
      method: "PUT",
      url: "/permissions",
      headers: { cookie: admin.cookies },
      payload: { "reports.view": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "NONE", EMPLOYEE: "NONE" } },
    })
    expect(saved.statusCode).toBe(200)
    expect(store.matrix["reports.view"].OPERATIONS).toBe("NONE")
    expect(store.matrix["leave.approve"]).toEqual(before["leave.approve"])
    expect(store.matrix["config.manage"]).toEqual(before["config.manage"])

    // The routes that index the matrix directly still work.
    const employee = await asEmployee()
    expect(
      (await app.inject({ method: "GET", url: "/approvals", headers: { cookie: employee.cookies } }))
        .statusCode
    ).toBe(200)
  })

  it("refuses a matrix that would leave nobody able to administer it", async () => {
    const admin = await asAdmin()
    const attempt = await app.inject({
      method: "PUT",
      url: "/permissions",
      headers: { cookie: admin.cookies },
      payload: {
        "config.manage": { ADMIN: "NONE", HR: "NONE", OPERATIONS: "NONE", EMPLOYEE: "NONE" },
      },
    })
    expect(attempt.statusCode).toBe(422)
    expect(attempt.json().error).toBe("WOULD_LOCK_OUT")
    // Nothing was written.
    expect(store.matrix["config.manage"].ADMIN).toBe("ALL")
  })

  it("drops unknown keys instead of storing them", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "PUT",
      url: "/permissions",
      headers: { cookie: admin.cookies },
      payload: { "made.up.permission": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "ALL", EMPLOYEE: "ALL" } },
    })
    expect(store.matrix["made.up.permission"]).toBeUndefined()
  })

  it("still requires config.manage at write scope", async () => {
    const hr = await asHr()
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/permissions",
          headers: { cookie: hr.cookies },
          payload: { "reports.view": { ADMIN: "ALL", HR: "ALL", OPERATIONS: "ALL", EMPLOYEE: "ALL" } },
        })
      ).statusCode
    ).toBe(403)
  })
})

describe("dates that do not exist are refused everywhere", () => {
  it("attendance routes reject an impossible calendar date", async () => {
    const employee = await asEmployee()
    // 2026 is not a leap year; 31 February never exists.
    for (const date of ["2026-02-29", "2026-02-31", "2026-13-01", "2026-04-31"]) {
      const response = await app.inject({
        method: "POST",
        url: "/regularisations",
        headers: { cookie: employee.cookies },
        payload: { date, reason: "MISSED_OUT", outTime: "18:30", note: "impossible date" },
      })
      expect(response.statusCode, `expected ${date} to be refused`).toBe(400)
    }
  })

  it("a real leap day is still accepted", async () => {
    const employee = await asEmployee()
    const response = await app.inject({
      method: "POST",
      url: "/regularisations",
      headers: { cookie: employee.cookies },
      payload: {
        date: "2024-02-29",
        reason: "MISSED_OUT",
        outTime: "18:30",
        note: "a genuine leap day",
      },
    })
    // Refused for being in a different month's business, not for the date shape.
    expect(response.statusCode).not.toBe(400)
  })

  it("billing documents reject an impossible date before any money maths runs", async () => {
    const ops = await login("ops@delta.dev", "Ops@1234")
    const invoice = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: { cookie: ops.cookies },
      payload: { soId: "so_1", date: "2026-02-31", dueDate: "2026-03-31" },
    })
    expect(invoice.statusCode).toBe(400)

    const estimate = await app.inject({
      method: "POST",
      url: "/estimates",
      headers: { cookie: ops.cookies },
      payload: {
        customerId: "cust1",
        date: "2026-13-45",
        lines: [{ itemId: "i1", qty: 1 }],
      },
    })
    expect(estimate.statusCode).toBe(400)
  })

  it("payroll month locks still reject a malformed month", async () => {
    const admin = await asAdmin()
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/payroll/locks",
          headers: { cookie: admin.cookies },
          payload: { month: "2026-13" },
        })
      ).statusCode
    ).toBe(400)
  })
})

describe("broken references fail by name, not by crashing", () => {
  it("a punch for an employee whose shift is gone answers 409 naming the shift", async () => {
    const employee = store.employees.find((row) => row.id === "e4")!
    employee.shiftId = "shift_that_vanished"
    // e4 punching for itself: the scope check passes, so the reference guard
    // is what answers.
    const actor = await asEmployee()
    const response = await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: actor.cookies },
      payload: punchBody({ employeeId: "e4", idempotencyKey: "dangling-1" }),
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      error: "DANGLING_SHIFT",
      employeeId: "e4",
      shiftId: "shift_that_vanished",
    })
  })

  it("a valid token for an employee who no longer exists is an expired session", async () => {
    const employee = await asEmployee()
    // A 30-day refresh token outlives a data restore.
    store.employees = store.employees.filter((row) => row.id !== "e4")
    const response = await app.inject({
      method: "POST",
      url: "/overtime/claims",
      headers: { cookie: employee.cookies },
      payload: { date: "2026-08-05" },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().error).toBe("EMPLOYEE_GONE")
  })

  it("deciding an approval whose employee was removed answers 409, not 500", async () => {
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    store.employees = store.employees.filter((row) => row.id !== "e4")

    const manager = await asOps()
    const response = await app.inject({
      method: "POST",
      url: `/approvals/${applied.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "ok" },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe("EMPLOYEE_GONE")
  })

  it("the daily register still renders for everyone when one employee's shift dangles", async () => {
    const broken = store.employees.find((row) => row.id === "e4")!
    broken.shiftId = "shift_that_vanished"
    const admin = await asAdmin()
    const register = await app.inject({
      method: "GET",
      url: "/attendance/days?date=2026-08-05",
      headers: { cookie: admin.cookies },
    })
    expect(register.statusCode).toBe(200)
    const rows = register.json().rows
    expect(rows.length).toBe(store.employees.length)
    // The broken row says so rather than taking the day down for everyone.
    expect(rows.find((row: { employeeId: string }) => row.employeeId === "e4").shiftName).toBe(
      "Shift missing"
    )
  })

  it("a payroll run refuses to omit anyone silently, naming who to fix", async () => {
    const broken = store.employees.find((row) => row.id === "e4")!
    broken.shiftId = "shift_that_vanished"
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-08" },
    })
    const run = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-08" },
    })
    expect(run.statusCode).toBe(500)
    expect(run.json().message ?? "").toContain("DLT0004")
  })
})

describe("auto-approval on escalation does everything a human decision does", () => {
  const balanceOf = (employeeId: string, type: string) =>
    store.ledger
      .filter((row) => row.employeeId === employeeId && row.type === type)
      .reduce((sum, row) => sum + row.units, 0)

  const later = () => new Date(Date.now() + 3 * 86_400_000).toISOString()

  it("debits the leave ledger — an auto-approved day is not a free day", async () => {
    store.settings.autoApproveOnEscalation = true
    const employee = await asEmployee()
    const before = balanceOf("e4", "CL")
    expect(before).toBeGreaterThan(0)

    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    const units = applied.json().units

    const result = escalateStaleApprovals(store, later(), makeNotifier(store))
    expect(result.autoApproved).toBeGreaterThan(0)
    // The whole point: the balance actually moved.
    expect(balanceOf("e4", "CL")).toBe(before - units)
  })

  it("refuses to auto-approve past the balance, leaving it for a person", async () => {
    store.settings.autoApproveOnEscalation = true
    const employee = await asEmployee()

    // Trim CL to exactly one day, then raise two single-day requests.
    const available = balanceOf("e4", "CL")
    store.ledger.push({
      id: "l_trim2",
      employeeId: "e4",
      type: "CL",
      txnType: "ADJUST",
      units: -(available - 1),
      date: "2026-09-01",
      remarks: "test fixture",
    })
    const ids: string[] = []
    for (const date of ["2026-09-07", "2026-09-14"]) {
      const raised = await app.inject({
        method: "POST",
        url: "/leave/apply",
        headers: { cookie: employee.cookies },
        payload: { type: "CL", from: date, to: date, part: "FULL", reason: "x" },
      })
      ids.push(raised.json().approval.id)
    }

    escalateStaleApprovals(store, later(), makeNotifier(store))

    const statuses = ids.map((id) => store.approvals.find((a) => a.id === id)!.status)
    // One approved, one held back — never both.
    expect(statuses.filter((s) => s === "APPROVED")).toHaveLength(1)
    expect(statuses.filter((s) => s === "PENDING")).toHaveLength(1)
    // And the ledger never went negative, so the balance route still answers.
    expect(balanceOf("e4", "CL")).toBe(0)
    const manager = await asOps()
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/leave/balances/e4",
          headers: { cookie: manager.cookies },
        })
      ).statusCode
    ).toBe(200)
  })

  it("writes the punches for an auto-approved regularisation", async () => {
    store.settings.autoApproveOnEscalation = true
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/regularisations",
      headers: { cookie: employee.cookies },
      payload: {
        date: "2026-08-05",
        reason: "MISSED_OUT",
        inTime: "09:05",
        outTime: "18:30",
        note: "gate reader missed my exit",
      },
    })

    escalateStaleApprovals(store, later(), makeNotifier(store))

    const written = store.punches.filter(
      (punch) => punch.businessDate === "2026-08-05" && punch.flags.includes("REGULARISED")
    )
    // Approving a regularisation without writing punches corrects nothing.
    expect(written).toHaveLength(2)
  })

  it("credits an auto-approved comp-off claim", async () => {
    store.settings.autoApproveOnEscalation = true
    const employee = await asEmployee()
    for (const [type, at, key] of [
      ["IN", "2026-08-02T09:00", "esc-co-in-1"],
      ["OUT", "2026-08-02T19:00", "esc-co-out-1"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/punches",
        headers: { cookie: employee.cookies },
        payload: punchBody({ type, at, idempotencyKey: key }),
      })
    }
    await app.inject({
      method: "POST",
      url: "/comp-off/claims",
      headers: { cookie: employee.cookies },
      payload: { date: "2026-08-02" },
    })

    escalateStaleApprovals(store, later(), makeNotifier(store))
    expect(balanceOf("e4", "COMP_OFF")).toBe(1)
  })
})

describe("payroll pays the contracted salary, not a multiplied-up day rate", () => {
  /** Punch a full day for e4 on every date given. */
  const workDays = (dates: string[]) => {
    for (const date of dates) {
      for (const [type, offsetMin] of [
        ["IN", 0],
        ["OUT", 540],
      ] as const) {
        store.punches.push({
          id: `p_${date}_${type}`,
          employeeId: "e4",
          type,
          businessDate: date,
          offsetMin,
          at: `${date}T09:00`,
          accuracyM: 0,
          dayPart: "FULL",
          flags: ["ON_TIME"],
          idempotencyKey: `pay_${date}_${type}`,
        })
      }
    }
  }
  const august = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`)

  const runFor = async (month: string) => {
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month },
    })
    const run = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie: admin.cookies },
      payload: { month },
    })
    expect(run.statusCode).toBe(201)
    return run.json().run.items.find((i: { employeeId: string }) => i.employeeId === "e4")
  }

  it("full attendance pays exactly the contract on each basis", async () => {
    const salary = store.salaries.find((row) => row.employeeId === "e4")!
    workDays(august)
    for (const basis of ["FIXED_26", "WORKING_DAYS", "CALENDAR_DAYS"] as const) {
      salary.basis = basis
      const item = await runFor("2026-08")
      // A 31-day month must not pay 31 days against a 26-day divisor.
      expect(item.earnedPaise, `basis ${basis}`).toBe(salary.grossMonthlyPaise)
    }
  })

  it("each absent working day costs exactly one twenty-sixth", async () => {
    const salary = store.salaries.find((row) => row.employeeId === "e4")!
    salary.basis = "FIXED_26"
    // 2026-08-04 and 08-05 are a Tuesday and Wednesday.
    workDays(august.filter((date) => !["2026-08-04", "2026-08-05"].includes(date)))
    const item = await runFor("2026-08")
    const perDay = Math.round(salary.grossMonthlyPaise / 26)
    expect(item.earnedPaise).toBe(salary.grossMonthlyPaise - 2 * perDay)
  })

  it("a weekly off is paid without being worked — it costs nothing", async () => {
    const salary = store.salaries.find((row) => row.employeeId === "e4")!
    salary.basis = "FIXED_26"
    // Every day except the Sundays.
    const sundays = august.filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0)
    expect(sundays.length).toBeGreaterThan(3)
    workDays(august.filter((date) => !sundays.includes(date)))
    const item = await runFor("2026-08")
    expect(item.earnedPaise).toBe(salary.grossMonthlyPaise)
  })
})

describe("a ledger whose rows are out of date order still works", () => {
  it("balance and apply routes survive a debit dated before its credit", async () => {
    // Exactly what boot hydration produces: rows ordered by business date, so
    // a backdated debit precedes the credit that funds it. This used to throw
    // inside reduceLedger and 500 every route that reads a balance — for good,
    // since the ledger is append-only and the repair routes were broken too.
    store.ledger = [
      {
        id: "l_debit_first",
        employeeId: "e4",
        type: "CL",
        txnType: "AVAIL",
        units: -3,
        date: "2025-12-29",
        remarks: "backdated leave, approved later",
      },
      {
        id: "l_credit_second",
        employeeId: "e4",
        type: "CL",
        txnType: "OPENING",
        units: 12,
        date: "2026-01-01",
        remarks: "annual opening",
      },
    ]

    const manager = await asOps()
    const balances = await app.inject({
      method: "GET",
      url: "/leave/balances/e4",
      headers: { cookie: manager.cookies },
    })
    expect(balances.statusCode).toBe(200)
    expect(balances.json().balances.CL).toBe(9)

    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    expect(applied.statusCode).toBe(201)

    // And a decision about that employee still resolves.
    const decided = await app.inject({
      method: "POST",
      url: `/approvals/${applied.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "ok" },
    })
    expect(decided.statusCode).toBe(200)
  })

  it("leave cannot be applied into a locked, already-paid month", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-07" },
    })
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-07-15", to: "2026-07-15", part: "FULL", reason: "x" },
    })
    expect(applied.statusCode).toBe(409)
    expect(applied.json().error).toBe("MONTH_LOCKED")
  })
})

describe("an escalated approval survives a restart", () => {
  it("re-persisting an existing approval updates it rather than failing silently", async () => {
    // The in-memory half of the bug: escalation mutates the approval and calls
    // persistApproval, which used to be a bare create. The insert violated the
    // primary key, the error was swallowed, and the request hydrated as PENDING
    // again on restart — while its ledger debit had already been written, so a
    // second approval debited the employee twice for one absence.
    store.settings.autoApproveOnEscalation = true
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    const approvalId = applied.json().approval.id

    const later = new Date(Date.now() + 3 * 86_400_000).toISOString()
    escalateStaleApprovals(store, later, makeNotifier(store))

    const approval = store.approvals.find((row) => row.id === approvalId)!
    expect(approval.status).toBe("APPROVED")
    expect(approval.level).toBe(2)
    expect(approval.decidedBy).toBe("system")

    // Exactly one debit exists for it, and re-running the sweep adds none.
    const debits = () =>
      store.ledger.filter((row) => row.remarks.includes(approvalId) && row.units < 0)
    expect(debits()).toHaveLength(1)
    escalateStaleApprovals(store, later, makeNotifier(store))
    expect(debits()).toHaveLength(1)
  })
})

describe("the late-mark penalty reaches pay, not just the register", () => {
  it("payroll prices the same day the register shows", async () => {
    store.settings.latePenalty = "ABSENT"
    store.settings.lateMarksAllowed = 2
    const employee = await asEmployee()

    // Late every working day of August, well past the 15-minute grace.
    const workingDays: string[] = []
    for (let day = 1; day <= 31; day++) {
      const date = `2026-08-${String(day).padStart(2, "0")}`
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue
      workingDays.push(date)
      for (const [type, offsetMin] of [
        ["IN", 30],
        ["OUT", 540],
      ] as const) {
        store.punches.push({
          id: `p_late_${date}_${type}`,
          employeeId: "e4",
          type,
          businessDate: date,
          offsetMin,
          at: `${date}T09:30`,
          accuracyM: 0,
          dayPart: "FULL",
          flags: ["LATE"],
          idempotencyKey: `latepay_${date}_${type}`,
        })
      }
    }

    // The register marks the days past the allowance ABSENT.
    const admin = await asAdmin()
    const lateDay = workingDays[10]
    const register = await app.inject({
      method: "GET",
      url: `/attendance/days?date=${lateDay}`,
      headers: { cookie: admin.cookies },
    })
    const row = register
      .json()
      .rows.find((candidate: { employeeId: string }) => candidate.employeeId === "e4")
    expect(row.status).toBe("ABSENT")

    // Payroll used to pass priorLateMarks: 0 and pay those days in full.
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-08" },
    })
    const run = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-08" },
    })
    const item = run
      .json()
      .run.items.find((candidate: { employeeId: string }) => candidate.employeeId === "e4")
    const salary = store.salaries.find((row) => row.employeeId === "e4")!
    expect(item.earnedPaise).toBeLessThan(salary.grossMonthlyPaise)
  })

  it("the first late day is not itself a prior mark", async () => {
    store.settings.latePenalty = "ABSENT"
    store.settings.lateMarksAllowed = 0
    const employee = await asEmployee()
    await app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie: employee.cookies },
      payload: punchBody({ type: "IN", at: "2026-08-04T09:30", idempotencyKey: "firstlate-1" }),
    })

    const admin = await asAdmin()
    const register = await app.inject({
      method: "GET",
      url: "/attendance/days?date=2026-08-04",
      headers: { cookie: admin.cookies },
    })
    const row = register
      .json()
      .rows.find((candidate: { employeeId: string }) => candidate.employeeId === "e4")
    // With 0 allowed this day is penalised — but on its own count, not on a
    // count that included itself and every later day of the month.
    expect(row.lateMinutes).toBeGreaterThan(0)
  })
})

describe("an earned comp-off day can actually be spent", () => {
  it("earn on a weekly off, then take it as leave", async () => {
    const employee = await asEmployee()
    // 2026-08-02 is a Sunday.
    for (const [type, at, key] of [
      ["IN", "2026-08-02T09:00", "spend-co-in-1"],
      ["OUT", "2026-08-02T19:00", "spend-co-out-1"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/punches",
        headers: { cookie: employee.cookies },
        payload: punchBody({ type, at, idempotencyKey: key }),
      })
    }
    const claim = await app.inject({
      method: "POST",
      url: "/comp-off/claims",
      headers: { cookie: employee.cookies },
      payload: { date: "2026-08-02" },
    })
    expect(claim.statusCode).toBe(201)

    const manager = await asOps()
    await app.inject({
      method: "POST",
      url: `/approvals/${claim.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "ok" },
    })

    // The whole point: the code the balance is filed under is the code the
    // application asks for. These used to be COMP_OFF and CO respectively, so
    // a real balance was refused for insufficient balance.
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: {
        type: "COMP_OFF",
        from: "2026-09-07",
        to: "2026-09-07",
        part: "FULL",
        reason: "taking the day back",
      },
    })
    expect(applied.statusCode).toBe(201)
  })

  it("a leave type nobody defined is refused rather than filed", async () => {
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CO", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    expect(applied.statusCode).toBe(400)
  })
})

describe("the bank sheet says who it leaves out", () => {
  it("previews the held list instead of hiding it in a header", async () => {
    const admin = await asAdmin()
    // Give everyone a payable month so the file is genuinely producible.
    for (const employee of store.employees) {
      for (let day = 1; day <= 30; day++) {
        const date = `2026-09-${String(day).padStart(2, "0")}`
        for (const [type, offsetMin] of [
          ["IN", 0],
          ["OUT", 540],
        ] as const) {
          store.punches.push({
            id: `p_prev_${employee.id}_${date}_${type}`,
            employeeId: employee.id,
            type,
            businessDate: date,
            offsetMin,
            at: `${date}T09:00`,
            accuracyM: 0,
            dayPart: "FULL",
            flags: ["ON_TIME"],
            idempotencyKey: `prev_${employee.id}_${date}_${type}`,
          })
        }
      }
    }
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

    const preview = await app.inject({
      method: "GET",
      url: `/payroll/runs/${run.id}/bank-transfer.csv?preview=1`,
      headers: { cookie: admin.cookies },
    })
    expect(preview.statusCode).toBe(200)
    const body = preview.json()
    // Only e4 has bank details seeded, so everyone else is named and explained.
    expect(body.payable).toBe(1)
    expect(body.held.length).toBeGreaterThan(0)
    expect(body.held[0]).toHaveProperty("reason")
    expect(body.held[0]).toHaveProperty("name")
    expect(body.held.every((entry: { reason: string }) => entry.reason.length > 0)).toBe(true)

    // The file itself is unchanged.
    const csv = await app.inject({
      method: "GET",
      url: `/payroll/runs/${run.id}/bank-transfer.csv`,
      headers: { cookie: admin.cookies },
    })
    expect(csv.statusCode).toBe(200)
    expect(csv.headers["content-type"]).toContain("text/csv")
  })
})

describe("a month that closes mid-flight cannot be written into", () => {
  it("refuses to approve leave once its month is locked", async () => {
    const employee = await asEmployee()
    const applied = await app.inject({
      method: "POST",
      url: "/leave/apply",
      headers: { cookie: employee.cookies },
      payload: { type: "CL", from: "2026-09-07", to: "2026-09-07", part: "FULL", reason: "x" },
    })
    expect(applied.statusCode).toBe(201)

    // The lock lands between raising and deciding — the gap the raise-time
    // check alone could not cover.
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-09" },
    })

    const manager = await asOps()
    const decided = await app.inject({
      method: "POST",
      url: `/approvals/${applied.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "ok" },
    })
    expect(decided.statusCode).toBe(409)
    expect(decided.json().error).toBe("MONTH_LOCKED")
    // Nothing was written to the ledger.
    expect(
      store.ledger.filter((row) => row.remarks.includes(applied.json().approval.id))
    ).toHaveLength(0)
  })

  it("comp-off is exempt — its credit does not change the paid month", async () => {
    const employee = await asEmployee()
    for (const [type, at, key] of [
      ["IN", "2026-08-02T09:00", "lockco-in-1"],
      ["OUT", "2026-08-02T19:00", "lockco-out-1"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: "/punches",
        headers: { cookie: employee.cookies },
        payload: punchBody({ type, at, idempotencyKey: key }),
      })
    }
    const claim = await app.inject({
      method: "POST",
      url: "/comp-off/claims",
      headers: { cookie: employee.cookies },
      payload: { date: "2026-08-02" },
    })
    expect(claim.statusCode).toBe(201)

    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-08" },
    })

    const manager = await asOps()
    const decided = await app.inject({
      method: "POST",
      url: `/approvals/${claim.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "earned it" },
    })
    // Stranding a day the employee earned, because a manager was slow, would
    // punish them for someone else's delay.
    expect(decided.statusCode).toBe(200)
  })

  it("a request carrying no times cannot be approved into a no-op", async () => {
    // The shape the nightly close used to create on the employee's behalf.
    store.approvals.push({
      id: "req_placeholder",
      kind: "REGULARISATION",
      employeeId: "e4",
      subject: "Missed punch-out · 2026-08-06",
      detail: "auto-raised, no times",
      dateFrom: "2026-08-06",
      dateTo: "2026-08-06",
      units: 0,
      status: "PENDING",
      level: 1,
      createdAt: new Date().toISOString(),
    })
    const manager = await asOps()
    const decided = await app.inject({
      method: "POST",
      url: "/approvals/req_placeholder/decide",
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "sure" },
    })
    expect(decided.statusCode).toBe(422)
    expect(store.punches.filter((punch) => punch.businessDate === "2026-08-06")).toHaveLength(0)
  })
})

describe("overtime a corrected day earns is not stranded", () => {
  const punch = async (cookie: string, type: "IN" | "OUT", at: string, key: string) =>
    app.inject({
      method: "POST",
      url: "/punches",
      headers: { cookie },
      payload: punchBody({ type, at, idempotencyKey: key }),
    })

  it("a top-up claims only the difference, never the whole day again", async () => {
    const employee = await asEmployee()
    // 09:00 → 20:00 on a 9h shift: two hours of overtime.
    await punch(employee.cookies, "IN", "2026-08-05T09:00", "topup-in-1")
    await punch(employee.cookies, "OUT", "2026-08-05T20:00", "topup-out-1")

    const first = await app.inject({
      method: "POST",
      url: "/overtime/claims",
      headers: { cookie: employee.cookies },
      payload: { date: "2026-08-05" },
    })
    expect(first.statusCode).toBe(201)
    const firstMinutes = first.json().otMinutes
    expect(firstMinutes).toBe(120)

    // Claiming again with nothing new is still refused.
    const again = await app.inject({
      method: "POST",
      url: "/overtime/claims",
      headers: { cookie: employee.cookies },
      payload: { date: "2026-08-05" },
    })
    expect(again.statusCode).toBe(409)
    expect(again.json().claimedMinutes).toBe(120)

    // The day grows by an hour — as an approved regularisation would do.
    store.punches.push({
      id: "p_topup_late_out",
      employeeId: "e4",
      type: "OUT",
      businessDate: "2026-08-05",
      offsetMin: 720,
      at: "2026-08-05T21:00",
      accuracyM: 0,
      dayPart: "FULL",
      flags: ["REGULARISED"],
      idempotencyKey: "reg_topup_OUT",
    })

    const topUp = await app.inject({
      method: "POST",
      url: "/overtime/claims",
      headers: { cookie: employee.cookies },
      payload: { date: "2026-08-05" },
    })
    expect(topUp.statusCode).toBe(201)
    // Only the extra hour, not the whole three.
    expect(topUp.json().otMinutes).toBe(60)

    const claimed = store.approvals
      .filter((approval) => approval.kind === "OVERTIME" && approval.dateFrom === "2026-08-05")
      .reduce((sum, approval) => sum + approval.units, 0)
    expect(claimed).toBe(180)
  })

  it("payroll still refuses to pay more than the day earned", async () => {
    const employee = await asEmployee()
    await punch(employee.cookies, "IN", "2026-08-05T09:00", "cap-in-1")
    await punch(employee.cookies, "OUT", "2026-08-05T20:00", "cap-out-1")
    const claim = await app.inject({
      method: "POST",
      url: "/overtime/claims",
      headers: { cookie: employee.cookies },
      payload: { date: "2026-08-05" },
    })
    const manager = await asOps()
    await app.inject({
      method: "POST",
      url: `/approvals/${claim.json().approval.id}/decide`,
      headers: { cookie: manager.cookies },
      payload: { action: "APPROVE", remarks: "ok" },
    })

    // Someone inflates the approved figure directly.
    const approval = store.approvals.find((row) => row.id === claim.json().approval.id)!
    approval.units = 10_000

    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/payroll/locks",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-08" },
    })
    const run = await app.inject({
      method: "POST",
      url: "/payroll/runs",
      headers: { cookie: admin.cookies },
      payload: { month: "2026-08" },
    })
    const item = run
      .json()
      .run.items.find((candidate: { employeeId: string }) => candidate.employeeId === "e4")
    // Capped at what the day actually earned.
    expect(item.otMinutes).toBe(120)
  })
})

describe("operations settings", () => {
  it("serves every module's rules, with contradictions flagged rather than hidden", async () => {
    const admin = await asAdmin()
    const response = await app.inject({
      method: "GET",
      url: "/settings/operations",
      headers: { cookie: admin.cookies },
    })
    expect(response.statusCode).toBe(200)
    expect(Object.keys(response.json().operations).sort()).toEqual([
      "credit",
      "dispatch",
      "inventory",
      "procurement",
      "sales",
    ])
    expect(response.json().warnings).toEqual([])
  })

  it("editing one module leaves the others exactly as they were", async () => {
    // A screen that edits dispatch must not silently return procurement to how
    // it shipped.
    const admin = await asAdmin()
    const before = (
      await app.inject({
        method: "GET",
        url: "/settings/operations",
        headers: { cookie: admin.cookies },
      })
    ).json().operations

    await app.inject({
      method: "PUT",
      url: "/settings/operations",
      headers: { cookie: admin.cookies },
      payload: { procurement: { receiptTolerancePct: 5 } },
    })

    const after = (
      await app.inject({
        method: "GET",
        url: "/settings/operations",
        headers: { cookie: admin.cookies },
      })
    ).json().operations

    expect(after.procurement.receiptTolerancePct).toBe(5)
    // Untouched fields within the edited module survive too.
    expect(after.procurement.blockOverReceipt).toBe(before.procurement.blockOverReceipt)
    expect(after.dispatch).toEqual(before.dispatch)
    expect(after.credit).toEqual(before.credit)
  })

  it("reports a contradiction but still saves the half that was decided", async () => {
    const admin = await asAdmin()
    const response = await app.inject({
      method: "PUT",
      url: "/settings/operations",
      headers: { cookie: admin.cookies },
      payload: { dispatch: { requirePickList: false } },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().operations.dispatch.requirePickList).toBe(false)
    expect(response.json().warnings.join(" ")).toMatch(/nobody picked/)
  })

  it("refuses a value outside its range", async () => {
    const admin = await asAdmin()
    const response = await app.inject({
      method: "PUT",
      url: "/settings/operations",
      headers: { cookie: admin.cookies },
      payload: { sales: { maxDiscountPct: 140 } },
    })
    expect(response.statusCode).toBe(400)
  })

  it("only someone who may manage configuration can change them", async () => {
    const employee = await asEmployee()
    const response = await app.inject({
      method: "PUT",
      url: "/settings/operations",
      headers: { cookie: employee.cookies },
      payload: { sales: { maxDiscountPct: 50 } },
    })
    expect(response.statusCode).toBe(403)
  })
})

describe("the Tally connector", () => {
  const SECRET = "dev-only-tally-agent-secret"
  const agent = { "x-agent-secret": SECRET }

  const record = (over: Record<string, unknown> = {}) => ({
    entity: "customer",
    tallyGuid: "guid-acme",
    name: "Acme Traders",
    alterId: 10,
    updatedAt: "2026-08-08T10:00:00.000Z",
    fields: { gstin: "27AAAPZ1234C1ZV" },
    ...over,
  })

  it("refuses an agent with no secret, a wrong one, or one of the wrong length", async () => {
    for (const headers of [{}, { "x-agent-secret": "nope" }, { "x-agent-secret": `${SECRET}x` }]) {
      const response = await app.inject({
        method: "POST",
        url: "/tally/sync/heartbeat",
        headers,
        payload: {},
      })
      expect(response.statusCode).toBe(401)
    }
  })

  it("pulls a new master in and reports it", async () => {
    const pushed = await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: { company: "Delta Books", agentVersion: "1.0.0", records: [record()] },
    })
    expect(pushed.statusCode).toBe(200)
    expect(pushed.json()).toMatchObject({ pulled: 1, conflicts: 0, received: 1 })
    expect(store.tallyRecords).toHaveLength(1)
    expect(store.tallyRecords[0].name).toBe("Acme Traders")
  })

  it("an unchanged master is not re-applied", async () => {
    const body = { company: "Delta Books", records: [record()] }
    await app.inject({ method: "POST", url: "/tally/sync/push", headers: agent, payload: body })
    const again = await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: body,
    })
    expect(again.json()).toMatchObject({ pulled: 0, kept: 1 })
  })

  it("a genuine conflict keeps the copy that lost", async () => {
    await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: { company: "Delta Books", records: [record()] },
    })
    // Our side edits it after that sync…
    const mirrored = store.tallyRecords[0]
    mirrored.updatedAt = "2026-08-08T12:00:00.000Z"
    mirrored.fields = { gstin: "EDITED-HERE" }

    // …and Tally reports its own newer edit.
    const conflicting = await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: {
        company: "Delta Books",
        records: [
          record({ alterId: 20, updatedAt: "2026-08-08T13:00:00.000Z", fields: { gstin: "FROM-TALLY" } }),
        ],
      },
    })
    expect(conflicting.json().conflicts).toBe(1)

    const admin = await asAdmin()
    const conflicts = await app.inject({
      method: "GET",
      url: "/tally/conflicts",
      headers: { cookie: admin.cookies },
    })
    const conflict = conflicts.json().conflicts[0]
    expect(conflict.winner).toBe("tally")
    // The discarded copy survives, so nothing is lost to a timestamp.
    expect(conflict.discarded).toMatchObject({ gstin: "EDITED-HERE" })
    expect(conflict.reviewedAt).toBeNull()
  })

  it("refuses masters from a different company's books", async () => {
    await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: { company: "Delta Books", records: [record()] },
    })
    const wrong = await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: { company: "Someone Else Ltd", records: [record({ tallyGuid: "guid-other" })] },
    })
    expect(wrong.statusCode).toBe(409)
    expect(wrong.json().error).toBe("COMPANY_MISMATCH")
    // Nothing from the wrong books was written.
    expect(store.tallyRecords.every((row) => row.tallyGuid !== "guid-other")).toBe(true)
  })

  it("status reports liveness, counts and unreviewed conflicts", async () => {
    const admin = await asAdmin()
    const before = await app.inject({
      method: "GET",
      url: "/tally/status",
      headers: { cookie: admin.cookies },
    })
    // Nothing has ever connected yet.
    expect(before.json().agent.state).toBe("never")

    await app.inject({
      method: "POST",
      url: "/tally/sync/heartbeat",
      headers: agent,
      payload: { agentVersion: "1.0.0", company: "Delta Books" },
    })
    const after = await app.inject({
      method: "GET",
      url: "/tally/status",
      headers: { cookie: admin.cookies },
    })
    expect(after.json().agent.state).toBe("live")
    expect(after.json().agent.agentVersion).toBe("1.0.0")
  })

  it("accepts an action with no arguments sent the way a browser sends it", async () => {
    // The browser client sets content-type: application/json on every call.
    // Fastify's default parser rejects a bodyless POST with 400, so every
    // no-argument action failed in the browser while passing here — inject
    // sends no content-type when there is no payload. This asserts the shape
    // the browser actually produces.
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: { company: "Delta Books", records: [record({ tallyGuid: "guid-noargs" })] },
    })
    store.tallyConflicts.unshift({
      id: "cfl_noargs",
      entity: "customer",
      tallyGuid: "guid-noargs",
      name: "Acme Traders",
      winner: "tally",
      reason: "test",
      discarded: {},
      at: new Date().toISOString(),
      reviewedAt: null,
    })

    const response = await app.inject({
      method: "POST",
      url: "/tally/conflicts/cfl_noargs/reviewed",
      headers: { cookie: admin.cookies, "content-type": "application/json" },
    })
    expect(response.statusCode).toBe(200)
  })

  it("still refuses a body that is malformed rather than merely absent", async () => {
    const admin = await asAdmin()
    const response = await app.inject({
      method: "POST",
      url: "/tally/records/customer/guid-anything",
      headers: { cookie: admin.cookies, "content-type": "application/json" },
      payload: "{ not json",
    })
    expect(response.statusCode).toBe(400)
  })

  it("distinguishes a dead connector from a connector whose Tally is closed", async () => {
    // These need different responses — one means go and look at that PC, the
    // other means wait until morning — so the heartbeat carries both facts.
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/tally/sync/heartbeat",
      headers: agent,
      payload: {
        agentVersion: "1.0.0",
        company: "Delta Books",
        tallyReachable: false,
        queuedRecords: 12,
      },
    })
    const status = (
      await app.inject({ method: "GET", url: "/tally/status", headers: { cookie: admin.cookies } })
    ).json()
    expect(status.agent.state).toBe("live")
    expect(status.agent.tallyReachable).toBe(false)
    expect(status.agent.queuedRecords).toBe(12)
  })

  it("an older connector that sends neither field still counts as alive", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/tally/sync/heartbeat",
      headers: agent,
      payload: { agentVersion: "0.9.0", company: "Delta Books" },
    })
    const status = (
      await app.inject({ method: "GET", url: "/tally/status", headers: { cookie: admin.cookies } })
    ).json()
    expect(status.agent.state).toBe("live")
    expect(status.agent.tallyReachable).toBeNull()
  })

  it("an edit made here is sent to Tally on the next pull", async () => {
    // Without an app-side edit path the sync is two-way in name only: nothing
    // could ever change a master here, so nothing could ever go back.
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: { company: "Delta Books", records: [record({ tallyGuid: "guid-editable" })] },
    })

    const empty = await app.inject({ method: "GET", url: "/tally/sync/pull", headers: agent })
    expect(empty.json().count).toBe(0)

    const edited = await app.inject({
      method: "PATCH",
      url: "/tally/records/customer/guid-editable",
      headers: { cookie: admin.cookies },
      payload: { fields: { partygstin: "27ZZZZZ9999Z1ZZ" } },
    })
    expect(edited.statusCode).toBe(200)

    const pending = await app.inject({ method: "GET", url: "/tally/sync/pull", headers: agent })
    expect(pending.json().count).toBe(1)
    expect(pending.json().records[0].fields.partygstin).toBe("27ZZZZZ9999Z1ZZ")
  })

  it("an app-side edit does not forge Tally's AlterID", async () => {
    // Bumping it would make the next reconcile believe Tally made the change,
    // and the real Tally edit would then be discarded as the older one.
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: {
        company: "Delta Books",
        records: [record({ tallyGuid: "guid-alterid", alterId: 77 })],
      },
    })
    await app.inject({
      method: "PATCH",
      url: "/tally/records/customer/guid-alterid",
      headers: { cookie: admin.cookies },
      payload: { name: "Renamed Here" },
    })
    const stored = store.tallyRecords.find((row) => row.tallyGuid === "guid-alterid")!
    expect(stored.alterId).toBe(77)
    expect(stored.name).toBe("Renamed Here")
  })

  it("an edit here and an edit in Tally between syncs is a conflict, and the copy is kept", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: {
        company: "Delta Books",
        records: [record({ tallyGuid: "guid-both", alterId: 100 })],
      },
    })
    await app.inject({
      method: "PATCH",
      url: "/tally/records/customer/guid-both",
      headers: { cookie: admin.cookies },
      payload: { fields: { partygstin: "EDITED-HERE" } },
    })

    const before = store.tallyConflicts.length
    await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: {
        company: "Delta Books",
        records: [
          record({
            tallyGuid: "guid-both",
            alterId: 140,
            updatedAt: "2099-01-01T00:00:00.000Z",
            fields: { partygstin: "EDITED-IN-TALLY" },
          }),
        ],
      },
    })
    expect(store.tallyConflicts.length).toBe(before + 1)
    // The discarded copy is the one this side held, kept verbatim so somebody
    // can see exactly what was overwritten.
    expect(store.tallyConflicts[0].discarded).toMatchObject({ partygstin: "EDITED-HERE" })
  })

  it("refuses an edit to a master that is not mirrored, and an unknown entity", async () => {
    const admin = await asAdmin()
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/tally/records/customer/guid-ghost",
          headers: { cookie: admin.cookies },
          payload: { name: "Nope" },
        })
      ).statusCode
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/tally/records/invoice/guid-anything",
          headers: { cookie: admin.cookies },
          payload: { name: "Nope" },
        })
      ).statusCode
    ).toBe(400)
  })

  it("a conflict can be marked reviewed, and only by someone who may manage sales", async () => {
    await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: { company: "Delta Books", records: [record()] },
    })
    store.tallyRecords[0].updatedAt = "2026-08-08T12:00:00.000Z"
    await app.inject({
      method: "POST",
      url: "/tally/sync/push",
      headers: agent,
      payload: { company: "Delta Books", records: [record({ alterId: 20, updatedAt: "2026-08-08T13:00:00.000Z" })] },
    })
    const conflictId = store.tallyConflicts[0].id

    const employee = await asEmployee()
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/tally/conflicts/${conflictId}/reviewed`,
          headers: { cookie: employee.cookies },
        })
      ).statusCode
    ).toBe(403)

    const admin = await asAdmin()
    const reviewed = await app.inject({
      method: "POST",
      url: `/tally/conflicts/${conflictId}/reviewed`,
      headers: { cookie: admin.cookies },
    })
    expect(reviewed.statusCode).toBe(200)
    expect(reviewed.json().conflict.reviewedAt).not.toBeNull()
  })
})

describe("the fulfilment chain", () => {
  /** A fresh order to work against, so tests do not fight over one. */
  const orderWithLines = async (cookies: string, qty = 100) => {
    const customer = (
      await app.inject({
        method: "POST",
        url: "/customers",
        headers: { cookie: cookies },
        payload: {
          code: `CUS${store.nextId}`,
          name: "Fulfilment Test Co",
          gstin: null,
          contact: "",
          email: "",
          phone: "",
          address: "",
          city: "Mumbai",
          state: "Maharashtra",
          creditDays: 30,
          creditLimitPaise: 0,
          active: true,
        },
      })
    ).json().customer

    const so = {
      id: `so_test_${store.nextId++}`,
      number: `SO-2026-${store.nextId}`,
      customerId: customer.id,
      sourceEstimateId: null,
      orderDate: "2026-08-01",
      customerRef: "",
      status: "OPEN" as const,
      lines: [
        {
          id: "tl1",
          itemId: store.items[0].id,
          qty,
          unitPricePaise: 1200,
          gstRatePct: 18,
          discountPct: 0,
        },
      ],
      terms: "",
      notes: "",
      createdBy: "e1",
    }
    store.salesOrders.push(so)
    return so
  }

  const createPick = (cookies: string, soId: string, requestedQty: number) =>
    app.inject({
      method: "POST",
      url: "/fulfilment/picks",
      headers: { cookie: cookies },
      payload: { soId, assignedTo: "e4", lines: [{ soLineId: "tl1", requestedQty }] },
    })

  it("walks an order from picking to a signature", async () => {
    const admin = await asAdmin()
    const so = await orderWithLines(admin.cookies)

    const created = await createPick(admin.cookies, so.id, 100)
    expect(created.statusCode).toBe(201)
    const pick = created.json().pick
    expect(pick.number).toMatch(/^PL-\d{4}-\d{4}$/)

    const picked = await app.inject({
      method: "PATCH",
      url: `/fulfilment/picks/${pick.id}`,
      headers: { cookie: admin.cookies },
      payload: { status: "PICKED", lines: [{ soLineId: "tl1", pickedQty: 100 }] },
    })
    expect(picked.statusCode).toBe(200)
    expect(picked.json().pick.completedAt).not.toBeNull()

    const packed = await app.inject({
      method: "POST",
      url: "/fulfilment/packs",
      headers: { cookie: admin.cookies },
      payload: {
        pickListId: pick.id,
        packages: [
          { sequence: 1, description: "Carton", weightKg: 20, contents: [{ soLineId: "tl1", qty: 100 }] },
        ],
      },
    })
    expect(packed.statusCode).toBe(201)

    const dispatched = await app.inject({
      method: "POST",
      url: "/fulfilment/consignments",
      headers: { cookie: admin.cookies },
      payload: {
        soId: so.id,
        challanId: null,
        packId: packed.json().pack.id,
        dispatchedAt: "2026-08-08T16:40:00.000Z",
        transporterName: "VRL Logistics",
        ownVehicle: false,
        lrNumber: "44821",
        lrDate: "2026-08-08",
        vehicleNo: "MH-12-AB-1234",
        driverName: "Ramesh",
        freightPaise: 250000,
        freightTerms: "PAID",
        packageCount: 1,
        weightKg: 20,
      },
    })
    expect(dispatched.statusCode).toBe(201)
    const consignment = dispatched.json().consignment

    // All three LR copies before a delivery can be certified.
    for (const copy of ["CONSIGNOR", "CONSIGNEE", "TRANSPORTER"]) {
      const attached = await app.inject({
        method: "POST",
        url: `/fulfilment/consignments/${consignment.id}/lr-copies`,
        headers: { cookie: admin.cookies },
        payload: { copy, url: `https://files.example/${copy}.pdf` },
      })
      expect(attached.statusCode).toBe(200)
    }

    const delivered = await app.inject({
      method: "POST",
      url: "/fulfilment/pods",
      headers: { cookie: admin.cookies },
      payload: {
        consignmentId: consignment.id,
        deliveredAt: "2026-08-10T11:00:00.000Z",
        receivedBy: "Sunita Shah",
        condition: "OK",
      },
    })
    expect(delivered.statusCode).toBe(201)
  })

  it("will not send two pickers for the same carton", async () => {
    // The second picker would find an empty rack — a shortage the system caused.
    const admin = await asAdmin()
    const so = await orderWithLines(admin.cookies, 100)

    expect((await createPick(admin.cookies, so.id, 70)).statusCode).toBe(201)
    const second = await createPick(admin.cookies, so.id, 50)
    expect(second.statusCode).toBe(422)
    expect(JSON.stringify(second.json().issues)).toMatch(/Only 30 left/)
  })

  it("refuses picking more than was asked for", async () => {
    const admin = await asAdmin()
    const so = await orderWithLines(admin.cookies)
    const pick = (await createPick(admin.cookies, so.id, 40)).json().pick

    const over = await app.inject({
      method: "PATCH",
      url: `/fulfilment/picks/${pick.id}`,
      headers: { cookie: admin.cookies },
      payload: { status: "PICKING", lines: [{ soLineId: "tl1", pickedQty: 90 }] },
    })
    expect(over.statusCode).toBe(422)
    // And the refusal left nothing half-applied.
    expect(store.pickLists.find((row) => row.id === pick.id)!.lines[0].pickedQty).toBe(0)
  })

  it("refuses to pack more than was picked", async () => {
    const admin = await asAdmin()
    const so = await orderWithLines(admin.cookies)
    const pick = (await createPick(admin.cookies, so.id, 100)).json().pick
    await app.inject({
      method: "PATCH",
      url: `/fulfilment/picks/${pick.id}`,
      headers: { cookie: admin.cookies },
      payload: { status: "SHORT", lines: [{ soLineId: "tl1", pickedQty: 60, shortReason: "stock" }] },
    })

    const packed = await app.inject({
      method: "POST",
      url: "/fulfilment/packs",
      headers: { cookie: admin.cookies },
      payload: {
        pickListId: pick.id,
        packages: [{ sequence: 1, description: "", weightKg: 1, contents: [{ soLineId: "tl1", qty: 100 }] }],
      },
    })
    expect(packed.statusCode).toBe(422)
    expect(JSON.stringify(packed.json().issues)).toMatch(/only 60 was picked/)
  })

  it("refuses a dispatch on a hired lorry with no LR number", async () => {
    const admin = await asAdmin()
    const so = await orderWithLines(admin.cookies)
    await createPick(admin.cookies, so.id, 10)

    const response = await app.inject({
      method: "POST",
      url: "/fulfilment/consignments",
      headers: { cookie: admin.cookies },
      payload: {
        soId: so.id,
        packId: null,
        dispatchedAt: "2026-08-08T16:40:00.000Z",
        transporterName: "VRL Logistics",
        ownVehicle: false,
        lrNumber: "",
        lrDate: null,
        vehicleNo: "MH-12-AB-1234",
      },
    })
    expect(response.statusCode).toBe(422)
    expect(JSON.stringify(response.json().issues)).toMatch(/LR number is required/)
  })

  it("treats a company vehicle as own, so nobody is trained to type a fake LR", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "PUT",
      url: "/settings/operations",
      headers: { cookie: admin.cookies },
      payload: { dispatch: { ownVehicleNumbers: ["MH-01-XY-9999"], requirePacking: false } },
    })
    const so = await orderWithLines(admin.cookies)
    await createPick(admin.cookies, so.id, 10)

    const response = await app.inject({
      method: "POST",
      url: "/fulfilment/consignments",
      headers: { cookie: admin.cookies },
      payload: {
        soId: so.id,
        packId: null,
        dispatchedAt: "2026-08-08T16:40:00.000Z",
        ownVehicle: false,
        lrNumber: "",
        lrDate: null,
        vehicleNo: "MH-01-XY-9999",
      },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().consignment.ownVehicle).toBe(true)
  })

  it("a second scan of one LR copy replaces it rather than counting twice", async () => {
    // Appending would let three scans of the same sheet satisfy "all three".
    const admin = await asAdmin()
    // Set the preconditions here rather than inheriting them from whichever
    // test happened to run before — order-dependent tests fail for reasons
    // that have nothing to do with what they are checking.
    await app.inject({
      method: "PUT",
      url: "/settings/operations",
      headers: { cookie: admin.cookies },
      payload: { dispatch: { requirePacking: false } },
    })
    const so = await orderWithLines(admin.cookies)
    await createPick(admin.cookies, so.id, 10)
    const dispatchResponse = await app.inject({
      method: "POST",
      url: "/fulfilment/consignments",
      headers: { cookie: admin.cookies },
      payload: {
        soId: so.id,
        packId: null,
        dispatchedAt: "2026-08-08T16:40:00.000Z",
        ownVehicle: true,
        vehicleNo: "MH-01-XY-9999",
      },
    })
    expect(dispatchResponse.statusCode, dispatchResponse.body).toBe(201)
    const consignment = dispatchResponse.json().consignment

    for (const url of ["a.pdf", "b.pdf"]) {
      await app.inject({
        method: "POST",
        url: `/fulfilment/consignments/${consignment.id}/lr-copies`,
        headers: { cookie: admin.cookies },
        payload: { copy: "CONSIGNOR", url },
      })
    }
    const stored = store.consignments.find((row) => row.id === consignment.id)!
    expect(stored.lrAttachments).toHaveLength(1)
    expect(stored.lrAttachments[0].url).toBe("b.pdf")
  })

  it("refuses a second proof of delivery against one dispatch", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "PUT",
      url: "/settings/operations",
      headers: { cookie: admin.cookies },
      payload: { dispatch: { requireAllLrCopies: false, requirePacking: false } },
    })
    const so = await orderWithLines(admin.cookies)
    await createPick(admin.cookies, so.id, 10)
    const consignment = (
      await app.inject({
        method: "POST",
        url: "/fulfilment/consignments",
        headers: { cookie: admin.cookies },
        payload: {
          soId: so.id,
          packId: null,
          dispatchedAt: "2026-08-08T16:40:00.000Z",
          ownVehicle: true,
          vehicleNo: "MH-01-XY-9999",
        },
      })
    ).json().consignment

    const body = {
      consignmentId: consignment.id,
      deliveredAt: "2026-08-10T11:00:00.000Z",
      receivedBy: "Sunita Shah",
      condition: "OK",
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/fulfilment/pods",
          headers: { cookie: admin.cookies },
          payload: body,
        })
      ).statusCode
    ).toBe(201)
    // Whichever arrived second would quietly bury the first.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/fulfilment/pods",
          headers: { cookie: admin.cookies },
          payload: { ...body, receivedBy: "Someone Else" },
        })
      ).statusCode
    ).toBe(409)
  })

  it("a picker may pick and pack, but may not certify a delivery", async () => {
    // The person who sealed the carton should not be the one who says it arrived.
    const matrix = store.matrix
    expect(matrix["dispatch.pick"].PICKER).toBe("ALL")
    expect(matrix["dispatch.manage"].PICKER).toBe("NONE")
    expect(matrix["sales.manage"].PICKER).toBe("NONE")
  })

  it("the board says where each order is, and what is unacknowledged", async () => {
    const admin = await asAdmin()
    const response = await app.inject({
      method: "GET",
      url: "/fulfilment",
      headers: { cookie: admin.cookies },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(Array.isArray(body.orders)).toBe(true)
    expect(body.orders.every((row: { stage: string }) => typeof row.stage === "string")).toBe(true)
    expect(Array.isArray(body.podOverdue)).toBe(true)
    expect(Array.isArray(body.missingLrCopies)).toBe(true)
  })
})

describe("credit control", () => {
  const overdueInvoice = (customerId: string, dueDate: string, qty = 100) => {
    const invoice = {
      id: `inv_test_${store.nextId++}`,
      number: `INV-2026-${store.nextId}`,
      customerId,
      soId: null,
      date: "2026-06-01",
      dueDate,
      status: "OPEN" as const,
      lines: [
        {
          id: "il1",
          itemId: store.items[0].id,
          qty,
          unitPricePaise: 10_000,
          gstRatePct: 0,
          discountPct: 0,
        },
      ],
      terms: "",
      createdBy: "e1",
    }
    store.invoices.push(invoice)
    return invoice
  }

  it("lists who is overdue, oldest debt first", async () => {
    // Sorted by age rather than amount: a small invoice ninety days old is
    // closer to being written off than a large one that fell due last week.
    const admin = await asAdmin()
    const [first, second] = store.customers
    overdueInvoice(first.id, "2026-01-10")
    overdueInvoice(second.id, "2026-07-25")

    const response = await app.inject({
      method: "GET",
      url: "/credit/overdue",
      headers: { cookie: admin.cookies },
    })
    expect(response.statusCode).toBe(200)
    const rows = response.json().rows
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0].customerId).toBe(first.id)
    expect(rows[0].oldestOverdueDays).toBeGreaterThan(rows[1].oldestOverdueDays)
  })

  it("holds an order for an account past the grace period, and says why", async () => {
    const admin = await asAdmin()
    const customer = store.customers[0]
    overdueInvoice(customer.id, "2026-02-01")

    const response = await app.inject({
      method: "GET",
      url: `/credit/customers/${customer.id}`,
      headers: { cookie: admin.cookies },
    })
    expect(response.statusCode).toBe(200)
    const { decision } = response.json()
    expect(decision.verdict).toBe("HOLD")
    expect(decision.reason).toMatch(/days past due/)
    // Lateness and the limit are different conversations, so the reason names
    // only the one that actually stopped it.
    expect(decision.reason).not.toMatch(/limit/)
  })

  it("weighs a proposed order against the limit without saving anything", async () => {
    const admin = await asAdmin()
    await app.inject({
      method: "PUT",
      url: "/settings/operations",
      headers: { cookie: admin.cookies },
      payload: { credit: { defaultTerms: { creditLimitPaise: 500_00 } } },
    })
    const customer = store.customers[1]
    // Not yet due, so only the limit can stop it.
    overdueInvoice(customer.id, "2099-01-01", 10)

    const response = await app.inject({
      method: "GET",
      url: `/credit/customers/${customer.id}?orderValuePaise=100000`,
      headers: { cookie: admin.cookies },
    })
    const { decision } = response.json()
    expect(decision.verdict).toBe("HOLD")
    expect(decision.reason).toMatch(/credit limit/)
    expect(decision.headroomPaise).toBeLessThan(0)
  })

  it("says whether the overdue list is advice or a gate", async () => {
    const admin = await asAdmin()
    const response = await app.inject({
      method: "GET",
      url: "/credit/overdue",
      headers: { cookie: admin.cookies },
    })
    // A screen must never have to guess which one it is showing.
    expect(typeof response.json().holdOrdersOnBreach).toBe("boolean")
  })

  it("leaves a settled invoice out of the list entirely", async () => {
    const admin = await asAdmin()
    const customer = store.customers[2] ?? store.customers[0]
    const invoice = overdueInvoice(customer.id, "2026-01-05", 1)
    store.receipts.push({
      id: `rcpt_${store.nextId++}`,
      date: "2026-08-01",
      partyId: customer.id,
      mode: "BANK",
      reference: "test",
      amountPaise: 10_000,
      allocations: [{ docId: invoice.id, amountPaise: 10_000 }],
      remarks: "",
      recordedBy: "e1",
    })

    const rows = (
      await app.inject({
        method: "GET",
        url: "/credit/overdue",
        headers: { cookie: admin.cookies },
      })
    ).json().rows
    const row = rows.find((entry: { customerId: string }) => entry.customerId === customer.id)
    expect(row?.oldestDocNumber).not.toBe(invoice.number)
  })

  it("refuses a customer who does not exist rather than reporting zero owed", async () => {
    const admin = await asAdmin()
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/credit/customers/ghost",
          headers: { cookie: admin.cookies },
        })
      ).statusCode
    ).toBe(404)
  })
})

describe("the picker, end to end", () => {
  const asPicker = () => login("picker@delta.dev", "Pick@1234")

  it("signs in and is told exactly what it may do", async () => {
    const picker = await asPicker()
    const me = (
      await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: picker.cookies } })
    ).json()
    expect(me.user.role).toBe("PICKER")
    expect(me.permissions["dispatch.pick"]).toBe("ALL")
    expect(me.permissions["dispatch.manage"]).toBe("NONE")
  })

  it("can see the board and work a list", async () => {
    const picker = await asPicker()
    expect(
      (await app.inject({ method: "GET", url: "/fulfilment", headers: { cookie: picker.cookies } }))
        .statusCode
    ).toBe(200)
  })

  it("cannot record a dispatch or certify a delivery", async () => {
    // The person who sealed the carton should not be the one who says it arrived.
    const picker = await asPicker()
    for (const url of ["/fulfilment/consignments", "/fulfilment/pods"]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: { cookie: picker.cookies },
        payload: {},
      })
      expect(response.statusCode).toBe(403)
    }
  })

  it("cannot reach the customer master or prices", async () => {
    const picker = await asPicker()
    for (const url of ["/customers", "/estimates", "/invoices"]) {
      const response = await app.inject({ method: "GET", url, headers: { cookie: picker.cookies } })
      expect(response.statusCode).toBe(403)
    }
  })

  it("is still an employee: punches in and sees their own payslip", async () => {
    const picker = await asPicker()
    const me = (
      await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: picker.cookies } })
    ).json()
    expect(me.permissions["punch.self"]).toBe("SELF")
    expect(me.permissions["payroll.viewOwn"]).toBe("SELF")
  })
})
