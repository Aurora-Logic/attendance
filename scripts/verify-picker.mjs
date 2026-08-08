/**
 * Interaction test: a picker's day, and its edges.
 *
 * The role exists to be narrow. This checks it can do its job in the browser
 * and that the things it must not do are absent from the screen rather than
 * merely refused by the server — a button that 403s is still a button somebody
 * pressed.
 */
import { chromium } from "playwright"

const BASE = "http://localhost:5177"
const API = process.env.API_URL ?? "http://localhost:3000"
const SHOTS = process.env.SHOTS_DIR ?? "./shots"

const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on("console", (m) => {
  const ignorable = /React DevTools|\[vite\]|status of 40[13]/
  if (m.type() === "error" && !ignorable.test(m.text())) errors.push(m.text())
})
page.on("pageerror", (e) => errors.push(String(e)))

await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /picker@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })

// --- the dispatch board is reachable and is what they land among.
await page.goto(`${BASE}/fulfilment`, { waitUntil: "domcontentloaded" })
await page.getByRole("heading", { name: "Dispatch board" }).waitFor({ timeout: 10_000 })
await page.screenshot({ path: `${SHOTS}/picker-board.png`, fullPage: true })

// --- the commercial screens are not offered in the navigation.
for (const hidden of ["Customers", "Invoices", "Estimates", "Payroll", "Employees"]) {
  const count = await page.getByRole("link", { name: hidden, exact: true }).count()
  if (count > 0) throw new Error(`a picker is being offered ${hidden}`)
}
// And the one they need is.
if ((await page.getByRole("link", { name: "Dispatch board", exact: true }).count()) === 0)
  throw new Error("a picker cannot find the dispatch board")

// --- navigating to a forbidden screen by hand is refused, not rendered.
await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(600)
const body = (await page.textContent("body")) ?? ""
if (!/permission|not allowed|no access/i.test(body))
  throw new Error("typing the customers URL rendered the screen for a picker")

// --- the dispatch panel is absent, not merely disabled: the person who sealed
//     the carton should not be the one certifying it arrived.
await page.goto(`${BASE}/fulfilment`, { waitUntil: "domcontentloaded" })
await page.getByRole("heading", { name: "Dispatch board" }).waitFor({ timeout: 10_000 })
const anyPick = page.getByRole("button", { name: /^Pick SO-/ })
if ((await anyPick.count()) > 0) {
  await anyPick.first().click()
  await page.locator('[data-slot="sheet-content"]').waitFor({ timeout: 8_000 })
  for (const forbidden of ["Record dispatch", "Record delivery"]) {
    if ((await page.getByRole("button", { name: new RegExp(forbidden) }).count()) > 0)
      throw new Error(`a picker is being offered "${forbidden}"`)
  }
  await page.screenshot({ path: `${SHOTS}/picker-panel.png`, fullPage: true })
}

// --- the server refuses it too, in case a screen ever slips.
const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "picker@delta.dev", password: "Pick@1234" }),
})
const cookie = login.headers
  .getSetCookie()
  .map((entry) => entry.split(";")[0])
  .join("; ")
for (const path of ["/fulfilment/consignments", "/fulfilment/pods"]) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  })
  if (response.status !== 403) throw new Error(`${path} allowed a picker: ${response.status}`)
}

// --- a picker is still an employee: they can punch in.
await page.goto(`${BASE}/punch`, { waitUntil: "domcontentloaded" })
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })

// --- the phone is the picker's actual device, so it must hold up at 390.
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${BASE}/fulfilment`, { waitUntil: "domcontentloaded" })
await page.getByRole("heading", { name: "Dispatch board" }).waitFor({ timeout: 10_000 })
await page.waitForTimeout(400)
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth
)
if (overflow > 1) throw new Error(`the picker's board overflows by ${overflow}px at 390w`)
await page.screenshot({ path: `${SHOTS}/picker-390.png`, fullPage: true })

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log("picker: PASS (board reachable, commercial screens absent, dispatch actions withheld, punch works, 390w)")
