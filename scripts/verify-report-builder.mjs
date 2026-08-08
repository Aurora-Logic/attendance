/** Interaction test: create → save → run → group → persist for the report builder. */
import { chromium } from "playwright"

const BASE = "http://localhost:5177"
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on("console", (message) => {
  if (message.type() === "error" && !/React DevTools|\[vite\]/.test(message.text()))
    errors.push(message.text())
})
page.on("pageerror", (error) => errors.push(String(error)))

// login through the real screen
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /admin@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 })

await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded" })

// 1. create
await page.getByRole("button", { name: "New report" }).click()
await page.getByLabel("Name").fill("Ops lateness")
await page.getByRole("button", { name: "Save report" }).click()
await page.getByText("Report saved").waitFor({ timeout: 3_000 })

// 2. saved item is listed and auto-active; preview renders live rows
await page.getByText("Ops lateness").first().waitFor()
const table = page.locator("table").filter({ hasText: "Employee" }).first()
await table.waitFor({ timeout: 5_000 })
const dataRows = await table.locator("tbody tr").count()
if (dataRows < 2) throw new Error(`preview shows ${dataRows} rows — expected the register`)

// 3. edit → group by department → section rows appear
await page.getByRole("button", { name: "Edit Ops lateness" }).click()
await page.getByLabel("Group by").click()
await page.getByRole("option", { name: "Department" }).click()
await page.getByRole("button", { name: "Save report" }).click()
await page.getByText("Report saved").nth(0).waitFor()
await page.waitForTimeout(400)
const sectionCount = await page.locator("tbody tr", { hasText: "rows" }).count()
if (sectionCount < 2) throw new Error(`expected ≥2 department sections, saw ${sectionCount}`)

// 4. export enabled
const exportButton = page.getByRole("button", { name: "Export .xlsx" }).first()
if (await exportButton.isDisabled()) throw new Error("export button disabled with rows present")

// 5. definition survives a reload (localStorage)
await page.reload({ waitUntil: "domcontentloaded" })
await page.getByText("Ops lateness").first().waitFor({ timeout: 5_000 })

// 6. delete cleans up
await page.getByRole("button", { name: "Delete Ops lateness" }).click()
await page.getByText("Report deleted").waitFor()
await page.getByText("No custom reports yet").waitFor()

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log("report builder interaction: PASS (create, run, group, persist, delete)")
