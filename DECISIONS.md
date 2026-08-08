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
| F16 | Nav and command palette filter on `can(permission)`, never on role | `lib/session.tsx` resolves capability → scope through the matrix. Roles & Permissions requires `config.manage`, which only Admin holds at `ALL`, so it disappears for everyone else without a single role comparison. The sidebar role switcher exists to prove this until Phase 1 auth lands. |
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

## 4. Open items

- **Statutory payroll** (PF/ESI/PT/TDS) still deferred per the 4 Aug decision. The payslip prints gross = net and says so explicitly rather than inventing deduction lines.
- Attendance regularization requests, notifications/escalation delivery, and comp-off earn/spend remain the top-ranked feature gaps from the 8 Aug audit.
- Server-side face re-verification (A10) awaiting confirmation. If dropped, the §3 anti-spoof wording should be softened to "capture quality check".
