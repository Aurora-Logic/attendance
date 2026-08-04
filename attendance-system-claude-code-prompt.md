# Claude Code Build Prompt — Attendance, Leave & Payroll System

> Paste everything below the line into Claude Code as your opening prompt.
> Assumptions I made are listed at the very bottom of this file — edit those lines before pasting if any are wrong.

---

## 0. Role and working style

You are building a production-grade **employee attendance, leave and payroll system** for a small-to-mid Indian company (assume 20–500 employees, single or multi-branch).

Before writing code:
1. Read this entire brief.
2. Produce a short implementation plan (data model + module list + build order) and wait for my approval.
3. Then build **phase by phase**, in the order given in section 12. Do not build everything in one pass.
4. After each phase, run the app, show me what works, and list what is stubbed.

Ask me before inventing a business rule that isn't specified here. Where a rule *is* specified, make it **configurable in an admin settings table** — never hardcode a number.

---

## 1. Tech stack

- **Frontend:** React + TypeScript + Vite, **shadcn/ui** + Tailwind, TanStack Query, React Hook Form + Zod
  - I have the **shadcn MCP server connected** — use it. See section 1a.
- **Excel:** ExcelJS on the server for all `.xlsx` generation; SheetJS on the client only for import parsing
- **Backend:** Node.js + TypeScript, Fastify or Express, **PostgreSQL** via Prisma
- **Auth:** JWT access + refresh tokens, httpOnly cookies, bcrypt/argon2 password hashing
- **File storage:** S3-compatible (MinIO locally, S3/R2 in prod) for punch selfies — never store images in the DB
- **Jobs:** BullMQ + Redis for nightly attendance finalisation, notifications, report generation
- **Mobile/kiosk:** responsive PWA with camera access (`getUserMedia`), installable, works on a shared tablet at the gate *and* on personal phones
- **Testing:** Vitest for units, Playwright for the critical punch and payroll flows
- Monorepo, `docker-compose` for Postgres + Redis + MinIO, `.env.example` committed, seed script with demo data for every role

---

## 1a. Using the shadcn MCP server

The shadcn MCP server is connected in this session. Treat it as the source of truth for UI components — **do not hand-write a component that the registry already provides, and do not copy component source from memory.**

**Before anything else:** run `npx shadcn@latest init` so `components.json` exists. Without it the MCP has no configured registry and every install call fails. Pin the CLI version in `package.json` — the registry is mid-migration from `radix-ui` to `@base-ui/react` primitives (e.g. `button` is Radix, `combobox` is Base UI), and drifting versions mid-build will split the app across both.

Workflow for every screen:

1. **Search the registry first.** Before building any UI surface, query the MCP for relevant components and blocks. Verified against the registry, this app needs:
   - *Data surfaces:* `table`, `chart`, `pagination`, `scroll-area`, `skeleton`, `empty`, `spinner`, `badge`, `avatar`, `card`, `item` + `item-group`, `aspect-ratio` (selfie thumbnails)
   - *Input:* `form`, `field` + `field-group`, `input`, `input-group`, `textarea`, `select`, `native-select`, `combobox`, `checkbox`, `radio-group`, `switch`, `slider`, `label`, `calendar`, `input-otp` (kiosk PIN fallback when camera is denied), `toggle` + `toggle-group` (P/A/HD muster marking)
   - *Overlays & nav:* `dialog`, `drawer`, `sheet`, `popover`, `dropdown-menu`, `context-menu`, `alert-dialog`, `command`, `tooltip`, `hover-card`, `sonner`, `tabs`, `sidebar`, `breadcrumb`, `collapsible`, `separator`, `button`, `button-group`, `kbd`, `alert`, `progress`, `resizable`
   - *Non-component:* the `use-mobile` hook and `utils` lib
2. **Three things on that list are patterns, not components — do not try to install them:**
   - **`data-table` does not exist as a registry item.** Build it from `table` + TanStack Table, using the `data-table-demo` example from the MCP as the reference for column defs, sorting, filtering, row selection and pagination. Get it right once, then reuse it as the single shared table for every report. **Pin `@tanstack/react-table` to `^8`** — v8 is what every shadcn example targets; v9 replaced `useReactTable`/`getCoreRowModel` with a modular `constructTable`/`*Feature` API and will not compile against the demo.
   - **`date-picker` does not exist as a registry item.** It is `popover` + `calendar`. Pull `date-picker-demo`, `date-picker-with-presets` and `date-picker-with-range` from the MCP — the range picker is what every report filter uses.
   - **`form` resolves to an empty item in the current style** (`radix-nova`) — `shadcn add @shadcn/form` writes no file. Forms compose `field` (`Field`, `FieldGroup`, `FieldLabel`, `FieldDescription`, `FieldError`) with React Hook Form's `Controller` directly. There is no `<Form>`/`<FormField>` wrapper any more; the `form-rhf-*` examples are the current pattern.
3. **Prefer blocks over assembling from primitives.** `dashboard-01` (sidebar + charts + data table) is the admin shell — start from it. `sidebar-07` (collapses to icons) suits a dense admin; `sidebar-16` adds a sticky header. Auth screens come from `login-01`–`login-05`. Dashboard charts come from the `chart-*` blocks (`chart-area-interactive` for the monthly trend, `chart-bar-interactive` for late/absent breakdowns, `chart-radial-text` for live-present KPI) — do not write Recharts by hand.
4. **Use the form binding that matches our stack.** The registry ships `form-rhf-*`, `form-tanstack-*`, `form-formisch-*` and `form-next-*` variants. We are on React Hook Form + Zod, so read the **`form-rhf-*`** examples only.
5. **Mobile surfaces use the responsive pattern, not a second layout.** `dialog` on desktop, `drawer` on mobile, switched by the `use-mobile` hook — see the `drawer-dialog` example. Same for `combobox-responsive`. The PWA punch screen and every approval sheet follow this.
6. **Install through the MCP**, then extend. Don't fork a component to add a feature if a prop or `className` will do.
7. If the registry genuinely has no component for a need (camera capture, geofence map, muster-roll grid, Excel import preview), build it from shadcn primitives so it inherits the same tokens and dark-mode behaviour. Never introduce a second UI library.

### Look and feel: sleek, and shadcn's own defaults

The target is the shadcn docs site itself — quiet, dense, unmistakably default. Restraint is the design.

- **Install a registry theme, don't hand-write CSS variables.** `theme-zinc`, `theme-stone`, `theme-slate`, `theme-gray` and `theme-neutral` are installable items. Pick one, install it, stop. Fonts are registry items too (`font-inter`, `font-geist`, `font-dm-sans`, …) — install one rather than wiring `@font-face`.
- **Only the registry's own size tokens.** Buttons are `sm` | *default* | `lg`, and `icon-sm` | `icon` | `icon-lg`. Never an arbitrary `h-14`, `px-7`, `text-[15px]` or `rounded-[10px]`. If a size looks wrong, the layout is wrong, not the token.
- **Default size is the default.** Use `size="sm"` only in table toolbars, filter bars and inline row actions where density genuinely helps. Never mix sizes within one row of controls.
- **Never restyle a component's interior.** `className` on a registry component is for layout only — width, margin, grid placement, `w-full`. Padding, height, font size, radius and colour stay as shipped.
- **Semantic tokens only:** `bg-background`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border`, `bg-destructive`. No hex, no `slate-700`, and no `dark:` overrides on anything already tokened — dark mode then works for free.
- **One accent per screen.** Exactly one `variant="default"` button (the primary action); everything else is `outline`, `ghost` or `secondary`. Attendance statuses are `badge` variants, never custom colours.
- **Flat, not decorated.** Borders and `bg-muted` carry the hierarchy. No shadow beyond the card default, no gradients, no custom animation.
- **Icons:** `lucide-react` only, sized by the component (`[&_svg]:size-4`) — don't set icon dimensions by hand.
- **Spacing** from the Tailwind scale in steps of 2 (`gap-2`, `gap-4`, `gap-6`, `p-4`, `p-6`). `Card` padding is never overridden.
- **Typography** is `text-sm` body, `text-muted-foreground` for secondary, and the registry `typography-*` examples for headings. No custom type scale.

At the end of each phase, list which registry components, blocks and examples you pulled in, so the dependency surface stays visible.

---

## 2. Roles and permissions

Four roles. Build a **permission matrix table in the DB**, not `if (role === 'admin')` checks scattered in code.

| Capability | Admin | HR | Operations | Employee |
|---|---|---|---|---|
| Company/branch/shift/holiday config | ✅ | view | view | — |
| Create/edit/deactivate employees | ✅ | ✅ | — | — |
| Salary structure + payroll run + payslips | ✅ | ✅ | — | own payslip |
| Leave policy config, leave balance adjust | ✅ | ✅ | — | — |
| Approve leave | ✅ | ✅ | ✅ (own team, L1) | — |
| Approve attendance regularisation | ✅ | ✅ | ✅ (own team, L1) | — |
| View punch selfies | ✅ | ✅ | own team | own only |
| Roster / shift assignment | ✅ | ✅ | ✅ (own team) | view |
| All reports | ✅ | ✅ | own team only | own only |
| Audit log | ✅ | view | — | — |
| Punch in/out, apply leave, raise regularisation | ✅ | ✅ | ✅ | ✅ |

- Approval chain is **configurable**: L1 = reporting manager (Operations), L2 = HR. Auto-escalate to L2 if L1 doesn't act within N days.
- Support a **reporting manager** field on employee so "own team" resolves recursively down the hierarchy.

---

## 3. Punch (login/logout) — the core flow

### Capture
Every punch records: employee, timestamp (**server time, always** — never trust the device clock), punch type, **selfie**, GPS lat/long + accuracy, device fingerprint, IP, and the resolved shift.

- Selfie is captured in-app from the live camera. **Block gallery/file upload.**
- Overlay date, time, employee name and location onto the stored image server-side, and also keep the values as real DB columns (the overlay is for human proof, the columns are for logic).
- Store the image compressed (target < 200 KB, WebP), with a retention policy (default: purge after 12 months, configurable).
- Basic anti-spoof: reject if no face detected, and flag repeated identical image hashes.

### Timing window rule
This is your rule, made explicit and configurable per shift:

- `punch_in_window_before` (default 10 min) and `punch_in_window_after` (default 10 min) around shift start.
- Same pair for shift end.
- **Inside the window** → punch accepted, marked `ON_TIME`.
- **Outside the window** → the punch is still **recorded**, but flagged `EARLY` / `LATE` / `EARLY_EXIT` and **requires approval** (L1) before it counts for payroll. Do *not* silently reject the punch — a blocked punch turns a present employee into an absent one and creates a payroll dispute. If you want a hard block, that must be an admin toggle (`hard_block_outside_window`, default **off**).
- Grace policy: `late_grace_minutes` (default 10) and `late_marks_to_half_day` (default 3 lates in a month = 1 half day). Configurable.

### Other punch rules
- Geofence per branch (lat/long + radius, default 200 m). Outside geofence → allowed but flagged `OUT_OF_GEOFENCE`, needs approval. Support "field employee" flag that exempts them.
- Prevent duplicate punches within `min_punch_gap_minutes` (default 2).
- Support optional **mid-day break punches** (out/in) so half-day and overtime math is accurate.
- **Missed punch-out** → nightly job auto-closes the day, marks it `MISSING_PUNCH_OUT`, and pushes a regularisation request to the employee.
- Full **offline queue**: if the network drops, queue the punch locally (IndexedDB) with the device timestamp, sync on reconnect, and flag it `OFFLINE_SYNCED` with the server-recorded sync delta visible to HR.

### Day statuses
`PRESENT`, `HALF_DAY`, `ABSENT`, `WEEKLY_OFF`, `HOLIDAY`, `ON_LEAVE`, `ON_LEAVE_HALF`, `WFH`, `ON_DUTY` (client visit / outdoor duty), `PENDING_APPROVAL`.

Half day is derived from **both** an explicit employee-selected "Half Day" option at punch time **and** automatically from worked hours (`half_day_min_hours`, default 4; `full_day_min_hours`, default 8). Show the employee which rule applied.

---

## 4. Shifts, roster and calendar

- Shift master: name, start, end, break duration, weekly-off pattern (fixed days or rotational), grace/window settings, overtime rules, night-shift flag (shift crossing midnight must be handled correctly).
- Roster: assign shift per employee per date, bulk-assign by team/month, copy-previous-week.
- Weekly off configurable per employee (e.g. alternate Saturdays).
- Holiday calendar per branch/state (India — holidays differ by state), with optional/floating holidays the employee can elect.

---

## 5. Leave management

- Leave types: Casual (CL), Sick (SL), Earned/Privilege (EL/PL), Loss of Pay (LOP), Comp-Off, Maternity, Paternity, Bereavement — plus admin-created custom types.
- Per type config: paid/unpaid, annual quota, accrual (monthly/quarterly/annual/on-joining), carry-forward cap, encashable, max consecutive days, min notice days, requires document (e.g. SL > 2 days), applicable gender, applicable after probation, negative balance allowed.
- **Pro-rata accrual** for mid-year joiners and leavers.
- Half-day and hourly/short leave support.
- Sandwich-leave policy toggle (does a holiday/weekly-off between two leave days get counted).
- Comp-off: earned from approved overtime or holiday working, with an expiry window.
- Apply → approve/reject with remarks → balance auto-deducts → cancellation and mid-approval withdrawal supported.
- Leave calendar view showing team overlaps, plus a configurable cap on how many team members can be on leave the same day.
- Balance ledger table: every credit/debit as an immutable row, so any balance is explainable.

### Attendance regularisation
Separate request type for: missed punch, wrong punch, out-of-geofence, on-duty/client visit, WFH. Same approval chain, same audit trail.

---

## 6. Payroll

Payroll consumes a **locked** attendance month. Sequence: month ends → HR reviews exceptions → HR **locks** the month → payroll runs. No payroll on unlocked data.

- Salary structure per employee: Basic, HRA, Conveyance, Special Allowance, custom earnings; deductions PF, ESI, Professional Tax, TDS, advances/loans, LOP.
- Payable days = total days − LOP days − unapproved absents; paid leaves and holidays count as **paid**.
- Per-day rate basis is configurable: calendar days / working days / fixed 26 days.
- Overtime: rate multiplier per shift, only from approved overtime.
- Late-mark → half-day → LOP conversion per section 3.
- Statutory (make each a toggle with editable rates, since these change):
  - **PF** 12% employee + 12% employer, wage ceiling ₹15,000
  - **ESI** 0.75% employee + 3.25% employer, applicable up to ₹21,000 gross
  - **Professional Tax** — slab table per state
  - **TDS** — simple projected-annual method; allow manual override
- Arrears, bonus, reimbursements, one-off adjustments.
- **Payslip PDF** with company letterhead, downloadable by the employee, emailed on release.
- **Bank transfer / salary register export** (Excel + CSV) in a bank-upload-friendly layout.
- Payroll run is versioned and immutable once released; corrections happen via a new adjustment run, never by editing history.

---

## 7. Reports

All reports: date-range + branch + department + employee filters, on-screen table, and export to **Excel** (primary) and PDF (secondary). Schedule any report to email daily/weekly/monthly with the `.xlsx` attached.

### Excel export — treat this as a core feature, not an afterthought

Every report and register in this section must produce a proper `.xlsx`, generated **server-side with ExcelJS** and streamed to the client. Requirements:

- **Real Excel, not CSV-renamed.** Typed cells — dates as dates, numbers as numbers, currency with `₹#,##0.00` format. No number stored as text.
- **Formatted for a human to open and use immediately:** bold header row, frozen header + frozen employee-name column, auto-filter on, sensible column widths, borders on the data range, company name + report title + date range + generated-on timestamp in the top rows.
- **Conditional formatting** on the muster roll grid — colour-code P / A / HD / L / WO / H so the sheet is readable at a glance. Include a legend.
- **Multi-sheet workbooks** where it helps: e.g. the monthly attendance workbook = `Summary` + `Muster Roll` + `Late & Early` + `Exceptions` + `Leave Taken`, one export instead of five.
- **Salary register** exports with a totals row (Excel `SUM` formulas, not baked-in values, so the accountant can verify), plus a separate **bank upload sheet** in the plain layout banks accept.
- **Large exports run as a background job** (BullMQ) with a download link when ready — never block the request thread. Anything over ~5,000 rows goes async, with ExcelJS streaming writer.
- **Import too, not just export:** bulk employee import, bulk roster/shift assignment, opening leave balances, and salary structures — all from `.xlsx`. Ship a downloadable template for each, validate on upload, and return an annotated error workbook with a `Reason` column on failed rows.
- Filenames: `{Company}_{Report}_{Branch}_{YYYY-MM}.xlsx`.
- Put export logic in one shared service with a declarative column-definition config, so adding a new report is a config change, not new export code.

- Daily attendance register (who's in, who's late, who's absent — live)
- Monthly muster roll / attendance sheet (the classic grid: employees × days)
- Late-coming and early-going report
- Absenteeism and LOP report
- Overtime report
- Leave balance and leave-availed report
- Missing-punch / exception report
- Regularisation and approval-turnaround report
- Salary register + statutory reports (PF ECR format, ESI return format)
- Headcount, attrition, joiners/leavers
- **Dashboards:** Admin/HR = company-wide live present count, on-leave, late %, monthly trend. Operations = own team. Employee = own attendance calendar, leave balances, last 6 payslips.

---

## 8. Robustness features (build these — they are what make it survive real use)

1. **Immutable audit log** — every create/update/approve/delete: who, what, before, after, when, IP. Attendance and payroll rows are never hard-deleted; corrections create a new versioned row with a reason.
2. **Notifications** — in-app + email, with WhatsApp/SMS behind a provider interface so it can be plugged in later. Triggers: punch reminder, missed punch-out, leave applied/approved/rejected, approval pending > N days, payslip released.
3. **Bulk employee import** from Excel with validation preview and a downloadable error file.
4. **Multi-branch / multi-company** support from day one in the schema, even if the UI only shows one.
5. **Timezone-safe**: store UTC, render in company timezone (Asia/Kolkata default). Test night shifts across midnight and DST-free assumptions explicitly.
6. **Rate limiting** on punch and auth endpoints; account lockout after N failed logins.
7. **Soft delete + employee lifecycle**: probation, confirmation, resignation date, last working day, full-and-final settlement flag. Ex-employee data stays queryable for reports.
8. **Data export & deletion** requests per employee (India DPDP Act-friendly), with an explicit consent record for capturing location and photographs.
9. **Health check, structured logging, error tracking hook (Sentry), DB backup script.**
10. **Idempotency keys** on punch and payroll-run endpoints so a double-tap or a retry never creates duplicates.
11. **Seed/demo mode** with 30 fake employees and 3 months of realistic attendance, so reports and payroll can be tested immediately.
12. **Accessibility + i18n scaffolding** (English + Hindi/Marathi ready), and the punch screen must be usable one-handed on a low-end Android phone.

---

## 9. Data model (starting point — refine and show me before building)

`companies`, `branches`, `departments`, `designations`, `employees`, `employee_salary_structures`, `users`, `roles`, `permissions`, `role_permissions`, `shifts`, `shift_assignments`, `weekly_off_patterns`, `holidays`, `holiday_calendars`, `punches`, `attendance_days` (the derived, one-row-per-employee-per-day table that everything downstream reads), `attendance_exceptions`, `regularisation_requests`, `leave_types`, `leave_policies`, `leave_balances`, `leave_ledger`, `leave_requests`, `comp_offs`, `payroll_runs`, `payroll_run_items`, `payslips`, `statutory_configs`, `advances_loans`, `notifications`, `audit_logs`, `settings`.

Key principle: **`punches` is the raw append-only log; `attendance_days` is the computed truth.** A nightly job (and an on-demand recompute) derives `attendance_days` from punches + shift + leave + holiday. Recomputing must be idempotent and safe to re-run for any past date range before the month is locked.

---

## 10. UI expectations

- Punch screen: one dominant primary action, live camera preview, current server time ticking, today's shift, and immediate visual confirmation with the stamped photo thumbnail. Under 3 seconds from open to punched.
  - The button gets its presence from **`size="lg"` + `className="w-full"`**, not from a hand-tuned height. Width is layout; height stays a token. It is the only `variant="default"` on the screen — everything else is `ghost` or `outline`.
  - Selfie thumbnail sits in an `aspect-ratio`; confirmation is a `sonner` toast plus a `badge` for the resolved status (`ON_TIME` / `LATE` / `OUT_OF_GEOFENCE`).
- Half-day is a visible `switch` (or `toggle-group` for Full / Half) on the punch screen, not buried in a menu.
- Clean, dense, professional admin UI — sticky headers, column filters, saved views, keyboard-friendly (`kbd` hints, `command` palette). Built once as a shared table from `table` + TanStack Table per §1a — there is no `data-table` component to install.
- Every approval surface supports **bulk approve** with a reason field — row selection from the data-table pattern, `button-group` for the approve/reject/split action, `alert-dialog` for confirmation.
- Empty states (`empty`), loading skeletons (`skeleton`), inline pending states (`spinner`), and optimistic updates everywhere.
- Every dialog has a `drawer` counterpart on mobile via the `use-mobile` hook — the same screen, not a second layout.

---

## 11. Non-negotiables

- Server time is the only source of truth for punch timing.
- No business rule hardcoded — everything from section 3 onward reads from `settings` or a policy table.
- Payroll never reads unlocked attendance.
- Every money calculation has a unit test with a worked example.
- No PII or selfie URL exposed in any API response the requesting role isn't permitted to see.

---

## 12. Build order

- **Phase 0** — `npx shadcn@latest init`, install a registry theme + font, install the `dashboard-01` and `sidebar-07` blocks as the app shell, and build the shared data-table from the `data-table-demo` example. Every later phase composes screens out of this; no phase re-invents a table.
- **Phase 1** — Schema, migrations, auth (`login-01` block), RBAC, employee CRUD, branch/department, seed data.
- **Phase 2** — Shifts, roster, holiday calendar, weekly offs.
- **Phase 3** — Punch flow end to end: camera, selfie upload, geofence, window rules, offline queue, `attendance_days` computation job.
- **Phase 4** — Exceptions, regularisation, approval workflows, notifications.
- **Phase 5** — Leave types, policies, balances, ledger, apply/approve, leave calendar.
- **Phase 6** — Reports + exports + dashboards.
- **Phase 7** — Salary structures, payroll run, payslips, statutory, bank export.
- **Phase 8** — Audit log UI, bulk import, settings screens, hardening, Playwright tests.

Deliver a `README.md` with setup steps and a `DECISIONS.md` recording every business rule you implemented and its default value.

---

## Assumptions to check before you paste

1. **Stack** — React + shadcn/ui + TypeScript with a Node/Postgres backend (matching how you're building the CRM). Change section 1 if you'd rather go Next.js full-stack, or Laravel/Django.
2. **Hard block vs flag** — I've made out-of-window punches *recorded but flagged for approval* rather than rejected outright. This is deliberate: a rejected punch makes a present employee look absent and creates payroll disputes. The hard block exists as an off-by-default toggle.
3. **Payroll depth** — statutory calculation (PF/ESI/PT/TDS) is still written into section 6, but the **Excel export path in section 7 is the must-ship deliverable**. If salaries are actually processed in Tally or by a CA, tell Claude Code to defer all of section 6 except payable-days computation and the salary register export to a later phase — that cuts roughly 40% of the build.
4. **Scale** — written for 20–500 employees, single company, few branches. Say so if it's larger or multi-tenant SaaS.
5. **Face recognition** — I've specified selfie + face *detection* (is there a face?), not face *recognition* (is it the right person?). Recognition needs a separate model, an enrolment flow, and consent handling. Add it as a Phase 9 if you want it.
