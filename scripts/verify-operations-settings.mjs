/**
 * Interaction test: every module has rules, and changing them sticks.
 *
 * The owner's complaint was that settings covered attendance and payroll and
 * nothing else. This walks all five commercial modules, changes one value,
 * saves it, reloads, and checks the server kept it — and that a rule which
 * contradicts another says so rather than being silently accepted.
 */
import { chromium } from "playwright"

const BASE = "http://localhost:5177"
const API = process.env.API_URL ?? "http://localhost:3000"
const SHOTS = process.env.SHOTS_DIR ?? "./shots"

const MODULES = ["Procurement", "Sales & pricing", "Inventory", "Credit control", "Dispatch & logistics"]

/** The state every run starts from, and returns to. */
const BASELINE = {
  dispatch: { requirePickList: true, podGraceDays: 3 },
  procurement: { receiptTolerancePct: 0 },
  credit: { defaultTerms: { creditLimitPaise: 0 } },
  inventory: { stockCountIntervalDays: 90 },
}

const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on("console", (m) => {
  if (m.type() === "error" && !/React DevTools|\[vite\]/.test(m.text())) errors.push(m.text())
})
page.on("pageerror", (e) => errors.push(String(e)))

// Start from a known state so a rerun does not inherit the last run's edits.
const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@delta.dev", password: "Admin@123" }),
})
const cookie = login.headers
  .getSetCookie()
  .map((entry) => entry.split(";")[0])
  .join("; ")
const reset = await fetch(`${API}/settings/operations`, {
  method: "PUT",
  headers: { "content-type": "application/json", cookie },
  // Every value this script touches, not only the first one — a run that
  // stops early otherwise leaves the next run asserting against its own
  // leftovers, and "set it to X" passes trivially when X is already there.
  body: JSON.stringify(BASELINE),
})
// An unchecked setup call is how a verification script starts lying.
if (!reset.ok) throw new Error(`could not reset settings: ${reset.status} ${await reset.text()}`)
const fresh = (await reset.json()).operations
if (fresh.dispatch.podGraceDays !== 3 || fresh.credit.defaultTerms.creditLimitPaise !== 0)
  throw new Error("reset did not take")

await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /admin@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })

/** On a phone the rail collapses into one Select, so both paths are exercised. */
const openSection = async (label) => {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" })
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })
  const rail = page.getByRole("button", { name: label, exact: true }).first()
  if (await rail.isVisible().catch(() => false)) {
    await rail.click()
    return
  }
  await page.getByRole("combobox", { name: "Settings section" }).click()
  await page.getByRole("option", { name: label, exact: true }).click()
}

// --- every module is reachable and renders its own rules.
for (const label of MODULES) {
  await openSection(label)
  await page.getByRole("button", { name: "Save changes" }).waitFor({ timeout: 10_000 })
  const controls = await page.locator('button[role="switch"], input[type="number"], textarea').count()
  if (controls === 0) throw new Error(`${label} rendered no controls`)
}
await page.screenshot({ path: `${SHOTS}/settings-dispatch.png`, fullPage: true })

// --- a change saves, and survives a reload.
await openSection("Dispatch & logistics")
const grace = page.locator("#dispatch-root-podGraceDays")
await grace.fill("9")
const save = page.getByRole("button", { name: "Save changes" })
if (await save.isDisabled()) throw new Error("save stayed disabled after an edit")
await save.click()
await page.getByText("Saved").first().waitFor({ timeout: 8_000 })

const stored = await (await fetch(`${API}/settings/operations`, { headers: { cookie } })).json()
if (stored.operations.dispatch.podGraceDays !== 9)
  throw new Error(`server kept ${stored.operations.dispatch.podGraceDays}, not 9`)
// Editing dispatch must not have reset another module.
if (stored.operations.procurement.blockOverReceipt !== true)
  throw new Error("saving dispatch changed procurement")

await openSection("Dispatch & logistics")
const reloaded = await page.locator("#dispatch-root-podGraceDays").inputValue()
if (reloaded !== "9") throw new Error(`after reload the field shows ${reloaded}, not 9`)

// --- a rule that contradicts another says so.
await page.locator("#dispatch-root-requirePickList").click()
await page.getByRole("button", { name: "Save changes" }).click()
await page.getByText(/cartons would be sealed on goods nobody picked/).first().waitFor({ timeout: 8_000 })
await page.screenshot({ path: `${SHOTS}/settings-contradiction.png`, fullPage: true })

// --- money is edited in rupees, stored in paise.
await openSection("Credit control")
const limit = page.locator("#credit-defaultTerms-creditLimitPaise")
await limit.fill("250000")
await page.getByRole("button", { name: "Save changes" }).click()
await page.getByText("Saved").first().waitFor({ timeout: 8_000 })
const afterMoney = await (await fetch(`${API}/settings/operations`, { headers: { cookie } })).json()
if (afterMoney.operations.credit.defaultTerms.creditLimitPaise !== 25_000_000)
  throw new Error(
    `₹250000 should store as 25000000 paise, got ${afterMoney.operations.credit.defaultTerms.creditLimitPaise}`
  )

// --- discard puts it back without touching the server.
await openSection("Inventory")
await page.locator("#inventory-root-stockCountIntervalDays").fill("400")
await page.getByRole("button", { name: "Discard" }).click()
const discarded = await page.locator("#inventory-root-stockCountIntervalDays").inputValue()
if (discarded === "400") throw new Error("discard did not restore the stored value")

// --- the phone view must not scroll sideways.
await page.setViewportSize({ width: 390, height: 844 })
await openSection("Dispatch & logistics")
await page.waitForTimeout(400)
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth
)
if (overflow > 1) throw new Error(`operations settings overflow by ${overflow}px at 390w`)
await page.screenshot({ path: `${SHOTS}/settings-operations-390.png`, fullPage: true })

// Leave the store as it was found.
await fetch(`${API}/settings/operations`, {
  method: "PUT",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify(BASELINE),
})

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log("operations settings: PASS (5 modules, save persists, contradiction shown, rupees→paise, 390w)")
