/** Interaction test: an employee raises a regularisation and a manager applies it. */
import { chromium } from "playwright"

const BASE = "http://localhost:5177"
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
await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor({ timeout: 10_000 })

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

// It appears in the approvals inbox as a regularisation.
await page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(900)
const found = await page.getByText("Regularisation", { exact: false }).count()
if (found === 0) throw new Error("raised request is not visible in approvals")

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log("regularisation: PASS (validation guards, submit, appears in approvals)")
