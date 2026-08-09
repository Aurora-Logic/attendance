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

`react/forbid-elements` plus a custom rule for the `type=`-qualified inputs and
for `title=""` on DOM elements, failing the build outside `components/ui/`.
ESLint was **not configured anywhere in this repo** before this phase — there
was no config at the root or in any package — so Phase 1 installs and
configures it rather than adding a rule to an existing setup.

Paired with the emoji gate (rule 1.3), scoped to JSX text and string literals
rather than comments, per the decision recorded in `PLAN.md`.
