import { beforeEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { buildServer } from "../src/server"
import { seedStore, type Store } from "../src/store"

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
