# audit/native-components.md

Phase 1 deliverable. Every native control found in `apps/web/src`, what it is
being replaced with, and the one carve-out.

**Scanned:** `apps/web/src/**/*.{ts,tsx}`, excluding `components/ui/` (the shadcn
layer itself, which is allowed to hold native elements — that is its job).

**Method:** a multiline-aware JSX scan
(`scripts/scan-native-components.mjs`). Line-based grep is not enough here: JSX
attributes wrap across lines, and the first pass missed a `<input
type="checkbox">` I had written myself three lines tall.

**Total found: 55.** Of these, **46 are exempt** under the document carve-out
below and **9 required replacement**. All 9 are now done — the scan reports
zero violations.

One earlier entry was a **false positive in my own scanner**, recorded here
rather than quietly dropped: `components/time-select.tsx` was reported as a
native `<input type="time">`. It is not — it is already composed from `Popover`
+ `Command`, exactly as rule 1.2 requires. The match came from its doc comment,
which names the native input it exists to replace. The scanner now blanks
comments before matching (preserving newlines so line numbers stay true).

---

## The carve-out — document surfaces

`components/po-document.tsx` and `components/estimate-document.tsx` render an A4
sheet. They are shown on screen as a WYSIWYG preview (estimate detail, sales
order detail, invoice detail, estimate new) and printed through
`printPoDocument`.

**Exempt: table elements only.** `<table> <thead> <tbody> <tr> <td> <th>` — 46
occurrences. shadcn `Table` wraps its content in an `overflow-x-auto`
container, which stops a long table paginating across printed pages: a purchase
order with forty lines would print its first page and clip the rest. The table
here is the document's structure, not a UI data grid.

**Not exempt, in the same files:** `title=""` tooltips and `<textarea>`. Those
are screen-only editing affordances — several are literally marked
`print:hidden` — and have nothing to do with print pagination. They are in the
replacement list below.

The ESLint rule encodes exactly this split: the file pattern is exempted for
the table elements and for nothing else.

---

## Replacements

| # | File | Line | Native control | Replaced with | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | `components/fulfilment-dispatch.tsx` | 205 | `<input type="checkbox">` | shadcn `Checkbox` | done |
| 2 | `components/settings-branding.tsx` | 123 | `<input type="file">` | shadcn `Button` + `sr-only` input in a drop target | done |
| 3 | `routes/attendance.tsx` | 134 | `title={status}` on a `<span>` | shadcn `Tooltip` | done |
| 4 | `components/estimate-document.tsx` | 453 | `title="Pick a different customer"` | shadcn `Tooltip` | done |
| 5 | `components/estimate-document.tsx` | 581 | `title="Remove this line"` | shadcn `Tooltip` | done |
| 6 | `components/po-document.tsx` | 586 | `title="Pick a different vendor"` | shadcn `Tooltip` | done |
| 7 | `components/po-document.tsx` | 722 | `title="Remove this line"` | shadcn `Tooltip` | done |
| 8 | `components/estimate-document.tsx` | 739 | `<textarea>` | shadcn `Textarea` | done |
| 9 | `components/po-document.tsx` | 881 | `<textarea>` | shadcn `Textarea` | done |

### Note on the file input

It was already `Button` + a hidden input, which is the shape rule 1.1 asks for,
but it used `className="hidden"`. `display:none` removes the input from the
accessibility tree, so a screen reader never learns there is a file field at
all. It is now `sr-only` — visually hidden, still announced — and sits in a
drop target, which the rule also asks for and which did not exist.

### Not found

Worth recording, so a future reader knows these were checked rather than
missed: no `<select>`, `<option>`, `<optgroup>`, `<dialog>`,
`<input type="radio">`, `<input type="date">`, `<input type="datetime-local">`,
`<input type="range">`, `<input type="color">`, `window.alert`,
`window.confirm` or `window.prompt` anywhere in `apps/web/src`.

The date pickers already go through shadcn `Popover` + `Calendar`, and the time
picker through `Popover` + `Command`. The earlier reports that "the calendar is
still the default one" and "the time picker is native" are therefore about the
*styling* of those composed components, not about native controls — Phase 3
addresses the styling.

---

## Enforcement

ESLint was **not configured anywhere in this repo** before this phase — no
config at the root or in any package — so Phase 1 installed and configured it
(`apps/web/eslint.config.js`) rather than adding a rule to an existing setup.

`apps/web` build script is now `eslint src --max-warnings 0 && tsc -b && vite
build`, so a violation fails the build rather than sitting in a side script
nobody runs.

What it catches, proved against a deliberate probe file containing every banned
pattern — **11 of 11 caught**:

| Pattern | Rule |
| --- | --- |
| `<input type="checkbox\|radio\|date\|datetime-local\|time\|file\|range\|color">` | `no-restricted-syntax`, per-type message naming the replacement |
| `<select> <option> <optgroup> <textarea> <dialog>` | `react/forbid-elements` |
| `<table> <thead> <tbody> <tfoot> <tr> <td> <th> <caption>` | `react/forbid-elements`, except the A4 document surfaces |
| `title=""` on a lowercase (DOM) element | `no-restricted-syntax` — deliberately not on our own components, where `title` is a legitimate prop |
| `window.alert / confirm / prompt` | `no-restricted-syntax` |
| Emoji in JSX text, string literals and template strings | `no-restricted-syntax` |

Two deliberate carve-outs, both narrow:

- **`components/ui/**`** — the shadcn layer exists to wrap native elements.
- **`components/*-document.tsx`** — table elements only (see the carve-out
  above). Tooltips, textareas and inputs are still enforced there.

**One thing the rule had to permit.** Rule 1.1's own prescription for a file
input *keeps* the native element ("Button + visually-hidden input"). So the ban
allows exactly that shape — a `className` carrying `sr-only` — and nothing
looser: a bare file input, or one hidden with `hidden` (which removes it from
the accessibility tree), still fails.

### The emoji gate, and what it deliberately does not cover

Scoped to JSX text and string literals, not comments, per the decision in
`PLAN.md`.

It covers pictographs and dingbats. It deliberately **excludes the arrow
blocks** (U+2190–21FF, U+2B00–2BFF). Turning the gate on showed my earlier
count was wrong: I had reported "173 of 177 are in comments, 1 user-visible",
but 39 arrows are in *user-visible strings* — "below a full day → HALF_DAY",
"12 rows → Excel". An arrow used as punctuation is typography, not an emoji,
and a lint rule is the wrong place to decide otherwise.

**Open question for you:** should those 39 strings be reworded to plain prose
under rule 1.8 ("plain verbs", "no jargon")? "At or above this but below a full
day counts as a half day" reads better than "… → HALF_DAY". I have not touched
them.

Exactly one real pictograph existed in UI copy — a `✓` appended to a lorry-
receipt button, which I had written myself. It is now a lucide `Check` icon.

### Also fixed by turning the linter on

- `lib/roster.ts` — a dead `= null` initialiser whose type (`ShiftSpec | null`)
  claimed something untrue; every branch assigns a real shift.
- `routes/expenses.tsx`, `routes/indents.tsx` — helpers recreated on every
  render and closed over by memoised table columns, so the columns could hold a
  stale function. Both are now `useCallback` with honest dependencies. This is
  the same class of bug the audit found in `settings-operations.tsx`.
- `routes/roles.tsx` — a suppression comment that no longer suppressed
  anything.
