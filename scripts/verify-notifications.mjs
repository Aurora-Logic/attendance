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
const applied = await fetch(`${API}/leave/apply`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: employeeCookie },
  body: JSON.stringify({
    type: "CL",
    from: "2026-09-21",
    to: "2026-09-21",
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
await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor({ timeout: 10_000 })

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
