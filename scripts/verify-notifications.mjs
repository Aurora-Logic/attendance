/** Interaction test: a raised request reaches the approver's bell. */
import { chromium } from "playwright"

const BASE = "http://localhost:5177"
const API = process.env.API_URL ?? "http://localhost:3000"
const SHOTS = process.env.SHOTS_DIR ?? "./shots"

/** Raise a leave request as the employee, so the manager has something to see. */
const cookieOf = (response) =>
  response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ")

const employee = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "employee@delta.dev", password: "Emp@1234" }),
})
const employeeCookie = cookieOf(employee)

/**
 * Pick a leave type that still has balance.
 *
 * This used to hardcode CL and burn a day of it on every run, so after enough
 * runs it failed with INSUFFICIENT_BALANCE and looked like a product fault. It
 * also masked a real one: CL had been driven to -6, which the rules say cannot
 * happen. Reading the balance first keeps the test honest about which is which.
 */
const balances = await (
  await fetch(`${API}/leave/balances/e4`, { headers: { cookie: employeeCookie } })
).json()
const usable = Object.entries(balances.balances ?? {}).find(([, days]) => Number(days) >= 1)
if (!usable) {
  console.error("no leave type has any balance left:", JSON.stringify(balances.balances))
  process.exit(1)
}
const [leaveType] = usable

// A distinct date per run, so a second run is not an overlapping duplicate.
const day = new Date(Date.UTC(2026, 8, 1) + Math.floor(Math.random() * 27) * 86_400_000)
  .toISOString()
  .slice(0, 10)

const applied = await fetch(`${API}/leave/apply`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: employeeCookie },
  body: JSON.stringify({
    type: leaveType,
    from: day,
    to: day,
    part: "FULL",
    reason: "notification test",
  }),
})
if (applied.status !== 201) {
  console.error("could not raise a request:", applied.status, await applied.text())
  process.exit(1)
}

const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on("console", (m) => {
  if (m.type() === "error" && !/React DevTools|\[vite\]/.test(m.text())) errors.push(m.text())
})
page.on("pageerror", (e) => errors.push(String(e)))

// The manager (ops) is who the request routed to.
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /ops@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })

const bell = page.getByRole("button", { name: /Notifications/ })
await bell.waitFor({ timeout: 10_000 })
const label = await bell.getAttribute("aria-label")
if (!/\d+ unread/.test(label ?? "")) throw new Error(`bell shows no unread count: ${label}`)

await bell.click()
const panel = page.getByText("Notifications", { exact: true })
await panel.waitFor({ timeout: 5_000 })
await page.getByText("Leave request awaiting you").first().waitFor({ timeout: 5_000 })
await page.screenshot({ path: `${SHOTS}/notification-bell.png` })

// Mark all read clears the badge.
await page.getByRole("button", { name: "Mark all read" }).click()
await page.waitForTimeout(800)
const afterLabel = await bell.getAttribute("aria-label")
if (/unread/.test(afterLabel ?? "")) throw new Error(`badge did not clear: ${afterLabel}`)

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log("notifications: PASS (unread badge, feed content, mark all read)")
