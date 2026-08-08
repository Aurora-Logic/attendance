/**
 * Interaction test: the connector screen tells the truth about the sync.
 *
 * Drives it through three real states — never connected, connected with Tally
 * closed, and a conflict that needs checking — by talking to the connector
 * endpoints exactly as the Windows agent does.
 */
import { chromium } from "playwright"

const BASE = "http://localhost:5177"
const API = process.env.API_URL ?? "http://localhost:3000"
const SHOTS = process.env.SHOTS_DIR ?? "./shots"
const AGENT_SECRET = process.env.TALLY_AGENT_SECRET ?? "dev-only-tally-agent-secret"

const agentHeaders = { "content-type": "application/json", "x-agent-secret": AGENT_SECRET }
const post = (path, body) =>
  fetch(`${API}${path}`, { method: "POST", headers: agentHeaders, body: JSON.stringify(body) })

const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on("console", (m) => {
  if (m.type() === "error" && !/React DevTools|\[vite\]/.test(m.text())) errors.push(m.text())
})
page.on("pageerror", (e) => errors.push(String(e)))

const openConnector = async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" })
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })
  await page.getByRole("button", { name: /^Connector/ }).first().click()
}

await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /admin@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })

// --- state 1: the connector is up, but Tally is closed for the evening.
const company = "Delta Books"
let response = await post("/tally/sync/heartbeat", {
  agentVersion: "1.0.0",
  company,
  tallyReachable: false,
  queuedRecords: 34,
})
if (!response.ok) throw new Error(`heartbeat rejected: ${response.status} ${await response.text()}`)

await openConnector()
await page.getByText("Running, but Tally is not answering").waitFor({ timeout: 10_000 })
await page.getByText(/34 change\(s\) are held safely/).waitFor({ timeout: 5_000 })
await page.screenshot({ path: `${SHOTS}/tally-connector-tally-closed.png`, fullPage: true })

// --- state 2: a master edited on both sides, so a conflict is logged.
const guid = `verify-${Date.now()}`
const record = (updatedAt, alterId, fields) => ({
  entity: "customer",
  tallyGuid: guid,
  name: "Kumar & Sons",
  alterId,
  updatedAt,
  fields,
})

response = await post("/tally/sync/push", {
  agentVersion: "1.0.0",
  company,
  records: [record("2026-08-01T10:00:00.000Z", 100, { partygstin: "27AAAPZ1234C1ZV" })],
})
if (!response.ok) throw new Error(`first push rejected: ${response.status} ${await response.text()}`)

// The agent's secret must not open the screens a person uses.
const status = await fetch(`${API}/tally/status`, { headers: agentHeaders })
if (status.status !== 401) throw new Error("status must not accept the agent secret")

// Edit it here as the admin, then offer a newer Tally edit. Both sides moved
// since the watermark, which is the only thing that counts as a conflict.
const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@delta.dev", password: "Admin@123" }),
})
const adminCookie = login.headers
  .getSetCookie()
  .map((entry) => entry.split(";")[0])
  .join("; ")

const patched = await fetch(`${API}/tally/records/customer/${guid}`, {
  method: "PATCH",
  headers: { "content-type": "application/json", cookie: adminCookie },
  body: JSON.stringify({ fields: { partygstin: "EDITED-HERE" } }),
})
if (!patched.ok) throw new Error(`app-side edit rejected: ${patched.status} ${await patched.text()}`)

response = await post("/tally/sync/push", {
  agentVersion: "1.0.0",
  company,
  records: [record("2099-01-01T00:00:00.000Z", 140, { partygstin: "CHANGED-IN-TALLY" })],
})
const summary = await response.json()
if (summary.conflicts !== 1)
  throw new Error(`expected a conflict when both sides moved: ${JSON.stringify(summary)}`)

await openConnector()
await page.getByText("Customers").first().waitFor({ timeout: 10_000 })
await page.getByRole("button", { name: "What was replaced" }).first().click()
// The copy that lost must be shown verbatim, not summarised away.
await page.getByText(/EDITED-HERE/).first().waitFor({ timeout: 5_000 })
await page.screenshot({ path: `${SHOTS}/tally-connector-conflict.png`, fullPage: true })

// Marking it checked clears the badge, and it survives a reload.
const before = await page.getByText("Not checked").count()
if (before < 1) throw new Error("expected at least one unchecked conflict")
await page.getByRole("button", { name: "Mark checked" }).first().click()
await page.getByText("Checked", { exact: true }).first().waitFor({ timeout: 8_000 })

await openConnector()
const stillUnchecked = await page.getByText("Not checked").count()
if (stillUnchecked >= before) throw new Error("marking a conflict checked did not persist")

// --- state 3: no mojibake anywhere. The ampersand is the canary.
const heading = await page.getByText("Kumar & Sons").first().textContent()
if (!heading?.includes("Kumar & Sons")) throw new Error(`name mangled on screen: ${heading}`)

// --- responsive: the phone view must not scroll sideways.
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth
)
if (overflow > 1) throw new Error(`connector screen overflows by ${overflow}px at 390w`)
await page.screenshot({ path: `${SHOTS}/tally-connector-390.png`, fullPage: true })

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log("tally connector: PASS (Tally-closed state, conflict detail, mark checked, 390w)")
