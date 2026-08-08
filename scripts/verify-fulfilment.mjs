/**
 * Interaction test: the dispatch board, from an order to a finished pick.
 *
 * Sets up a real sales order through the API (estimate → accept → convert),
 * then drives the picker's screen: raise a list for part of it, watch the
 * remainder shrink, get refused for asking for more than is left, and finish
 * a short list that insists on a reason.
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

// Picking and packing rules at their defaults, so the refusals under test are
// the ones the rules describe rather than whatever a previous run left behind.
await call("/settings/operations", {
  method: "PUT",
  body: JSON.stringify({ dispatch: { requirePickList: true, requirePacking: true, podGraceDays: 3 } }),
})

const items = (await call("/items")).items
const customers = (await call("/customers")).customers
if (items.length === 0 || customers.length === 0) throw new Error("seed data is missing")

const estimate = (
  await call("/estimates", {
    method: "POST",
    body: JSON.stringify({
      customerId: customers[0].id,
      date: "2026-08-01",
      validUntil: "2026-12-31",
      lines: [{ itemId: items[0].id, qty: 100, unitPricePaise: 1200, discountPct: 0 }],
      terms: "",
      notes: "fulfilment verification",
    }),
  })
).estimate

await call(`/estimates/${estimate.id}/send`, { method: "POST" })
await call(`/estimates/${estimate.id}/decide`, {
  method: "POST",
  body: JSON.stringify({ action: "ACCEPT", note: "" }),
})
const so = (
  await call(`/estimates/${estimate.id}/convert`, {
    method: "POST",
    body: JSON.stringify({ orderDate: "2026-08-01", customerRef: "" }),
  })
).salesOrder

const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on("console", (m) => {
  // A 422 is this test working: it deliberately asks for more than is left and
  // finishes a list short, and the browser logs every refused request as a
  // failed resource. Anything else is a real fault.
  const ignorable = /React DevTools|\[vite\]|status of 422/
  if (m.type() === "error" && !ignorable.test(m.text())) errors.push(m.text())
})
page.on("pageerror", (e) => errors.push(String(e)))

await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /admin@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })

const openOrder = async () => {
  await page.goto(`${BASE}/fulfilment`, { waitUntil: "domcontentloaded" })
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })
  await page.getByText(so.number).first().waitFor({ timeout: 10_000 })
  await page.getByRole("button", { name: `Pick ${so.number}` }).click()
  // The panel shows a *different* card once a list is open, so wait for the
  // sheet itself rather than for either card's title.
  await page.locator('[data-slot="sheet-content"]').waitFor({ timeout: 8_000 })
}

// --- the order is on the board, not started.
await openOrder()
await page.screenshot({ path: `${SHOTS}/fulfilment-board.png`, fullPage: true })

// --- raise a list for part of it.
const lineId = `${so.id}_l0`
const request = page.locator(`#request-${lineId}`)
await request.waitFor({ timeout: 8_000 })
const offered = await request.getAttribute("max")
if (offered !== "100") throw new Error(`expected 100 pickable, screen offered ${offered}`)
await request.fill("70")
await page.getByRole("button", { name: "Raise pick list" }).click()
await page.getByText(/Pick list PL-\d{4}-\d{4} raised/).waitFor({ timeout: 8_000 })

// --- the remainder shrinks, because the open list has claimed the rest.
const available = (await call(`/fulfilment/picks/available/${so.id}`)).lines[0]
if (available.pickableQty !== 30)
  throw new Error(`expected 30 left after claiming 70, got ${available.pickableQty}`)

// --- asking for more than is left is refused in the rules' own words.
const refused = await fetch(`${API}/fulfilment/picks`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({
    soId: so.id,
    assignedTo: "e4",
    lines: [{ soLineId: lineId, requestedQty: 50 }],
  }),
})
if (refused.status !== 422) throw new Error(`over-claim should be refused, got ${refused.status}`)
const body = await refused.json()
if (!JSON.stringify(body.issues).includes("Only 30 left"))
  throw new Error(`refusal did not name the remainder: ${JSON.stringify(body)}`)

// --- finishing short insists on a reason.
await openOrder()
const pickedField = page.locator(`#picked-${lineId}`)
await pickedField.waitFor({ timeout: 8_000 })
await pickedField.fill("60")
// The reason box only appears once the line is short — it is not clutter on a
// full pick.
await page.locator(`#reason-${lineId}`).waitFor({ timeout: 5_000 })
await page.getByRole("button", { name: "Finish this list" }).click()
await page.getByText(/Say why this line is short/).first().waitFor({ timeout: 8_000 })
await page.screenshot({ path: `${SHOTS}/fulfilment-short-reason.png`, fullPage: true })

await page.locator(`#reason-${lineId}`).fill("Only 60 on the rack")
await page.getByRole("button", { name: "Finish this list" }).click()
await page.getByText("Marked short").first().waitFor({ timeout: 8_000 })

const picks = (await call(`/fulfilment/picks?soId=${so.id}`)).picks
const done = picks.find((pick) => pick.status === "SHORT")
if (!done) throw new Error("the list was not recorded as short")
if (done.lines[0].pickedQty !== 60) throw new Error(`stored ${done.lines[0].pickedQty}, not 60`)
if (!done.completedAt) throw new Error("a finished list has no completion time")

// --- the phone view must not scroll sideways.
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${BASE}/fulfilment`, { waitUntil: "domcontentloaded" })
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })
await page.waitForTimeout(400)
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth
)
if (overflow > 1) throw new Error(`dispatch board overflows by ${overflow}px at 390w`)
await page.screenshot({ path: `${SHOTS}/fulfilment-390.png`, fullPage: true })

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log("fulfilment: PASS (board, claim shrinks remainder, over-claim refused, short needs a reason, 390w)")
