#!/usr/bin/env node
/**
 * Find native form controls in the app layer.
 *
 * Rule 1.1 bans them outside components/ui/. This is the scan behind
 * audit/native-components.md, and it is deliberately multiline-aware: JSX
 * attributes wrap across lines, and a line-based grep missed an
 * `<input type="checkbox">` that was three lines tall.
 *
 * Usage:
 *   node scripts/scan-native-components.mjs           # human-readable
 *   node scripts/scan-native-components.mjs --json    # machine-readable
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = "apps/web/src"
const UI_LAYER = "/components/ui/"

const BANNED_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "date",
  "datetime-local",
  "time",
  "file",
  "range",
  "color",
  "month",
  "week",
])
const TABLE_TAGS = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col"])
const OTHER_TAGS = new Set(["select", "option", "optgroup", "textarea", "dialog"])

/**
 * The A4 document surfaces. Their table elements are the sheet's structure, and
 * shadcn Table's overflow wrapper stops a long table paginating when printed.
 * Only the table elements are exempt — a title="" tooltip or a <textarea> in
 * the same file is screen-only editing UI and is still a violation.
 */
const DOCUMENT_SURFACE = /-document\.tsx$/

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })

const TAG = /<([a-z][a-zA-Z0-9-]*)\b((?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?)\/?>/gs

/**
 * Blank out comments before scanning, preserving newlines so line numbers stay
 * true. Without this, a doc comment that *names* the control it replaced reads
 * as a violation — `time-select.tsx` is composed from Popover + Command and was
 * reported as a native `<input type="time">` purely because its comment
 * explains what it exists instead of.
 */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length))

export function scan() {
  const findings = []
  for (const file of walk(ROOT)) {
    if (!/\.tsx?$/.test(file) || file.includes(UI_LAYER)) continue
    const source = stripComments(readFileSync(file, "utf8"))
    const path = relative(".", file)
    const lineOf = (index) => source.slice(0, index).split("\n").length

    for (const match of source.matchAll(TAG)) {
      const [, tag, attrs = ""] = match
      const line = lineOf(match.index)
      const typeMatch = /type=(?:"([^"]+)"|\{\s*"([^"]+)"\s*\})/.exec(attrs)
      const inputType = typeMatch?.[1] ?? typeMatch?.[2]

      if (tag === "input" && inputType && BANNED_INPUT_TYPES.has(inputType)) {
        findings.push({ file: path, line, kind: `input[type="${inputType}"]`, exempt: false })
      } else if (OTHER_TAGS.has(tag)) {
        findings.push({ file: path, line, kind: `<${tag}>`, exempt: false })
      } else if (TABLE_TAGS.has(tag)) {
        findings.push({
          file: path,
          line,
          kind: `<${tag}>`,
          exempt: DOCUMENT_SURFACE.test(file),
          reason: DOCUMENT_SURFACE.test(file) ? "A4 document structure — print pagination" : undefined,
        })
      }
      if (/(^|\s)title=/.test(attrs)) {
        findings.push({ file: path, line, kind: 'title="" tooltip', exempt: false })
      }
    }

    for (const match of source.matchAll(/window\.(alert|confirm|prompt)\s*\(/g)) {
      findings.push({ file: path, line: lineOf(match.index), kind: `window.${match[1]}()`, exempt: false })
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

const findings = scan()
const violations = findings.filter((f) => !f.exempt)

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ findings, violations: violations.length }, null, 2))
} else {
  for (const f of violations) console.log(`${f.file}:${f.line}  ${f.kind}`)
  const exempt = findings.length - violations.length
  console.log(`\n${violations.length} violation(s); ${exempt} exempt (A4 document structure)`)
}

process.exitCode = violations.length > 0 ? 1 : 0
