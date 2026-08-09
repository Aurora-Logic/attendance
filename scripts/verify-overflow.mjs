#!/usr/bin/env node
/**
 * Rule 1.6: no horizontal page scroll, at any breakpoint, on any route.
 *
 * This is the CI gate. `<body>` never scrolls sideways; horizontal scroll is
 * allowed only inside an element that opted into it (a wide data table), and
 * that element must set `overscroll-behavior-x: contain`.
 *
 * When a page does overflow, guessing which element did it wastes more time
 * than the fix, so this walks the DOM and names the widest offender and its
 * ancestors.
 *
 * Usage: node scripts/verify-overflow.mjs [--route /punch] [--width 320]
 */
import { chromium } from "playwright"

const BASE = process.env.WEB_URL ?? "http://localhost:5177"

/** Exactly the widths in rule 1.6. */
const BREAKPOINTS = [320, 375, 414, 768, 1024, 1280, 1440, 1920]

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
  "/fulfilment",
  "/stock",
  "/vendor-bills",
  "/indents",
  "/expenses",
  "/reports",

  "/roles",
  "/settings",
  "/audit",
]

/**
 * Decision B11, encoded rather than left in prose.
 *
 * Punch is the screen a field user opens on a phone every day, so rule 5.3 is
 * stricter than rule 1.6: not merely "the page must not scroll sideways" but
 * "nothing scrolls sideways at all". A contained inner scroller passes 1.6 and
 * still fails 5.3 — which is exactly what it was doing, at 448px inside a
 * 320px phone.
 */
const MOBILE_FIRST = ["/punch"]
const MOBILE_FIRST_MAX_WIDTH = 640

const only = (flag) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? null : process.argv[index + 1]
}
const routeFilter = only("--route")
const widthFilter = only("--width")

const routes = routeFilter ? ROUTES.filter((r) => r === routeFilter) : ROUTES
const widths = widthFilter ? [Number(widthFilter)] : BREAKPOINTS

/**
 * Runs in the page. Finds every element wider than the viewport or sticking out
 * past its right edge, ignoring ones inside a legitimately scrollable region.
 */
const findOffenders = () => {
  const docWidth = document.documentElement.clientWidth
  const overflow = document.documentElement.scrollWidth - docWidth
  if (overflow <= 1) return { overflow, offenders: [] }

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : ""
    const cls =
      typeof el.className === "string" && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 4).join(".")}`
        : ""
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 120)
  }

  /** An ancestor that scrolls horizontally on purpose absolves its children. */
  const insideScroller = (el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (["auto", "scroll"].includes(style.overflowX)) return true
    }
    return false
  }

  const offenders = []
  for (const el of document.querySelectorAll("body *")) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    const past = Math.round(rect.right - docWidth)
    if (past <= 1) continue
    if (insideScroller(el)) continue
    offenders.push({
      selector: describe(el),
      past,
      width: Math.round(rect.width),
      left: Math.round(rect.left),
      text: (el.textContent ?? "").trim().slice(0, 60),
    })
  }

  // The outermost offender is usually the cause; children just inherit it.
  offenders.sort((a, b) => b.past - a.past || a.left - b.left)
  return { overflow, offenders: offenders.slice(0, 4) }
}

/** A region that scrolls sideways must contain the gesture (rule 1.6). */
const findUncontainedScrollers = () => {
  const bad = []
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el)
    if (!["auto", "scroll"].includes(style.overflowX)) continue
    if (el.scrollWidth <= el.clientWidth + 1) continue
    if (style.overscrollBehaviorX === "contain" || style.overscrollBehaviorX === "none") continue
    const cls =
      typeof el.className === "string" && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
        : ""
    bad.push(`${el.tagName.toLowerCase()}${cls}`.slice(0, 100))
  }
  return [...new Set(bad)]
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

// Sign in once; the session cookie carries across every viewport below.
await page.goto(BASE, { waitUntil: "domcontentloaded" })
await page.getByRole("button", { name: /admin@delta\.dev/ }).click()
await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15_000 })

const failures = []
let checked = 0

for (const width of widths) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(320)
    checked += 1

    const { overflow, offenders } = await page.evaluate(findOffenders)
    if (overflow > 1) {
      failures.push({ route, width, overflow, offenders })
      process.stdout.write("x")
    } else {
      process.stdout.write(".")
    }

    const uncontained = await page.evaluate(findUncontainedScrollers)
    if (uncontained.length > 0) {
      failures.push({ route, width, uncontained })
    }

    // Rule 5.3 on the mobile-first screens: nothing scrolls sideways at all.
    if (MOBILE_FIRST.includes(route) && width <= MOBILE_FIRST_MAX_WIDTH) {
      const scrollers = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => {
            const style = getComputedStyle(el)
            return ["auto", "scroll"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1
          })
          .map((el) => {
            const cls =
              typeof el.className === "string" && el.className
                ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
                : ""
            return `${el.tagName.toLowerCase()}${cls} (+${el.scrollWidth - el.clientWidth}px)`
          })
      )
      if (scrollers.length > 0) failures.push({ route, width, mobileFirst: scrollers })
    }
  }
  process.stdout.write(` ${width}px\n`)
}

await browser.close()

console.log(`\n${checked} checks across ${routes.length} routes x ${widths.length} breakpoints`)

if (failures.length === 0) {
  console.log("OVERFLOW CLEAN — no route scrolls sideways at any breakpoint")
  process.exit(0)
}

console.log(`\n${failures.length} failure(s):\n`)
for (const f of failures) {
  if (f.mobileFirst) {
    console.log(
      `  ${f.route} @ ${f.width}px — mobile-first screen, rule 5.3: nothing may scroll sideways`
    )
    for (const sel of f.mobileFirst) console.log(`      ${sel}`)
    continue
  }
  if (f.uncontained) {
    console.log(`  ${f.route} @ ${f.width}px — scrollable region without overscroll-behavior-x: contain`)
    for (const sel of f.uncontained) console.log(`      ${sel}`)
    continue
  }
  console.log(`  ${f.route} @ ${f.width}px — page scrolls ${f.overflow}px sideways`)
  for (const o of f.offenders) {
    console.log(`      +${o.past}px  ${o.selector}  (w=${o.width})${o.text ? `  "${o.text}"` : ""}`)
  }
}
process.exit(1)
