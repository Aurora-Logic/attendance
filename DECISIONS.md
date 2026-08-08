# DECISIONS

Every business rule implemented, its default value, and where it is configured.
Nothing in this file is hardcoded in application code — defaults live in
`packages/shared/src/settings.ts` and are overridden at runtime by the `settings`
table.

Status legend: **Implemented** · **Scaffolded** (structure exists, logic pending) ·
**Planned** (phase assigned, not started).

---

## 1. Architecture decisions

| # | Decision | Rationale | Status |
|---|---|---|---|
| A1 | `punches` is append-only; `attendance_days` is the computed truth | A correction must never destroy the original record. Wrong punches are fixed by a *new* punch with `source=ADMIN` linked to an approval, never by an UPDATE. | Scaffolded |
| A2 | `punches.resolved_date` stores the **business date**, not the timestamp's calendar date | A 01:00 punch on the 5th, on a 22:00–06:00 shift, belongs to the 4th. Every downstream query keys on this. Without it, night shifts are silently wrong. | Scaffolded |
| A3 | `attendance_days.payable_units` (1.0 / 0.5 / 0) is the only number payroll reads | Payroll multiplies; it never re-derives attendance logic. One place to explain a salary dispute. | Implemented (type) |
| A4 | Money is integer **paise** (`bigint`), formatted only at the edge | No float drift. Makes §11's "worked example" tests exact-equality assertions. See `packages/shared/src/money.ts`. | Implemented |
| A5 | Effective-dating on salary structures, leave policies, statutory configs, weekly-off patterns | A March payroll rerun in June must use March's PF ceiling. | Planned (P1) |
| A6 | Settings resolve **employee → shift → branch → company → default** through one `getSetting()` service | §11 forbids hardcoded rules; a single resolution chain makes that enforceable. | Scaffolded |
| A7 | One polymorphic approval engine for leave, regularisation, OT and comp-off | All four need configurable L1/L2, escalation, remarks, bulk approve and a turnaround report. Built once in Phase 3.5. | Planned (P3.5) |
| A8 | `payroll_runs.attendance_lock_id` is a **non-null FK** to `attendance_month_locks` | Turns §11's "payroll never reads unlocked attendance" from a code check into a schema constraint. | Planned (P1) |
| A9 | `company_id` on every table, enforced by Prisma middleware | §8.4 multi-company from day one; adding a second company is config, not migration. | Planned (P1) |
| A10 | Face **detection** on-device (MediaPipe), re-verified server-side asynchronously | Keeps the §10 3-second target. Client-side detection alone is a capture-quality gate, not an anti-spoof control — the async job makes it a real one without blocking the employee. | Planned (P3/P4) |

## 2. Attendance defaults (brief §3)

All defined in `packages/shared/src/settings.ts`, all overridable per shift/branch/employee.

| Setting | Default | Meaning |
|---|---|---|
| `punchInWindowBeforeMin` | 10 | Minutes before shift start a punch counts `ON_TIME` |
| `punchInWindowAfterMin` | 10 | Minutes after shift start a punch counts `ON_TIME` |
| `punchOutWindowBeforeMin` | 10 | Same pair for shift end |
| `punchOutWindowAfterMin` | 10 | |
| `hardBlockOutsideWindow` | **false** | Off by design. A rejected punch turns a present employee into an absent one. Outside the window the punch is recorded and flagged for L1 approval. |
| `lateGraceMinutes` | **15** | Minutes past shift start before the day takes a late mark |
| `lateMarksAllowed` | **2** | Late marks forgiven per period before any penalty |
| `latePeriod` | `MONTH` | Window the allowance resets over (`WEEK` or `MONTH`) |
| `latePenalty` | **`ABSENT`** | What the day becomes once the allowance is spent |
| `latePenaltyRepeats` | true | On: every later late is penalised. Off: only the first breach |
| `earlyExitGraceMinutes` | 15 | Mirror of the late grace at shift end |
| `earlyExitMarksAllowed` | 2 | Early exits forgiven per period |
| `earlyExitPenalty` | `HALF_DAY` | Penalty past the early-exit allowance |
| `geofenceRadiusM` | 200 | Per-branch radius; outside → `OUT_OF_GEOFENCE`, flagged not blocked |
| `minPunchGapMinutes` | 2 | Duplicate-punch suppression |
| `halfDayMinHours` | 4 | Worked hours below full-day but at/above this → `HALF_DAY` |
| `fullDayMinHours` | 8 | Worked hours for a full day |
| `selfieThumbMaxPx` / `selfieThumbQuality` | 160 / 45 | Grid thumbnail (~4 KB) |
| `selfieViewMaxPx` / `selfieViewQuality` | 720 / 55 | The image that opens on click (~40 KB) |
| `selfieKeepOriginal` | **false** | Camera original is discarded |
| `selfieRetentionMonths` | 12 | Purge job window |
| `approvalEscalateAfterDays` | 2 | L1 inaction → auto-escalate to L2 |
| `timezone` | `Asia/Kolkata` | Storage is UTC; this is the render timezone |

Half-day precedence: an explicit employee selection at punch time wins; otherwise
worked hours decide. `attendance_days.half_day_reason` records which rule applied,
because §3 requires showing the employee.

### The late rule is one function

`evaluateLate(minutesAfterShiftStart, priorLateMarks, settings)` in
`packages/shared/src/settings.ts` is the only implementation. The nightly
`attendance_days` job, the punch screen's live preview and the settings page's
"what this rule does" panel all call it, so there is no second copy to drift.

It returns the penalty *and* a plain-English explanation, which is what satisfies
§3's requirement to show the employee which rule applied. Worked example at the
shipped defaults: a punch 20 minutes late with 2 prior marks this month returns
`penalty: ABSENT`, `explanation: "Late mark 3 this month, past the 2 allowed —
day marked absent."`

| # | Decision | Rationale |
|---|---|---|
| B1 | Late policy is grace + allowance + period + penalty, not a single number | "3 lates = 1 half day" cannot express "2 lates forgiven, then the day is absent". Four independent knobs cover both and everything between. |
| B2 | `latePenalty` is an enum (`NONE` / `HALF_DAY` / `ABSENT` / `LOP`), not a boolean | The consequence of a late is a policy choice, not a constant. |
| B3 | Early exit mirrors the late rule with its own values | Same shape, separate knobs — a company that forgives lateness rarely forgives leaving early. |

## 3. Frontend decisions

| # | Decision | Rationale |
|---|---|---|
| F1 | shadcn style `radix-nova`, base colour `neutral`, Lucide icons, Geist font | The docs-site default. "Sleek" here means unmodified, not restyled. |
| F2 | Radix base (`-b radix`) over Base UI | Battle-tested a11y for a system that will run payroll. Base UI is newer; mixing the two across a build is the failure mode to avoid. |
| F3 | **`@tanstack/react-table` pinned to v8** | v9 (released, and what `pnpm add` resolves to) replaced `useReactTable`/`getCoreRowModel` with a modular `constructTable`/`*Feature` API. Every shadcn data-table example targets v8. |
| F4 | Shared `DataTable` in `apps/web/src/components/data-table.tsx` | There is no `data-table` component in the registry — it is a pattern. Built once, used by every report. |
| F5 | `form` is **not** used; forms compose `field` + RHF `Controller` | The `radix-nova` style resolves `@shadcn/form` to an item with no files. The `form-rhf-*` examples confirm `Field`/`FieldGroup`/`FieldError` + `Controller` is the current pattern. |
| F6 | Only registry size tokens (`sm` / default / `lg`, `icon-sm` / `icon` / `icon-lg`) | No arbitrary heights or type sizes. `size="sm"` restricted to table toolbars. |
| F7 | Semantic colour tokens only; no `dark:` overrides on tokened elements | Dark mode then works without per-component maintenance. |
| F8 | Every planned route exists from Phase 0 with a phase-labelled placeholder | "What is stubbed" is answerable by opening the app. |
| F9 | **The chart ramp is overridden in `index.css`** | The `radix-nova` style ships `--chart-1..5` as `oklch(L 0 0)` — chroma zero, i.e. pure greyscale — and uses identical values for light and dark. Every preset (Nova, Vega, Maia, Lyra, Mira, Luma, Sera, Rhea) and every `/r/colors/*.json` endpoint does the same. Stacked series were indistinguishable. Five hues are defined at the token layer, per mode; components still read only `var(--chart-N)` and no chart names a colour. |
| F10 | The document never scrolls | Shell is `h-svh overflow-hidden`; the header is structurally fixed; each page is `Page` → `PageHeader` (static) → `PageBody`/`PageBodyFixed` (the one scroll region). Tables and the muster grid scroll their own bodies under sticky headers. |
| F11 | The permission matrix is an editable grid, not a code constant | §2 requires the matrix in the DB. `packages/shared/src/rbac.ts` holds the capability list and seed grants; the Roles screen edits scope per role per capability. |
| F12 | Three additive badge variants (`success`/`warning`/`info`) | Added to `badgeVariants` following the registry's own `destructive` tint pattern, so they inherit identical weight. Extending a variant map is the documented shadcn extension point; forking the component is not. |
| F13 | One `--status-*` token per day status, eight in total | The muster roll is read as a grid — eight codes have to be separable at a glance without re-reading the legend. This is the one screen where more colour earns its keep. Chroma stays low so a full grid still reads as data. `StatusBadge` maps status → token; no component names a colour. |
| F14 | Arrival times are coloured green / blue / red | Early, within grace, and late. Applied to the punch clock and the register's In column, so punctuality is legible without parsing a number. |
| F15 | **No KPI tiles on any screen** — headline numbers live on Reports as one prose line | Tightened by product decision (4 Aug, then 6 Aug): stat tiles turn working surfaces into reports. The Dashboard keeps charts; the live present/leave/pending figures are a single line at the top of Reports. Exceptions that are not KPIs: the employee-detail strip (explicitly requested), the Settings storage estimator (a config aid), and analytics pages, which are report surfaces. |
| F16 | Nav and command palette filter on `can(permission)`, never on role — and a screen may demand **ALL scope** via `requiresFullScope` | `lib/session.tsx` resolves capability → scope through the matrix. **Correction (8 Aug):** this entry used to claim Roles & Permissions "disappears for everyone else because only Admin holds `config.manage` at ALL". That was false — `can()` tests `!== NONE`, and HR and Operations hold `VIEW`, so both saw the screen and could open it. Screens that are only meaningful company-wide now set `requiresFullScope`, honoured identically by the sidebar filter and the route guard. A read-only view of the permission matrix is not a lesser version of editing it; it is a screen nobody asked for. Settings stays available to HR and Operations, whose `VIEW` scope the API already enforces on writes. The sidebar role switcher exists to prove this until Phase 1 auth lands. |
| F17 | Scrollbars are thin with a transparent track | The shell nests several scroll regions; opaque OS bars stack chrome on chrome. Thumb is `--muted-foreground` at 28%, inset by a transparent border so it floats in the gutter. |
| F18 | Reports carries a **custom report builder**: user-composed column/filter/group definitions over the attendance register (6 Aug) | Definitions are personal views, stored client-side under `attendance.custom-reports.v1` (the roster-config localStorage pattern); the rows they run over are always server truth when signed in. `lib/report-builder.ts` is a pure engine (filter → group → sort) with its own tests; export reuses the workbook standards (typed cells, frozen header, auto-filter, SUM subtotals per group + grand total) via dynamic `exceljs`. Composed entirely from installed registry primitives — the registry was searched first and ships no builder block. `scripts/verify-report-builder.mjs` proves the create→run→group→persist→delete loop in a real browser. |

## 5. Geofencing from a Google Maps link

`apps/web/src/lib/geo.ts`. An admin pastes a Maps URL and the branch centre is
extracted from it — no one hunts for raw coordinates.

| Supported | Example |
|---|---|
| Map centre | `.../maps/@19.0760,72.8777,17z` |
| Place pin | `...!3d19.0760!4d72.8777` |
| Query | `?q=19.0760,72.8777` · `?ll=` · `?api=1&query=` |
| Bare paste | `19.0760, 72.8777` |

**Not supported, deliberately:** `maps.app.goo.gl` / `goo.gl/maps` short links
carry no coordinates — they are opaque redirects. The parser detects them and
says so rather than failing vaguely; resolving them needs a server-side redirect
follow, which lands with the API in Phase 3.

`checkGeofence()` returns `inside`, `distanceM` **and** `uncertain`. A phone
reporting ±80 m accuracy at 220 m from a 200 m fence is not reliably outside it.
Those punches are flagged uncertain and routed to approval with the doubt on
record, rather than asserted as violations — the same principle as §3's rule
that flagging beats rejecting.

## 6. Selfie storage

**Requirement:** smallest possible on disk, but any image on any date must still
open.

Those pull in opposite directions only if you store one file. So each punch
stores **two WebP derivatives and discards the camera original**:

| Derivative | Long edge | Quality | Size | Used by |
|---|---|---|---|---|
| `thumb` | 160 px | 45 | ~4 KB | Registers, muster grid, approval rows |
| `view` | 720 px | 55 | ~40 KB | Opens when a punch is clicked |

At 500 employees × 2 punches × 26 days that is ~1.1 GB a month, or ~13 GB held
under the 12-month retention window. Keeping originals instead would be roughly
40× that — a phone selfie is 2–4 MB and **nothing in the system ever reads it**.
The date/time/name/location overlay is burned into both derivatives server-side,
and the same values are stored as real columns, so the image is human proof and
the columns are the logic.

`selfieKeepOriginal` exists as an off-by-default escape hatch for an evidentiary
requirement, and the Settings screen shows a live storage estimate plus a warning
when it is on — the cost of that toggle should not be a surprise discovered at
200 GB.

## 7. Calendar day types and departments

| # | Decision | Rationale |
|---|---|---|
| D1 | A declared **half working day** halves the expectation, not the pay | With an 8h full day, 4h+ on a declared half day earns 1.0; under 2h is still absent. OT starts after the shortened day; the late rule is unchanged. Distinct from an individual's HALF_DAY status. |
| D2 | Holiday vs half day is one choice on the roster date header | Both live in the `holidays` table with a `type` enum — one calendar, one unique row per date, declaring one clears the other. |
| D3 | Departments are a Postgres master with a unique short code | Closing one is a soft `isActive` flag, never a delete — history stays reportable and the code is refused on duplicates (409). Employee forms list only open departments. |
| D4 | The Settings **Guide** is written per task, not per screen | "How do I make Friday a half day?" is how the question arrives. Every entry ends with *what it does* — the rule, not just the clicks — and the header renders the live values so the guide always matches the configuration. |
| D5 | Nightly close is an idempotent pure function | `runNightlyClose(store, date)`: IN without OUT → MISSING_PUNCH_OUT regularisation to the employee, once. Runs at boot for yesterday and hourly after; re-runs create nothing twice. |

## 8. Attendance truth lives in Postgres

Punches, approvals and the leave ledger dual-write: the in-memory store keeps
answering requests synchronously, every mutation also lands in its Postgres
table (fire-and-forget, like the audit log — a DB outage never fails a punch),
and **boot hydration replaces the JSON file's copy with the database rows**, so
Postgres is the system of record across restarts. A one-time backfill migrates
pre-existing file history into empty tables on first boot. Selfie data URLs
deliberately stay out of the DB (§1 — images never in the database); they ride
in the store file until MinIO object storage lands. The JSON file now only
carries what has no table yet (procurement/sales, branding extras, the
export-job registry).

## 9. Backend shape (Phase 1, first cut)

| # | Decision | Rationale |
|---|---|---|
| C1 | The domain is pure functions in `packages/shared`; the API is a thin shell | The nightly job, the API's live view and the web previews all call the same `computeAttendanceDay`/`evaluateLate`/`countLeaveUnits` — three consumers, one implementation, zero drift. |
| C2 | In-memory store behind every route, Prisma schema committed and validated | Docker/Postgres is unavailable on the dev machine. The store mirrors the schema shapes exactly, so the swap is repositories, not redesign. |
| C3 | Auth: JWT access (15m) + refresh (30d) in httpOnly cookies, bcrypt | Matches §1. `/auth/me` strips the credential and a test pins it. |
| C4 | Route guards resolve capability → scope through the matrix | Same data the UI gates on. OWN_TEAM = direct reports; self-approval is forbidden at any scope. |
| C5 | Web login composes the registry's login-05 block | Password field added (email+password auth), social buttons dropped — accounts are HR-created. Demo accounts listed on the page sign straight in. |
| C6 | Settings/roster/branding live in one client config context, persisted to localStorage | Editing the grace in Settings changes the punch screen immediately — the same wire /settings will drive. |
| C7 | White-label (name + logo ≤200 KB data URL) gated on config.manage at ALL | "Admin only" expressed as scope, not a role name; PUT /branding enforces the same. |

## 8. Punctuality crown

`apps/web/src/lib/analytics.ts`. The highest on-time share in the month is
crowned on the dashboard and badged on the employee's own screen.

Two deliberate choices: the award needs a **floor** (85%), so a bad month for
everyone crowns nobody rather than rewarding the least-bad; and the score is
share-of-days-within-grace, not earliest arrival — rewarding earliest arrival
just encourages people to sit in the car park.

## 9. Procurement (parallel module)

Vendors, items, purchase orders with delivery schedules, goods receipts (GRN)
and vendor analytics. Domain in `packages/shared/src/procurement.ts`; API
routes in `apps/api/src/procurement.ts`; web store mirrors those routes 1:1 in
`apps/web/src/lib/procurement.tsx` (localStorage until the Phase-3 wiring).

| # | Decision | Rationale |
|---|---|---|
| D1 | GRNs are append-only — a wrong receipt is corrected by a new GRN, never an UPDATE | A1's rule applied to material. The receipt trail is the evidence in any vendor dispute. |
| D2 | Receipt state (`PARTIALLY_RECEIVED` / `RECEIVED`) is derived from GRNs, never stored | A stored copy could disagree with the receipts it summarises. `poDisplayStatus()` is the only source. |
| D3 | Delivery schedules are per-line tranches; receipts allocate to tranches oldest-due-first in GRN date order | One `scheduleProgress()` implementation drives both the schedule badges and vendor on-time analytics — the % on the analytics screen is traceable to specific receipts. |
| D4 | Over-receipt is flagged, never blocked | §3's punch principle: the truck at the gate is a fact; whether to accept it is a review question. |
| D5 | GST rate and price are copied onto the PO line at order time; approval writes the agreed price back as the item default | History cannot be repriced by a later master edit (poor man's effective-dating until A5 lands), and the next PO opens at the last agreed rate. |
| D6 | The PO builder is type-on-the-template (OCC estimate design): the page IS the A4 document | Every value is edited where it prints, preview is the same sheet without affordances, and `window.print()` + an `@media print` block that isolates `.po-document` is the whole PDF pipeline. The sheet is deliberately untokened white — it is paper. |
| D7 | Excel exports are real `.xlsx` — typed cells, ₹ formats, SUM formulas; exceljs lazy-loads on click | The accountant verifies rather than trusts; the 250 KB library never loads until someone exports. |
| D8 | Creator ≠ approver, enforced in the API and mirrored in the UI | Raising and approving the same PO is never one person's job — same rule as attendance's CANNOT_DECIDE_OWN. |
| D9 | Procurement capabilities are four matrix rows (`procurement.manage`, `po.approve`, `grn.record`, `procurement.view`) | F11/F16 carry over: nav, buttons and routes gate on `can()`, and the Roles grid edits procurement access like everything else. |

## 10. Ecosystem architecture

This system grows into an ecosystem — estimates/quotations, invoicing,
inventory and more will land over time. The architecture is a **modular
monolith on TypeScript end-to-end**, decided 4 Aug 2026.

| # | Decision | Rationale |
|---|---|---|
| E1 | Stay on Node/TypeScript + Fastify; no backend language shift | The workload is DB-bound CRUD at tens of req/s peak — Fastify clears it by two orders of magnitude. The deciding factor is `packages/shared`: one implementation of every business rule serving the API, jobs and web previews only works with one language on both ends. A rewrite buys speed nobody needs at the cost of the drift-prevention the whole design is built on. |
| E2 | Modular monolith, not microservices | 1–2 person team; services multiply deploys, auth and failure modes for zero benefit at this scale. Module boundaries (E4) are the extraction insurance if one hot spot ever needs independent scaling. |
| E3 | A named **platform core** owns the cross-module primitives | Auth + RBAC matrix, the polymorphic approval engine (A7), document series (`PO-2026-0042` → `EST-`, `INV-`…), the type-on-template document sheet (D6), the Excel/print export layer, masters (items, vendors, customers), audit, settings resolution, money-in-paise. A new module consumes these; it never rebuilds them. |
| E4 | Every module is the same three thin layers | Pure domain in `packages/shared/src/<module>.ts` (worked-example tests), routes in `apps/api/src/<module>.ts`, screens + provider in `apps/web`, one nav group, capabilities as matrix rows. Modules never import each other's internals — they meet through the platform core and ids only. Attendance and procurement already conform; this is now the rule, not a coincidence. |
| E5 | One Postgres; each module owns its tables; `company_id` on all (A9) | Cross-module truth stays in one transactional store. Schema ownership per module keeps the extraction path (E2) honest. |
| E6 | CPU-heavy work never runs on the request thread | Image derivatives, big exports, nightly computation → BullMQ workers on Redis. This, plus Postgres constraints (A8-style), is what actually keeps an ERP fast and correct — not the language. |
| E7 | Language shift is reconsidered only on evidence | Sustained multi-thousand req/s, heavy request-path compute, or massive real-time fan-out — none plausible for this domain. If it happens, extract the one hot module behind the existing route boundary. |

Next modules ride the core: the **estimate creator** is customers (≈ vendors
master) + `salePricePaise` on items + an Estimate document sheet (the PO sheet's
skeleton) + the same draft → approve → fulfil lifecycle with derived statuses
and append-only fulfilment — mostly assembly, not construction.

## 11. Production hardening (8 Aug 2026)

A six-dimension audit (security, robustness, performance, responsiveness, operations, feature gaps) with adversarial verification of every P0/P1 drove this batch. Decisions worth keeping:

| # | Decision | Why |
|---|---|---|
| H1 | **Production refuses to boot without a strong `JWT_ACCESS_SECRET`** (≥32 chars) | The fallback `"dev-only-secret-change-me"` is in the repo, so a deploy that forgot the env var would let anyone mint an ADMIN token. A crash at startup is loud and fixable; a silent default is neither. Development keeps the fallback. |
| H2 | CORS is an **explicit allowlist** from `CORS_ORIGINS`, never `origin: true` | Reflecting the caller's Origin alongside `credentials: true` is allow-all in everything but name. Requests with no Origin (curl, same-origin, native) still pass — they are not a CORS case. |
| H3 | Cookies gain `Secure` in production only | localhost is plain HTTP; a Secure cookie there is simply never stored, which would break local development for no gain. |
| H4 | **Password change and admin reset routes exist** | Before this, the four seeded logins were permanent and their passwords are published in the repo — there was no mechanism at all to rotate them. bcrypt cost 12 for real changes (the seed's cost 4 is a test-speed decision). |
| H5 | The JSON store writes **temp-file + rename**, and a corrupt file **stops the API** | `rename(2)` is atomic, so a crash mid-write leaves the last good file. Silently reseeding a corrupt file would replace live business data with demo rows and still look like a healthy boot; instead the file is quarantined with a timestamp and the process refuses to start. |
| H6 | Leave balance is re-checked **at approval**, not only at apply | Two requests can each pass the apply-time check and both be approved. The resulting debit drives the ledger negative, and `reduceLedger` throws on negative — which would 500 that employee's balance and apply routes permanently. |
| H7 | Receipt allocations are validated against the **ledger**, not the request | The old cap was computed from the client's own allocation array, so any fabricated figure passed. Manual allocation stays (it is a real need); every line is now checked against a real open invoice for that party, capped at its outstanding, and required to sum to the receipt. |
| H8 | Route-level `React.lazy` for every screen except the dashboard and punch kiosk | 35 static route imports produced a 1.6MB entry chunk; it is now 301KB (92KB gzipped). recharts and exceljs are separate chunks and excluded from PWA precache — a phone that never exports a workbook never downloads one. |
| H9 | The API ships a real build (`tsup` → `dist`), and the web build **fails** without `VITE_API_URL` | `tsx` is a dev dependency and a runtime transpiler. A production bundle that baked `localhost:3000` cannot reach its backend from any device but the build machine, and the symptom — every screen falling back to demo data — looks like working software. |
| H10 | Bottom nav runs to 767px, matching where the sidebar becomes off-canvas | At 640–767 (iPad mini portrait) there was neither a bottom bar nor a visible rail. The sweep now covers 1440 / 1280 / 820 / 390 so this class of gap fails CI rather than shipping. |

## 12. Tally integration (8 Aug 2026)

| # | Decision | Why |
|---|---|---|
| T1 | Vouchers are built **server-side** and downloaded as XML; nothing is pushed into Tally automatically | Tally is the accountant's system of record. A tool that wrote into it unattended would be the first suspect for every discrepancy; an importable file keeps the accountant in the loop. |
| T2 | **Masters are never created by us** — ledger and company names are typed in Settings and must match Tally exactly | Creating masters programmatically produces duplicates with subtly different names, which is worse than a failed import. The Settings screen previews the exact posting, and the Guide covers creating the ledgers and the three failures that actually happen. |
| T3 | An **unbalanced voucher is refused**, not written | Debit ≠ credit corrupts books silently downstream. `buildTallyVoucherXml` throws; the route answers 422 with the reason. Zero-gross employees are skipped, since a zero AMOUNT line makes Tally reject the whole file. |
| T4 | Tally's sign convention is encoded once: debit = `ISDEEMEDPOSITIVE=Yes` with a **negative** amount | It is counter-intuitive and getting it wrong reverses the entry. One helper, nine tests. |
| T5 | Bank details sit behind `payroll.manage`, are masked (`****7890`) in every read, and the audit log stores only the masked tail | They gate money, so they are payroll data rather than employee data; an append-only log is the last place a full account number belongs. |
| T6 | The transfer sheet **holds people back with a reason** rather than dropping them | A missing account is a person who will not be paid. Everyone appears in either the payable file or the held list, and the count travels in a response header so the UI can warn before the file is uploaded. |

## 13. Attendance regularisation (8 Aug 2026)

| # | Decision | Why |
|---|---|---|
| R1 | An approved regularisation **appends punches; it never edits or deletes one** | The register recomputes from punches, so the corrected day falls out automatically, and what the device actually recorded survives beside the correction. That pair is the entire value of the audit trail when someone disputes a payslip months later. Corrections carry the `REGULARISED` flag, which no device can write. |
| R2 | Raising a request changes nothing; **approval is the only thing that writes** | Otherwise the employee edits their own attendance, and the approval step is theatre. Nobody may decide their own request, as with every other approval kind. |
| R3 | Idempotency keys are **deterministic** (`reg_<approvalId>_<IN\|OUT>`) | A replayed or retried decision cannot double-write punches and silently double the day's worked hours. |
| R4 | Refused for a **locked month** (409) and a **future date** (422) | A locked month has been paid; correcting it is an adjustment run, not a silent rewrite of a closed period. A future day has nothing to correct. |
| R5 | One **pending request per employee per day** | Two open corrections for the same day would both apply on approval and double the hours. |
| R6 | The note is **required** (min 5 chars) and the request carries `inTime`/`outTime`, not a free-text description | A manager cannot judge "please fix Tuesday". Structured times are also what the approval replays into punches, so there is nothing to re-interpret. |

## 14. Overtime is paid only when approved (8 Aug 2026)

| # | Decision | Why |
|---|---|---|
| O1 | The day records **eligible** overtime; payroll pays **approved** overtime | The `OVERTIME` approval kind existed but nothing ever created or consumed it, so the documented claim path was decorative and staying late silently became money. The register still shows what was worked — that is a fact about the day, not a payment decision. |
| O2 | `otRequiresApproval` (default **on**) keeps the rule dynamic | A company that wants auto-pay flips one switch in Settings and gets the old behaviour, tested. |
| O3 | Payroll pays `min(approvedMinutes, eligibleMinutes)` | An approval cannot conjure hours that were never worked, even if someone edits the request. The engine's computation from real punches is the ceiling. |
| O4 | A claim **cannot state its own amount** — the server re-derives minutes from punches | The approval decision is then only ever "yes, pay this", never "how much?", which is the question a manager has no way to audit. |
| O5 | Claims are refused for a day with no overtime, a future date, a locked month, and a second time | Same guards as regularisation, for the same reasons: nothing to claim, nothing has happened, the period is paid, and a duplicate would double the money. |

## 15. Comp-off (8 Aug 2026)

| # | Decision | Why |
|---|---|---|
| C1 | A credit is earned by **working a weekly off or a holiday**, and the amount comes from the same hour thresholds a normal day uses | "A full day is a full day" then means one thing across the system. Below `halfDayMinHours` earns nothing — a token appearance is not a day. |
| C2 | The claim states the **date, never the amount** — the server derives the credit from punches | Same rule as overtime: the approver answers "yes, give this back", not "how much?", which is a question they cannot audit. |
| C3 | The ledger entry is dated **the day that was worked**, not the day it was approved | Expiry counts from there, so a credit is worth exactly what the employee gave up. Approving late does not quietly extend it. |
| C4 | Credits **expire** after `compOffExpiryDays` (default 90), swept nightly | A credit that never expires is a liability that grows forever, and a balance that includes unusable days is a lie. |
| C5 | Consumption is **oldest-first (FIFO)** | A debit always burns the credit closest to expiring — the arrangement that loses the employee the least. Expiring the wrong lot silently costs someone a day off. |
| C6 | Expiry writes a negative `ADJUST` row that the next sweep counts as consumption | Makes the sweep idempotent: re-running never expires the same credit twice, which matters because the nightly job re-examines a 7-day window. |
| C7 | Spending goes through the **existing leave path** (`type: "COMP_OFF"`) | The balance guard, the approval routing and the ledger debit already work and are tested; a parallel spend path would be a second place for them to drift. |

## 16. Notifications and escalation (8 Aug 2026)

| # | Decision | Why |
|---|---|---|
| N1 | **In-app only**, and the gap is stated rather than faked | Email and WhatsApp need SMTP/provider credentials the company has not supplied. A delivery channel that silently drops messages is worse than one that visibly does not exist yet. The feed is the durable record; a channel adapter can read from it later. |
| N2 | A feed belongs to **one person** and there is no route that reads another's | Notifications quote leave reasons and decision remarks. Scoping at the route, not the client, is what makes that safe. |
| N3 | Requests route to the **reporting manager**, falling back to everyone who approves company-wide | Without the fallback a request from someone with no manager lands in nobody's feed — invisible, forever. |
| N4 | The requester is **not** notified of their own request | A feed that tells you what you just did trains people to ignore it. |
| N5 | Escalation is a **state change, not a decision** — L2 still needs someone to act, unless `autoApproveOnEscalation` is on | `approvalEscalateAfterDays` and `autoApproveOnEscalation` were configurable from the first commit and had **never fired**: a manager on leave silently stalled every request routed to them. |
| N6 | The sweep is **idempotent** — a request already at L2 is skipped | It runs hourly; without that guard the same request would escalate and re-notify every hour. |
| N7 | Feeds are capped at 100 entries per person | An uncapped feed eventually becomes the largest thing in the store, and nobody reads a two-year-old notification. |
| N8 | One notifier (`makeNotifier`) shared by routes and the nightly sweep | Two copies would be two places for the cap and the shape to drift, and the sweep's notices are the ones nobody is watching when they break. |
| N9 | The bell **polls every 60s** rather than opening a websocket | A websocket for a handful of approval notices is infrastructure this system does not need, and 60 seconds is well inside how fast anyone acts on one. It is hidden entirely in a demo session — a bell that can never fill is chrome that teaches people to ignore bells. |

## 17. Grid cost and failure honesty (8 Aug 2026)

| # | Decision | Why |
|---|---|---|
| G1 | The roster grid mounts a tooltip **only for the cell under the cursor** | A Radix Tooltip per cell meant 930 mounted trigger components at seed scale and roughly 15,000 at 500 employees. Measured before and after: 930 → 0 at rest, with hover behaviour unchanged (verified in a real browser, not assumed). |
| G2 | Hover state lives on the **row**, which is memoised | Moving across a row re-renders 31 cells instead of the whole grid. Putting the state on the page would have traded one cost for another. |
| G3 | The badge keeps `tabIndex` with focus handlers | Mounting on hover alone would have made the tooltip unreachable by keyboard — a perf fix that quietly removes access is not a fix. |
| G4 | Export **queues first, registers second**, and a queue failure answers 503 | The other order left a permanently QUEUED ghost job whenever Redis was unreachable: the row existed, nothing would ever pick it up, and the caller got a raw 500 with no way to tell "queued" from "lost". |
| G5 | `PUT /permissions` **merges** over the current matrix and drops unknown keys | A body that omitted a permission used to erase it, and routes indexing it directly then threw on every request — a save from a stale browser tab could take the approvals path down. The matrix is a closed vocabulary, not a bag. |
| G6 | A matrix that leaves nobody with `config.manage: ALL` is **refused** (422) | Otherwise an admin can lock the company out of its own permission matrix permanently, with no route back short of editing the store by hand. |

## 18. Dates that do not exist (8 Aug 2026)

| # | Decision | Why |
|---|---|---|
| D10 | One `isoDateSchema` across every route, replacing 20 copies of `\d{4}-\d{2}-\d{2}` | The regex is a *shape* check, not a validity check. It accepted `2026-02-31`, which JavaScript silently rolls forward to 3 March, and `2026-13-45`, which becomes an Invalid Date whose arithmetic yields NaN. Both reached money and attendance maths and would have surfaced as a wrong number on an invoice rather than an error. |
| D11 | `isoMonthSchema` for payroll months | `\d{4}-\d{2}` accepted **month 13**, so a lock could be taken on a month no run could ever sensibly match. Found by a test written for the date fix, not by the audit. |
| D12 | The refusal message names the problem ("Use a real calendar date in YYYY-MM-DD form") | A bare "Invalid input" on a date field sends people hunting through a form for something that looks fine. |
| D13 | Leap years are handled by `Date.UTC(year, month, 0)`, not a table | Day 0 of the next month is the last day of this one. 2024-02-29 is accepted, 2026-02-29 is not, with no leap-year rule written out anywhere to drift. |

## 19. Broken references fail by name (8 Aug 2026)

Eleven non-null assertions on store lookups sat in request paths. Each was an unhandled 500 whose message named nothing — the hardest class of production incident to diagnose. All are gone, and what replaces each one depends on whose problem it is.

| # | Decision | Why |
|---|---|---|
| E1 | A dangling `shiftId`/`branchId` on a punch answers **409 with the offending id** | It is broken data, not a bad request. The response tells whoever is on call exactly what to fix. |
| E2 | A valid token naming an employee who no longer exists answers **401 EMPLOYEE_GONE** | A 30-day refresh token outlives a data restore, so this is an expired session rather than a server fault — and the client already knows how to handle a 401. |
| E3 | Deciding an approval whose employee was removed answers **409**, not 500 | The approval is orphaned; saying so is actionable. |
| E4 | The **daily register degrades** — a broken row renders as "Shift missing" | One employee's bad reference used to take the whole day's view down for everybody. |
| E5 | **Payroll and the export throw, naming the employee** | Skipping silently would leave someone out of a pay run with no trace, which is worse than a failed run. The message carries the code and name, so the fix is obvious. |

The rule this encodes: degrade where a reader just wants the rest of the data, and refuse loudly where money is involved.

## 20. Measured, then fixed (8 Aug 2026)

| # | Decision | Why |
|---|---|---|
| M1 | The "providers write to localStorage on every state change" P2 was **measured and closed with no code** | A Playwright probe counting `setItem` calls found **zero writes during SPA navigation** and exactly one ~2.3KB write per real state change, with no redundant writes. Persisting a change is the point; there was no churn to remove. Recorded here so nobody re-opens it on the strength of the original claim. |
| M2 | `seedAttendanceDays` is **cached per date** | The seed is deterministic, so a fresh array per call was waste — and worse, a new identity every render, which defeats every downstream `useMemo` and effect dependency in demo mode. Asserted with `toBe`, not `toEqual`: identity is the thing being fixed. |
| M3 | `approval_actions` is finally written, and read back on boot | The schema calls that table the turnaround report, and **nothing ever wrote to it**. Who approved a request and why vanished on restart, leaving approved requests with no approver. `level` now persists too, so an escalation is not silently undone by a restart. |
| M4 | `POST /indents/:id/mark-ordered` gained a schema and a reference check | It was the one write path with no validation at all — the body was cast, so any shape passed. A `poId` naming no purchase order is refused: an indent that reads as fulfilled but points nowhere is worse than one with no link. |

Note on M4: the existing test passed `poId: "po_x"`, a fake id, and started failing once the guard landed. The test was updated to match corrected behaviour — the guard was not weakened to keep a green suite.

## 21. Roles get their own product (8 Aug 2026)

Found by signing in as an employee and using the app, rather than from the audit.

| # | Decision | Why |
|---|---|---|
| S1 | Privileged **routes** are gated, not just nav entries | The sidebar hid what a role could not use, but the routes were open: typing `/payroll` as an employee rendered the whole screen, whose hooks then fired requests the API correctly refused — a working-looking page of empty tables and a console of 403s. Measured before: two 403s on load. After: none. |
| S2 | The guard uses the **same `can()` rule the nav uses** | Nav and route agree by construction, so a permission change cannot leave one open and the other hidden. The API remains the authority; this only stops the client asking questions it already knows the answer to. |
| S3 | Refusal names the missing permission and offers a way back | "Not available to you · needs `payroll.manage`" is actionable. A blank screen or a redirect loop is not. |
| S4 | An employee lands on **Your day**, not the company dashboard | Headcount by department, overtime by department and approval turnaround are management questions. An employee opens the app to ask three things: am I punched in, how much leave do I have, what happened to my request. |
| S5 | The split keys on **scope, not capability** | Every role holds `reports.view`; an employee holds it at `SELF`. Gating on the capability put employees straight back on the company dashboard — caught by re-probing rather than assumed. `SELF`/`NONE` reach → their own day. |

Note: three browser tests waited on an h1 of "Dashboard" and one asserted an employee could see `/approvals`. Both assumptions were the *old* behaviour. The waits are now role-agnostic and the regularisation test verifies the request reaching the approver's inbox — the truthful end state — rather than a screen the employee should never have seen.

## 22. An approval means one thing (8 Aug 2026)

Found by auditing this session's own new code rather than waiting for it to fail in production.

**The defect:** `escalateStaleApprovals` implemented auto-approval as `status = "APPROVED"` and nothing else. Every consequence of an approval lived inside the decide route, so an auto-approved request performed **none** of them — leave was granted without debiting the ledger (a free day, and a balance wrong forever), comp-off was approved without crediting anything, and a regularisation was approved without writing the punches that are its entire purpose. It also skipped the balance re-check, so an auto-approval could drive the ledger negative, which `reduceLedger` refuses — permanently 500ing that employee's balance and apply routes.

`autoApproveOnEscalation` defaults to off, which is the only reason this had limited blast radius.

| # | Decision | Why |
|---|---|---|
| A11 | `canApplyApproval` and `applyApproval` in `approve.ts` are the **single implementation**, used by the decide route and the escalation sweep | An approval must mean the same thing however it was reached. Two copies of "what approving does" is how one of them silently loses a ledger write. |
| A12 | The gate is **separate from the write** | A caller refuses *before* flipping the status. Half-applied approvals are how ledgers become inconsistent. |
| A13 | An auto-approval that cannot be applied leaves the request **PENDING at L2** and notifies the employee why | Silently approving something the ledger cannot absorb is worse than leaving it for a person. The sweep escalates; it does not force. |

## 4. Open items

- **Statutory payroll** (PF/ESI/PT/TDS) still deferred per the 4 Aug decision. The payslip prints gross = net and says so explicitly rather than inventing deduction lines.
- Attendance regularization requests, notifications/escalation delivery, and comp-off earn/spend remain the top-ranked feature gaps from the 8 Aug audit.
- Server-side face re-verification (A10) awaiting confirmation. If dropped, the §3 anti-spoof wording should be softened to "capture quality check".
