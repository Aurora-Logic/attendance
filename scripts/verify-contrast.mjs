#!/usr/bin/env node
/**
 * Rule 1.7: text contrast >= 4.5:1, UI boundaries >= 3:1 — in both themes.
 *
 * Colours are authored in oklch, and `getComputedStyle` hands them back as
 * oklch strings. Doing sRGB luminance maths on those numbers produces
 * confident nonsense (it told me a black-on-red badge scored 1.02, and a
 * white-on-red one 1.01 — the same answer for opposite cases). Canvas
 * normalises any CSS colour to rgb, so the conversion happens where it is
 * already implemented correctly.
 *
 * Usage: node scripts/verify-contrast.mjs
 */
import { chromium } from "playwright"

const BASE = process.env.WEB_URL ?? "http://localhost:5177"

/** Elements worth checking, and the ratio each must clear. */
const TARGETS = [
  {
    name: "notification badge count",
    route: "/",
    selector: 'button[aria-label^="Notifications"] span',
    min: 4.5,
    // The badge only renders when something is unread.
    signInAs: /ops@delta\.dev/,
  },
]

/** In the page: just report the colours, verbatim. */
const readColours = (selector) => {
  const el = document.querySelector(selector)
  if (!el) return { missing: true }
  const style = getComputedStyle(el)
  let backdrop = style.backgroundColor
  for (let node = el; node && (!backdrop || backdrop === "rgba(0, 0, 0, 0)"); node = node.parentElement) {
    backdrop = node ? getComputedStyle(node).backgroundColor : backdrop
  }
  return { text: (el.textContent ?? "").trim(), color: style.color, background: backdrop }
}

/**
 * Convert in Node rather than in the page.
 *
 * Two browser-side attempts produced confident nonsense: canvas `fillStyle`
 * silently refuses oklch and keeps its previous value, and `color-mix(in srgb)`
 * still serialised back as oklch — both made every pair the same colour and
 * every ratio 1.0. The conversion is a published formula; doing it here is
 * deterministic and inspectable.
 */
const oklchToLinear = (L, C, hDeg) => {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const srgbToLinear = (v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Accepts the two forms Chrome actually serialises: oklch() and rgb()/rgba(). */
const toLinear = (value) => {
  const oklch = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i.exec(value)
  if (oklch) {
    const L = oklch[1].endsWith("%") ? parseFloat(oklch[1]) / 100 : parseFloat(oklch[1])
    return oklchToLinear(L, parseFloat(oklch[2]), parseFloat(oklch[3]))
  }
  const rgb = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
  if (rgb.length === 3) return rgb.map(srgbToLinear)
  throw new Error(`Cannot read colour: ${value}`)
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

const contrast = (foreground, background) => {
  const a = luminance(toLinear(foreground))
  const b = luminance(toLinear(background))
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100
}

const browser = await chromium.launch()
const failures = []

for (const target of TARGETS) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.goto(BASE, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: target.signInAs }).click()
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15_000 })

    if (theme === "dark") {
      await page.evaluate(() => document.documentElement.classList.add("dark"))
      await page.waitForTimeout(250)
    }
    await page.goto(`${BASE}${target.route}`, { waitUntil: "domcontentloaded" })
    if (theme === "dark") {
      await page.evaluate(() => document.documentElement.classList.add("dark"))
    }
    await page.locator("h1").first().waitFor({ timeout: 12_000 }).catch(() => {})
    await page.waitForTimeout(350)

    const raw = await page.evaluate(readColours, target.selector)
    const result = raw.missing ? raw : { ...raw, ratio: contrast(raw.color, raw.background) }
    const label = `${target.name} (${theme})`
    if (result.missing) {
      failures.push(`${label}: element not found — ${target.selector}`)
      console.log(`  MISS  ${label}`)
    } else if (result.ratio < target.min) {
      failures.push(
        `${label}: ${result.ratio}:1, needs ${target.min}:1 — ${result.color} on ${result.background}`
      )
      console.log(`  FAIL  ${label}  ${result.ratio}:1  (needs ${target.min}:1)`)
    } else {
      console.log(`  ok    ${label}  ${result.ratio}:1`)
    }
    await context.close()
  }
}

await browser.close()

if (failures.length === 0) {
  console.log("\nCONTRAST CLEAN")
  process.exit(0)
}
console.log(`\n${failures.length} failure(s):`)
for (const f of failures) console.log(`  ${f}`)
process.exit(1)
