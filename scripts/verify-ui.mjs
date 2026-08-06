/**
 * UI verification sweep: sign in through the real login screen, walk every
 * route at desktop and mobile widths, and fail on any console error, page
 * error, or horizontal document overflow. Screenshots land in the scratch
 * directory given by SHOTS_DIR (or ./shots).
 *
 * Usage: node scripts/verify-ui.mjs   (web on :5177, api on :3000 if running)
 */
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.WEB_URL ?? "http://localhost:5177"
const SHOTS = process.env.SHOTS_DIR ?? "./shots"
mkdirSync(SHOTS, { recursive: true })

const ROUTES = [
  "/",
  "/punch",
  "/attendance",
  "/roster",
  "/approvals",
  "/employees",
  "/employees/emp_3",
  "/leave",
  "/purchase-orders",
  "/purchase-orders/new",
  "/vendors",
  "/items",
  "/procurement-analytics",
  "/estimates",
  "/estimates/new",
  "/estimates/est1",
  "/sales-orders",
  "/stock",
  "/vendor-bills",
  "/indents",
  "/expenses",
  "/reports",
  "/payroll",
  "/roles",
  "/settings",
  "/audit",
]

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]

const IGNORE = [/React DevTools/, /\[vite\]/]

const findings = []
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
})

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport,
    geolocation: { latitude: 19.0761, longitude: 72.8778, accuracy: 12 },
    permissions: ["geolocation"],
  })
  const page = await context.newPage()

  page.on("console", (message) => {
    if (message.type() !== "error") return
    const text = message.text()
    if (IGNORE.some((pattern) => pattern.test(text))) return
    findings.push({ viewport: viewport.name, route: page.url(), kind: "console", text })
  })
  page.on("pageerror", (error) => {
    findings.push({ viewport: viewport.name, route: page.url(), kind: "pageerror", text: String(error) })
  })

  // ---- login through the real screen --------------------------------------
  await page.goto(BASE, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: /admin@delta\.dev/ }).click()
  await page.getByText("Dashboard").first().waitFor({ timeout: 5_000 })

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await page.waitForTimeout(500) // charts, redirects and lazy content settle

    // A route may redirect mid-measure (Navigate components); retry once on
    // the destroyed-context race instead of dying.
    let overflow = 0
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        overflow = await page.evaluate(() => {
          const doc = document.documentElement
          return doc.scrollWidth - doc.clientWidth
        })
        break
      } catch {
        await page.waitForTimeout(400)
      }
    }
    if (overflow > 1) {
      findings.push({
        viewport: viewport.name,
        route,
        kind: "overflow",
        text: `document scrolls horizontally by ${overflow}px`,
      })
    }

    const slug = route === "/" ? "dashboard" : route.slice(1).replaceAll("/", "_")
    await page.screenshot({ path: `${SHOTS}/${viewport.name}-${slug}.png`, fullPage: false })
  }

  await context.close()
}

await browser.close()

if (findings.length === 0) {
  console.log(`CLEAN — ${ROUTES.length} routes × ${VIEWPORTS.length} viewports, 0 findings`)
  process.exit(0)
}

console.log(`${findings.length} finding(s):`)
for (const finding of findings) {
  console.log(`- [${finding.viewport}] ${finding.route} · ${finding.kind}: ${finding.text.slice(0, 300)}`)
}
process.exit(1)
