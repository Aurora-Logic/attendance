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
| F15 | KPI tiles appear only on Dashboard and Reports | Stat tiles on every screen turn a working surface into a report. Operational screens show the work; the two analysis screens show the numbers. |
| F16 | Nav and command palette filter on `can(permission)`, never on role | `lib/session.tsx` resolves capability → scope through the matrix. Roles & Permissions requires `config.manage`, which only Admin holds at `ALL`, so it disappears for everyone else without a single role comparison. The sidebar role switcher exists to prove this until Phase 1 auth lands. |
| F17 | Scrollbars are thin with a transparent track | The shell nests several scroll regions; opaque OS bars stack chrome on chrome. Thumb is `--muted-foreground` at 28%, inset by a transparent border so it floats in the gutter. |

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

## 7. Backend shape (Phase 1, first cut)

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

## 4. Open items

- **Phase 7b** (PF/ESI/PT/TDS, payslip PDF, bank upload) deferred until after Phase 8, per decision on 4 Aug 2026. Schema tables are created in Phase 1 and left empty so no migration is needed later.
- Server-side face re-verification (A10) awaiting confirmation. If dropped, the §3 anti-spoof wording should be softened to "capture quality check".
