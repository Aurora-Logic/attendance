/**
 * Interaction test: the chase list.
 *
 * Detection only — the owner deferred anything that sends — so this checks the
 * list is right, ordered by age rather than amount, and that the screen says
 * whether an overdue account also stops the next order.
 */
import { chromium } from "playwright"

const BASE = "http://localhost:5177"
const API = process.env.API_URL ?? "http://localhost:3000"
const SHOTS = process.env.SHOTS_DIR ?? "./shots"

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@delta.dev", password: "Admin@123" }),
})
const cookie = login.headers
  .getSetCookie()
  .map((entry) => entry.split(";")[0])
  .join("; ")
const call = async (path, init = {}) => {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}

await call("/settings/operations", {
  method: "PUT",
  body: JSON.stringify({ credit: { holdOrdersOnBreach: true, chaseMinimumPaise: 50000 } }),
})

/**
 * A genuinely overdue invoice, so the card under test actually renders. A run
 * that finds nothing overdue proves nothing about the screen — it only takes
 * the empty branch and reports PASS.
 */
const items = (await call("/items")).items
const customers = (await call("/customers")).customers
const estimate = (
  await call("/estimates", {
    method: "POST",
    body: JSON.stringify({
      customerId: customers[0].id,
      date: "2026-01-05",
      validUntil: "2026-12-31",
      lines: [{ itemId: items[0].id, qty: 25, unitPricePaise: 40_000, discountPct: 0 }],
      terms: "",
      notes: "credit verification",
    }),
  })
).estimate
await call(`/estimates/${estimate.id}/send`, { method: "POST" })
await call(`/estimates/${estimate.id}/decide`, {
  method: "POST",
  body: JSON.stringify({ action: "ACCEPT", note: "" }),
})
const creditSo = (
  await call(`/estimates/${estimate.id}/convert`, {
    method: "POST",
    body: JSON.stringify({ orderDate: "2026-01-05", customerRef: "" }),
  })
).salesOrder
await call("/invoices", {
  method: "POST",
  body: JSON.stringify({ soId: creditSo.id, date: "2026-01-05", dueDate: "2026-02-04" }),
})

const overdue = await call("/credit/overdue")
if (overdue.rows.length === 0)
  throw new Error("setup did not produce an overdue account, so the screen would not be tested")
if (!Array.isArray(overdue.rows)) throw new Error("no rows in the overdue payload")
// Oldest first, whatever the amounts are.
for (let index = 1; index < overdue.rows.length; index++) {
  if (overdue.rows[index - 1].oldestOverdueDays < overdue.rows[index].oldestOverdueDays)
    throw new Error("the chase list is not ordered oldest-debt-first")
}

const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on("console", (m) => {
  if (m.type() === "error" && !/React DevTools|\[vite\]/.test(m.text())) errors.push(m.text())
})
page.on("pageerror", (e) => errors.push(String(e)))

await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /admin@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })
await page.goto(`${BASE}/receivables`, { waitUntil: "domcontentloaded" })
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })

if (overdue.rows.length > 0) {
  await page.getByText("Worth a call today").waitFor({ timeout: 10_000 })
  // Advice or a gate — a screen must never leave somebody to find out at the counter.
  await page.getByText("New orders held").waitFor({ timeout: 5_000 })
  await page.getByText(overdue.rows[0].customerName).first().waitFor({ timeout: 5_000 })
  await page.screenshot({ path: `${SHOTS}/credit-chase-list.png`, fullPage: true })

  await call("/settings/operations", {
    method: "PUT",
    body: JSON.stringify({ credit: { holdOrdersOnBreach: false } }),
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByText("Advice only").waitFor({ timeout: 10_000 })
}

await page.setViewportSize({ width: 390, height: 844 })
await page.reload({ waitUntil: "domcontentloaded" })
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })
await page.waitForTimeout(400)
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth
)
if (overflow > 1) throw new Error(`receivables overflows by ${overflow}px at 390w`)
await page.screenshot({ path: `${SHOTS}/credit-chase-390.png`, fullPage: true })

await call("/settings/operations", {
  method: "PUT",
  body: JSON.stringify({ credit: { holdOrdersOnBreach: true, chaseMinimumPaise: 50000 } }),
})

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log(`credit: PASS (${overdue.rows.length} overdue, oldest-first, gate vs advice shown, 390w)`)
