#!/usr/bin/env node
/**
 * Rule 1.5's rule of thumb: more than 4 visible rounded borders on a screen and
 * it wants redesigning. This counts what a person actually sees — a Card
 * rendered by a child component counts the same as one written inline, which a
 * source scan cannot know.
 */
import { chromium } from "playwright"
const BASE = process.env.WEB_URL ?? "http://localhost:5177"
const ROUTES = ["/","/punch","/attendance","/roster","/approvals","/employees","/leave","/purchase-orders","/vendors","/items","/procurement-analytics","/estimates","/sales-orders","/fulfilment","/stock","/vendor-bills","/indents","/expenses","/reports","/roles","/settings","/audit"]

const count = () => {
  const seen = []
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (s.visibility === "hidden" || s.display === "none") continue

    // Rule 1.5 is about *containers*. A control's own outline is not a box —
    // counting every outline button put /approvals at 113 when 54 of those
    // were buttons.
    const tag = el.tagName.toLowerCase()
    if (["button", "input", "select", "textarea", "a", "label", "img", "svg"].includes(tag)) continue
    const role = el.getAttribute("role")
    if (role && ["button", "tab", "combobox", "checkbox", "switch", "menuitem"].includes(role)) continue
    if (el.closest("button, [role='button'], [role='tablist']")) continue

    // A box worth counting occupies real space.
    if (r.width < 120 || r.height < 48) continue
    const radius = parseFloat(s.borderTopLeftRadius) || 0
    const width = parseFloat(s.borderTopWidth) || 0
    if (radius < 4 || width < 1) continue
    if (s.borderTopStyle === "none") continue
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0,3).join(".") : ""
    seen.push(`${el.tagName.toLowerCase()}.${cls}`.slice(0,70))
  }
  return seen
}

const b = await chromium.launch()
const c = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await c.newPage()
await p.goto(BASE, { waitUntil: "domcontentloaded" })
await p.getByRole("button", { name: /admin@delta\.dev/ }).click()
await p.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 })

const rows = []
for (const route of ROUTES) {
  await p.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" })
  await p.locator("h1").first().waitFor({ timeout: 12000 }).catch(() => {})
  await p.waitForTimeout(350)
  const boxes = await p.evaluate(count)
  rows.push({ route, n: boxes.length, sample: boxes.slice(0, 3) })
}
await b.close()

rows.sort((a, z) => z.n - a.n)
console.log("visible rounded borders per screen (rule 1.5 threshold: 4)\n")
for (const r of rows) {
  const flag = r.n > 4 ? "OVER" : "  ok"
  console.log(`  ${flag}  ${String(r.n).padStart(3)}  ${r.route}`)
}
const over = rows.filter((r) => r.n > 4)
console.log(`\n${over.length} of ${rows.length} screens exceed the threshold`)
