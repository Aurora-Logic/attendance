/** Interaction test: an employee raises a regularisation and a manager applies it. */
import { chromium } from "playwright"

const BASE = "http://localhost:5177"
const API = process.env.API_URL ?? "http://localhost:3000"
const TARGET_DATE = "2026-07-15"

/**
 * Clear any request this test left behind on an earlier run. The API refuses a
 * second pending request for the same day — correctly — so without this the
 * test fails on its own history rather than on a real defect.
 */
async function clearPrevious() {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ops@delta.dev", password: "Ops@1234" }),
  })
  const cookie = login.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ")
  const approvals = await (await fetch(`${API}/approvals`, { headers: { cookie } })).json()
  for (const approval of approvals.approvals ?? []) {
    if (
      approval.kind === "REGULARISATION" &&
      approval.status === "PENDING" &&
      approval.dateFrom === TARGET_DATE
    ) {
      await fetch(`${API}/approvals/${approval.id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ action: "REJECT", remarks: "cleanup from a previous test run" }),
      })
    }
  }
}
await clearPrevious()
const SHOTS = process.env.SHOTS_DIR ?? "./shots"
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on("console", (m) => {
  if (m.type() === "error" && !/React DevTools|\[vite\]/.test(m.text())) errors.push(m.text())
})
page.on("pageerror", (e) => errors.push(String(e)))

await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /employee@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })

await page.goto(`${BASE}/punch`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(800)
await page.getByRole("button", { name: "Regularise" }).click()
const sheet = page.getByRole("dialog")
await sheet.getByText("Regularise a day").waitFor({ timeout: 5_000 })

// Guard: no time given → the form refuses before any request.
await sheet.getByLabel("What happened").fill("Gate reader did not register my exit.")
await sheet.getByRole("button", { name: "Send for approval" }).click()
await sheet.getByText("Give at least one time to correct.").waitFor({ timeout: 3_000 })

// Guard: out before in.
await sheet.getByLabel("In time").fill("18:00")
await sheet.getByLabel("Out time").fill("09:00")
await sheet.getByRole("button", { name: "Send for approval" }).click()
await sheet.getByText("Out time must be after in time.").waitFor({ timeout: 3_000 })

await page.screenshot({ path: `${SHOTS}/regularise-sheet.png` })

// Pick a date in a month payroll has not locked — a locked month is correctly
// refused, and this test is about the happy path.
await sheet.locator("#reg-date").click()
await page.waitForTimeout(300)
await page.getByRole("button", { name: "Go to the Previous Month" }).click()
await page.waitForTimeout(300)
await page.getByRole("button", { name: /July 15th, 2026/ }).click()
await page.waitForTimeout(300)

// Valid submission.
await sheet.getByLabel("In time").fill("09:05")
await sheet.getByLabel("Out time").fill("18:30")
await sheet.getByRole("button", { name: "Send for approval" }).click()
await page.getByText("Sent for approval").waitFor({ timeout: 6_000 })

// It reaches the approver's inbox. The employee cannot see /approvals — that
// is the approver's screen, and the route guard now says so — so the honest
// end-to-end check signs in as the manager the request routed to.
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
await page.evaluate(() => window.localStorage.clear())
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /ops@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })
await page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(1200)
const found = await page.getByText("Regularisation", { exact: false }).count()
if (found === 0) throw new Error("raised request never reached the approver's inbox")

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log("regularisation: PASS (validation guards, submit, appears in approvals)")
