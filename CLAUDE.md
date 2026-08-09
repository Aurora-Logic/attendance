# Delta — working rules

This file is loaded into every session. It records the constraints that outlive
any single task. If a request conflicts with anything here, stop and ask rather
than guessing.

---

## Non-negotiable UI rules

Transcribed from the Full Product Hardening Pass work order, Sections 1 and 2.
A change that violates any of these is rejected.

### 1. NON-NEGOTIABLE RULES

#### 1.1 shadcn-only component layer

No native form controls anywhere. Zero tolerance. Banned in application code:

| Banned | Use instead |
| --- | --- |
| `<input type="checkbox">` | shadcn `Checkbox` |
| `<input type="radio">` | shadcn `RadioGroup` |
| `<select>` / `<option>` | shadcn `Select`, or `Combobox` when >8 options or searchable |
| `<input type="date">` / `datetime-local` | shadcn `Popover` + `Calendar` |
| `<input type="time">` | composed time picker (see 1.2) |
| `<input type="file">` | shadcn `Button` + visually-hidden input, styled as a dropzone |
| `<textarea>` | shadcn `Textarea` |
| `<dialog>`, `window.alert/confirm/prompt` | shadcn `Dialog` / `AlertDialog` |
| Browser tooltips via `title=""` | shadcn `Tooltip` |
| Native `<table>` styling | shadcn `Table` primitives |

**Enforcement, not vibes.** An ESLint rule fails the build on any of the above
outside `components/ui/`.

**Audit deliverable:** `audit/native-components.md` lists every file + line where
a native control was found and what replaced it.

#### 1.2 Where shadcn has no primitive

Three things here have no registry component. Do not install a third-party
library. Compose from shadcn primitives so they inherit our tokens:

- **Time picker** — `Popover` + `Command` (hour / minute / meridiem columns),
  typed entry via `Input`. Keyboard-only entry must work: type `1430` → 14:30.
- **Calculator** — see the work order 5.6.
- **Data grid** — shadcn `Table` + TanStack Table headless. Headless only.

A fourth case requires asking before installing anything.

#### 1.3 No emojis. Icons only.

- No emoji in UI copy, empty states, toasts, statuses, badges, seed data or
  notification text.
- One icon set (`lucide-react`). One icon per concept, used consistently — if
  "dispatched" is a truck in one place it is a truck everywhere.
- A build check fails on any hit in `src/`.

#### 1.4 One hierarchy, product-wide

```
AppShell
└─ PageHeader    → title (single H1), breadcrumb, primary action, secondary actions
   └─ PageToolbar → filters, search, view switcher, export        (optional)
      └─ PageContent → the actual work surface
         └─ PageFooter / pagination                               (optional)
```

- Exactly one H1 per page. Section titles H2. Card titles H3. No skipped levels.
- Spacing scale 4 / 8 / 12 / 16 / 24 / 32 / 48. No magic numbers.
- Same page padding, max-width, header height and toolbar height on every screen.
- Primary action always top-right in `PageHeader`. Never floating, never bottom,
  never duplicated.

#### 1.5 Kill "box in box"

- **Max one level of card nesting.** A `Card` may not contain another `Card`.
  Group inside a card with a `Separator` + label, or whitespace — not a box.
- **A card must earn its border.** The only region on a page needs page
  background and spacing, not a card. Filters do not need a card.
- Prefer, in order: whitespace → alignment → hairline `Separator` → background
  tint → border.
- Replace bordered stat tiles with a row of figures separated by space and a
  type-weight difference.
- **Rule of thumb:** more than 4 visible rounded borders on a screen → redesign
  before shipping.

#### 1.6 Responsive, everywhere, no exceptions

- Tested breakpoints: **320, 375, 414, 768, 1024, 1280, 1440, 1920**.
- **No horizontal page scroll at any breakpoint.** `<body>` never scrolls
  sideways. Horizontal scroll is allowed only inside an explicitly scrollable
  region (a wide data table), which must show a scroll affordance and set
  `overscroll-behavior-x: contain`.
- Usual causes: fixed `min-width`, long unbroken strings, `w-screen`, negative
  margins, absolutely-positioned elements, too many fixed grid columns,
  `whitespace-nowrap` on wrapping content.
- **Detection, not eyeballing:** a Playwright test loads every route at every
  breakpoint and asserts `documentElement.scrollWidth <= clientWidth`. It fails CI.

#### 1.7 Quality floor (assume it, never announce it)

- Visible keyboard focus ring on every interactive element.
- `prefers-reduced-motion` respected.
- Every interactive element reachable and operable by keyboard.
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries.
- Every async surface has a loading skeleton, an empty state with a call to
  action, and an error state saying what broke and what to do.

#### 1.8 Copy rules

- Sentence case. Active voice. Plain verbs.
- Name things by what the user controls, not how the system is built.
- An action keeps its name end to end: the button says "Dispatch", the toast
  says "Dispatched".
- Errors explain what happened and the next step. They never apologise and are
  never vague.
- Empty states are invitations to act, not decoration.

### 2. SCOPE — PAYROLL IS OUT

**Payroll is not run in this product. It is done externally.**

- No payroll processing, salary computation, payslip generation, salary
  structures, or payroll UI / routes / models / permissions.
- **Keep** everything that feeds payroll: attendance, punch records, leave
  balances, holidays, half-days, overtime hours.
- **Provide** a clean export for whoever runs payroll externally: per-employee,
  per-period Excel with present days, absent days, half-days, paid leave
  consumed, unpaid leave, holidays and OT hours. Locked period, no editable
  formulas, one row per employee.
- Payroll is absent from Roles & Permissions.
- No orphaned payroll references in nav, dashboard widgets, reports,
  notifications or seed data.

---

## Working agreements

- Use the **shadcn MCP server** for every component added, replaced or
  inspected. Never hand-write a component the registry provides; never copy one
  from memory or a blog post.
- Use the **apple-design skill** when building or reviewing any screen.
- Do not fake data to make a screen look finished. An honest "not wired yet"
  beats a screen that lies.
- A fixed bug without a regression test is not fixed.
- Commits carry no AI attribution or `Co-Authored-By` trailer.
