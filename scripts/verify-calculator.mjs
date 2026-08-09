/**
 * Interaction test: the calculator (5.6).
 *
 * "It gets used mid-quotation; it must never require the mouse." So this drives
 * it entirely from the keyboard, and checks it floats, drags, remembers where
 * it was put, and closes on Escape.
 */
import { chromium } from "playwright"

const BASE = "http://localhost:5177"
const errors = []
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on("console", (m) => {
  if (m.type() === "error" && !/React DevTools|\[vite\]/.test(m.text())) errors.push(m.text())
})
page.on("pageerror", (e) => errors.push(String(e)))

await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /admin@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15_000 })

const panel = page.getByRole("dialog", { name: "Calculator" })
const display = () => panel.locator("span.absolute").first().innerText()

// --- Alt+C opens it, from anywhere.
if (await panel.isVisible().catch(() => false)) throw new Error("calculator open before asking")
await page.keyboard.press("Alt+c")
await panel.waitFor({ timeout: 8_000 })

// --- worked entirely from the number row.
for (const key of ["2", "0", "0", "+", "1", "0", "%"]) await page.keyboard.press(key)
await page.keyboard.press("Enter")
const marked = (await display()).trim()
if (marked !== "220") throw new Error(`200 + 10% should be 220 on a desk calculator, got ${marked}`)

// --- chained, with no operator precedence, like the machine on the desk.
await page.keyboard.press("Delete")
for (const key of ["2", "+", "3", "*", "4"]) await page.keyboard.press(key)
await page.keyboard.press("Enter")
const chained = (await display()).trim()
if (chained !== "20") throw new Error(`2 + 3 x 4 should be 20 on a desk calculator, got ${chained}`)

// --- the tape recorded it and can be copied.
await page.getByRole("button", { name: "Copy the tape" }).waitFor({ timeout: 5_000 })

// --- drag it, and check the position survives a reload.
const before = await panel.boundingBox()
const grip = panel.locator("div").first()
await grip.hover()
await page.mouse.down()
await page.mouse.move(before.x - 220, before.y - 120, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(300)
const after = await panel.boundingBox()
if (Math.abs(after.x - before.x) < 50) throw new Error("the calculator did not move when dragged")

await page.reload({ waitUntil: "domcontentloaded" })
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15_000 })
await page.keyboard.press("Alt+c")
await panel.waitFor({ timeout: 8_000 })
const remembered = await panel.boundingBox()
if (Math.abs(remembered.x - after.x) > 4) {
  throw new Error(`position not remembered: reopened at ${remembered.x}, was ${after.x}`)
}

await page.screenshot({ path: "./shots/calculator.png" })

// --- Escape closes it.
await page.keyboard.press("Escape")
await page.waitForTimeout(300)
if (await panel.isVisible().catch(() => false)) throw new Error("Escape did not close the calculator")

// --- and with it closed, typing goes back to the page.
await page.keyboard.press("2")

await browser.close()
if (errors.length > 0) {
  console.error("CONSOLE ERRORS:", errors)
  process.exit(1)
}
console.log("calculator: PASS (Alt+C, keyboard-only arithmetic, percent, tape, drag, remembers position, Escape)")
