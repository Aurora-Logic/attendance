#!/usr/bin/env node
/**
 * Rule 1.5: a Card may not contain another Card.
 *
 * "Box in box" is the main reason a UI reads as generic, and it comes back one
 * screen at a time unless something checks. This is a source scan rather than a
 * runtime one: nesting is visible in the JSX, and a static check can run in CI
 * without a browser.
 *
 * It counts depth by walking `<Card` / `</Card>` in order, ignoring comments and
 * strings. A Card rendered by a child *component* is not nesting this can see —
 * that is what the runtime border count in verify-overflow's sibling check is
 * for — but direct nesting is the common case and the one people write.
 *
 * Usage: node scripts/scan-nested-cards.mjs [--json]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = "apps/web/src"

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })

/** Blank comments, keeping newlines so line numbers stay true. */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length))

export function scan() {
  const findings = []
  for (const file of walk(ROOT)) {
    if (!file.endsWith(".tsx")) continue
    // The Card primitive itself, and the shadcn layer generally, is exempt.
    if (file.includes("/components/ui/")) continue

    const source = stripComments(readFileSync(file, "utf8"))
    const path = relative(".", file)

    // <Card …>  |  </Card>  |  <Card … />  (self-closing never nests)
    const token = /<Card\b[^>]*?(\/?)>|<\/Card>/g
    let depth = 0
    for (const match of source.matchAll(token)) {
      const text = match[0]
      const line = source.slice(0, match.index).split("\n").length
      if (text === "</Card>") {
        depth = Math.max(0, depth - 1)
        continue
      }
      if (match[1] === "/") continue // self-closing
      depth += 1
      if (depth > 1) findings.push({ file: path, line, depth })
    }
  }
  return findings
}

const findings = scan()

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(findings, null, 2))
} else {
  for (const f of findings) {
    console.log(`${f.file}:${f.line}  Card nested ${f.depth} deep`)
  }
  console.log(
    findings.length === 0
      ? "\nNo nested cards. Rule 1.5 holds."
      : `\n${findings.length} nested Card(s). Group with a Separator and a label, or whitespace — not another bordered box.`
  )
}

process.exitCode = findings.length > 0 ? 1 : 0
