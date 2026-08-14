# 07 — Launch plan: pilot on 15 August 2026

This document is written to be given to Claude Code. Each workstream ends in a
paste-ready prompt. Read `CLAUDE.md` first; it overrides everything here.

Status source: the phase-by-phase audit of 14 Aug 2026 (all 1,327 tests green,
typecheck and lint clean). Overall the build is roughly two-thirds done —
what remains is concentrated in reports, notifications UI, regularization,
and the entire deployment column.

---

## Progress — 14 Aug 2026, evening

Five branches merged to main. Gates on the merged result: typecheck 0 errors,
lint 0 warnings, **1,369 tests passing** (25 shared, 133 web, 1,211 api),
production build clean.

| Workstream | State |
|---|---|
| WS-A deployment rail | **Done.** Prod compose, Caddyfile with TLS + security headers, trust proxy (spoof rejected live), backup + **rehearsed restore** (46 tables, row counts matched), runbook, `.env.production.example`. Sentry deferred (§2 row 13 unanswered); off-site backup copy waits on R2 credentials. |
| WS-B product blockers | **Done.** Consent recording (migration 0012), photo retention stamping, leave approve/reject UI with inline day recompute — an approved leave now reaches the muster. |
| WS-C security gate | **Ran, said DO NOT DEPLOY, two blockers fixed.** (1) Consent was client-side only — the API stored photo punches with no acceptance row, proven live; now enforced inside the punch transaction (422 `CONSENT_REQUIRED` without it), including the offline sync path, with notice version and quoted retention recorded (migration 0013). (2) `POST /auth/password-resets` had no rate limit at any layer — 60 requests delivered 43 real emails; now capped 3/address/hour, still answering 202 so enumeration stays blind. Four further findings closed: `STORAGE_ORIGIN` made required (empty shipped a CSP that silently blocked **every** punch photo), root `.dockerignore`, Redis `--requirepass`, photo-retention floor raised to 3 months (a 1-month floor could purge a photo while its punch was still disputable). 71 controls verified working. |
| Smoothness pass (unplanned) | **Done**, under `emil-design-eng` + `thumb-reach`. Zero layout shift on punch / My Attendance / My Leave (skeletons rebuilt to measured content metrics), 44px password reveal, camera preview eases in, bottom-nav tabs uniform, PWA metadata warning gone. Every change measured at 360px and 1440px in both themes. |
| Bug hunt + fixes (unplanned) | **Done.** A CDP hunt over the day-one flows found one launch-blocker crash (two hooks cached different shapes under one query key, reliably killing Team Attendance after Employees) plus five bugs; all fixed, and a new scan test now fails the build on any duplicate query key — it caught a second latent collision on the way in. Also fixed: an offline reload hid the queued punch behind an unusable sign-in form; one wrong password burned two of five lockout attempts. |
| WS-D data load and onboarding | **Blocked on §2 inputs.** Nothing loaded yet. |
| WS-E final verify | Pending WS-D. |
| WS-F charts and insights | Not started (launch-week, not go/no-go). |

**The critical path is now entirely §2** — DNS pointed at the VPS, SMTP, R2-or-MinIO, geofence coordinates, shift timings, roster, leave types with opening balances, holidays. No code work blocks the pilot.

---

## 0. The honest verdict

**A full launch tomorrow is not possible.** Eleven of thirteen reports,
Payroll Input, XLSX export, the notifications UI, regularization, and the
whole deployment rail do not exist, and the leave/approvals join is
explicitly parked as work that needs a human watching.

**A limited pilot tomorrow is possible** if three things happen today:

1. The inputs in §2 are supplied (nothing in code can substitute for them).
2. The deployment rail (WS-A) and the two product blockers (WS-B) land.
3. The security gate (WS-C) passes with no finding on the punch/photo path.
   This gate can say no. If it does, the launch moves, not the gate.
4. The production data load and onboarding (WS-D) happens before employees
   arrive — a booted, secure, **empty** system is still a failed launch.

**Pilot scope — what employees get on day one:** sign-in by invitation,
punch **from phones** with photo/geofence/offline queue (desktop web punch
is blocked regardless of the IP allowlist by the front-camera constraint —
`facingMode: exact` rejects webcams that report no facing mode, P1-5; it
stays out of the pilot unless §2 row 12 is decided), My Attendance, Team
Attendance,
shifts and rosters, holidays, leave application with balances plus a minimal
approve/reject path, employee and master admin, settings, audit log, period
lock, the two live reports (Attendance Register, Punch Audit) with CSV export
and the Downloads tray.

**Explicitly not in the pilot** (say so to the client in writing): the other
11 reports, Payroll Input and month-end export, XLSX formatting,
notifications (bell, emails beyond invites/resets), regularization and
on-duty, comp-off UI, approval delegation UI, team leave calendar, restricted
holiday election, TOTP, the calculator, and desktop web punch (P1-5). The
first locked month is more than two weeks away — that is the real deadline
for Payroll Input, not tomorrow.

## 1. How to run this plan in Claude Code

- **Model: Claude Fable 5** (`claude-fable-5`). It is the most capable tier
  Anthropic ships — above Opus — and both it and Opus 5 are stable
  production models; the difference is capability, not stability. Use Fable 5
  for everything in this plan that touches security, the deploy rail, or the
  leave/approvals join. Opus 5 is acceptable for mechanical UI wiring and
  copy changes if cost matters; Fast mode (`/fast`) runs on Opus for quicker
  output. Do not switch models mid-workstream.
- Work one workstream per session, in order: A, B, C, D, then E. F (charts)
  can run in a parallel session; it is not a go/no-go item.
- **Every UI task in every workstream must load `/emil-design-eng` and
  `/thumb-reach` before writing UI code, and `/apple-design` for layout per
  CLAUDE.md §5.** This is a standing instruction across this whole plan.
- Project skills now exist and are the gates: `/vyuha-verify` (quality
  gates), `/vyuha-security` (pre-deploy security), `/vyuha-structure`
  (structure and constitution review), `/vyuha-charts` (all chart work).
  Every workstream ends by running `/vyuha-verify`; the plan ends by running
  `/vyuha-security`.
- Commit at each working increment with REQ IDs. Do not push unless asked.

## 2. Inputs only Virag can supply — needed TODAY

Code cannot proceed past placeholders without these (`05-decisions.md` §Still
open, `OPEN-QUESTIONS.md` carried items):

| # | Input | Without it |
|---|---|---|
| 1 | Office Google Maps link / coordinates for the geofence centre | Mobile punch geofencing stays disabled |
| 2 | General shift timings — in, out, break | The seeded placeholder shift reaches production |
| 3 | Office IP address(es) | Web (desktop) punch stays blocked |
| 4 | Real leave types: entitlement, carry-forward cap, negative limit, notice days | Placeholder seed types reach production |
| 5 | This year's holiday list | Empty calendar; every working day computes as a working day |
| 6 | Production host + domain name, and DNS pointed at it | No TLS, no deploy |
| 7 | Cloudflare R2 credentials (or the word "MinIO on the VPS instead") | No photo storage in production |
| 8 | SMTP credentials for real mail | Invitations cannot be delivered; nobody can sign in |
| 9 | Decision: icons — amend docs to phosphor (recommended, two-line change) or sweep back to lucide | The constitution and the codebase keep contradicting each other |
| 10 | Decision: refresh-token rotation tolerance ~10s (recommended) or leave the two-tab logout as is | Two tabs / a restored window log the user out of everything |
| 11 | Acknowledgement in writing that the pilot excludes the §0 list | Scope disputes at month-end |
| 12 | Decision: desktop web punch — keep phone-only for the pilot (recommended), or approve the P1-5 camera fallback (keep `exact` on touch devices, accept any camera on single-camera devices) | Desktop punch stays blocked even with the IP allowlist populated |
| 13 | Decision: approve `@sentry/node` as a new dependency, or defer error tracking | CLAUDE.md forbids adding a dependency unasked; without the word, Sentry is deferred and recorded in OPEN-QUESTIONS |
| 14 | Opening leave balances per employee as of 15 Aug | The monthly accrual job runs on the 1st and cannot reconstruct April–August history; balances start wrong |
| 15 | The pilot employee roster (names, emails, departments, designations) in the bulk-import format | Nobody to invite; an empty muster on day one |

## 3. Workstreams

### WS-A — Deployment rail (~1 session, Fable 5)

Nothing here exists today: no Caddyfile, no production compose, no backups,
no runbook; SENTRY_DSN is validated by the env schema but no SDK is
installed.

Deliverables: production `docker-compose.prod.yml` (api built image, web
static build served by Caddy, Postgres with a named volume, Redis, no
Mailpit); `Caddyfile` with TLS, security headers, and reverse proxy to the
api; **`trust proxy` set to the exact hop count in `apps/api/src/main.ts`**
(OPEN-QUESTIONS P0-11 — behind Caddy, `req.ip` is spoofable without it and
the per-IP login limit becomes a fiction); nightly `pg_dump` backup script
plus a **rehearsed restore into a scratch database** (NFR-08 — a backup that
has never been restored is a hope, not a backup); a one-page
`docs/RUNBOOK.md` (start, stop, logs, backup, restore, job monitor via
`GET /jobs`); Sentry wired to the existing env slot **only if §2 row 13
approves the `@sentry/node` dependency** — otherwise deferred and recorded
in OPEN-QUESTIONS. No other new dependency is authorised by this
workstream.

Prompt:

```
Read CLAUDE.md and docs/07-launch-plan.md §WS-A. Build the deployment rail:
production compose, Caddyfile with TLS and security headers, trust proxy hop
count in main.ts, nightly pg_dump backup script with a rehearsed restore
(actually run the restore into a scratch DB and show the row counts), a
one-page docs/RUNBOOK.md, and Sentry ONLY if launch-plan §2 row 13 approved
the @sentry/node dependency (CLAUDE.md forbids adding one unasked; if
unanswered, defer it and record that in OPEN-QUESTIONS). Verify against the
running thing: boot the prod compose locally, sign in through Caddy, then
punch once VIA THE API (multipart POST with a test image - the browser
camera path cannot run headless, see OPEN-QUESTIONS P1-5; the real-camera
punch is WS-E's phone check), and confirm the photo lands in object storage
and the audit row is written. Then run /vyuha-verify and /vyuha-security.
Commit at each working increment.
```

### WS-B — Product launch blockers (~1 session, Fable 5)

Two items, both small, both genuinely blocking:

1. **Consent recording (REQ-M-03 / P1-4).** The notice gates the punch but
   nothing stores acceptance, and punch photos never get `files.expires_at`,
   so the 12-month retention (REQ-L-03) is unenforced. Record acceptance
   server-side once per user — this needs a **new consent-acceptance table
   and a reversible migration** (nothing in the API stores consent today);
   the retention half needs **no migration**, the `expires_at` column and
   its index already exist in `0001_platform_tables.sql` — stamp it from
   the retention setting so the purge job starts selecting punch photos.
   Privacy promises the UI already makes must be true before real employees
   punch.
2. **Minimal leave decision UI (REQ-G-09 subset).** `POST
   /leave/requests/:id/approve|reject` exist and are tested, but no screen
   calls them — an approver cannot decide leave through the product at all.
   Add approve/reject with a reason to the manager's view of leave requests,
   calling the existing endpoints. On approval/cancellation, recompute the
   affected attendance days via the existing `DayEngineService.computeDay`
   (the same inline pattern `holiday.service.ts` uses) so approved leave
   actually reaches the muster. Be aware this **reverses a documented
   in-code decision**: `leave.service.ts:746` deliberately skips the inline
   recompute, resting on a nightly day-engine sweep that was never built
   (`SCHEDULED_JOBS` has no such job) — the reversal is intentional, do not
   stall on the comment; replace it when the recompute lands. **Do NOT
   build the approvals-framework join here** — `OPEN-QUESTIONS.md` ("The leave / approvals join, still
   unwired") explains why that is supervised work; it stays in week 1 with
   Virag watching.

Prompt:

```
Read CLAUDE.md, docs/07-launch-plan.md §WS-B, and the P1-4 and leave/approvals
sections of docs/OPEN-QUESTIONS.md. Implement (1) server-side consent
recording (new consent-acceptance table, reversible migration) plus
expires_at stamping on punch photos from the retention setting (no migration
needed - the column and index exist in 0001), and (2) a minimal leave
approve/reject UI on the existing /leave/requests/:id/approve|reject
endpoints, with day recomputation on approve and cancel following the inline
pattern in holiday.service.ts. The comment at leave.service.ts:746 documents
the opposite choice, resting on a nightly sweep that does not exist - that
decision is reversed here deliberately; replace the comment. Do not
touch the approvals framework or write to the ledger from any new path. Load
/emil-design-eng, /thumb-reach and /apple-design before any UI work. Full
Definition of Done per CLAUDE.md §4 including integration tests. Finish with
/vyuha-verify and /vyuha-structure. Commit with REQ IDs.
```

### WS-C — Security gate (go/no-go, Fable 5)

Run `/vyuha-security` (which itself runs `/security-review`) across the
branch. The Phase 1 exit gate was never recorded, so this is the first full
pass — expect findings. Any finding on the punch, photo, or auth path blocks
launch; fix and re-run. The gate's verdict is final: if it says DO NOT
DEPLOY, the pilot date moves.

Prompt:

```
Run /vyuha-security on the current branch. Fix every finding it marks as a
deploy blocker (punch/photo/auth path), re-run until the verdict is DEPLOY,
and report what was found and fixed, with file:line. Never weaken a check to
get there.
```

### WS-D — Production data load and onboarding (~half a session, Virag + Claude Code together)

A booted, secure, empty system is still a failed launch — this workstream
turns the §2 inputs into production state and gets the workforce in. It runs
after WS-A boots production; Virag drives (the inputs and the people are
theirs), Claude Code assists through the product's own endpoints.

- Location row carrying the geofence centre (§2 row 1) and the IP allowlist
  (row 3).
- General shift updated with real timings (row 2); weekly-off pattern set;
  a roster assigned to every pilot employee via the existing bulk endpoint.
  The seeded placeholder shift must not survive into day one.
- Real leave types (row 4); opening balances loaded via the existing
  `POST /leave/balances/adjust` (row 14) — the monthly accrual job runs on
  the 1st and cannot reconstruct April–August history.
- Holiday calendar imported (row 5) via the existing import endpoints.
- Employee roster imported via `POST /employees/import/validate` + `commit`
  (row 15). Note: this is API-only — there is no import screen yet — so it
  runs as a scripted call; do not build UI in this workstream.
- **The administrator's own login joined to their employee record.** REQ-B-02
  keeps the login and the person as separate rows, and a login with no person
  attached is refused by `/punch` ("this sign-in is not linked to an employee
  record") and by `GET /leave/balances`. An administrator who skips this
  discovers it at the punch screen on day one, in front of employees. The
  seed now joins `admin@vyuha.local` to VY-0001 so a development database is
  punchable out of the box, but VY-0001 is a fabricated person — on production
  the administrator's login must point at **their own** row from the roster
  import above, not at the seeded one. Verify by punching once as that account
  and by opening My Leave.
- Invitations sent to every pilot user over real SMTP (row 8), delivery
  confirmed.
- A one-page employee comms note: what is collected (photo, location), why,
  the retention period, how to install the PWA, and the camera/location
  permission prompts to expect. The delivery plan's own risk table names
  "communicate before rollout" as the adoption mitigation for photo and
  location capture — this note is that mitigation.

Prompt:

```
Read docs/07-launch-plan.md §WS-D. With Virag supplying the §2 inputs, load
production through the existing endpoints: location with geofence centre and
IP allowlist, real shift timings plus weekly-off pattern plus rosters for
every pilot employee (bulk endpoints), real leave types with opening-balance
adjustments via /leave/balances/adjust, holiday import, and the employee
roster via /employees/import/validate then /commit (API-only, scripted - no
new UI). Point the administrator's own login at their real employee row from
that import, not at the seeded VY-0001, and prove it by punching once and
opening My Leave as that account - a login with no employee record is refused
by /punch and by GET /leave/balances. Assert nothing placeholder remains: the
seeded General shift and seed leave types must be updated or replaced. Send
all invitations over real
SMTP and verify delivery in the mail log. Draft the one-page employee comms
note (photo and location collection, retention, PWA install, permission
prompts). Everything through the product's own audited endpoints - no direct
SQL.
```

### WS-F — Charts and insights (parallel session; launch-week, not go/no-go)

Dashboard and the employee detail page get more charts and, more
importantly, computed insight sentences. All of this goes through
`/vyuha-charts`, which mandates the `dataviz` skill, the shadcn MCP chart
primitive, the series/charts split with tests, and the `/emil-design-eng` +
`/thumb-reach` passes.

Dashboard (REQ-K-01 — closes part of the audited gap):
- Employee: leave balance donut per type with "N days expire on carry-forward
  cap" insight; punctuality trend (arrival deviation vs shift start);
  worked-hours vs expected bar with the delta as the insight.
- Operations/HR/Admin (permission-gated, server-scoped): late-arrivals trend
  with weekday breakdown insight ("9 of 11 lates were Mondays"); absence
  heat strip for the period; pending leave requests count linking to the new
  WS-B decision UI; flagged-punch count linking to Punch Audit.

Employee detail (`employee-detail-page.tsx` already has an analysis base in
`attendance-analysis.ts` — extend, don't fork):
- Monthly hours vs expected; punctuality distribution; leave usage by type
  vs entitlement; overtime trend (gated by `canViewOvertime`); weekday
  pattern ("consistently late after weekly off" class of insight).

Rules that bind here: insights are computed in tested series builders, never
ad hoc in JSX; no insight may surface data the viewer's permissions withhold
(overtime is the live example); every chart ships empty/loading/error states,
both themes, reduced motion, and a 360px pass.

Prompt:

```
Read docs/07-launch-plan.md §WS-F. Load /vyuha-charts, dataviz,
/emil-design-eng, /thumb-reach and /apple-design. Build the dashboard and
employee-detail charts and insight sentences listed there, using the shadcn
MCP for chart components, extending features/employees/attendance-analysis.ts
and the existing series/charts pattern. Every threshold tested in the series
tests; permission scoping inherited from the server, verified against a
non-privileged account. Verify at 360px and 1920px in both themes with the
browser, not by assumption. Finish with /vyuha-verify. Commit with REQ IDs.
```

### WS-E — Final verify and go/no-go

Run `/vyuha-verify` end to end including the browser gate; then the
checklist:

- [ ] All gates green: typecheck, lint, 1,327+ tests, production build,
      verify-ui at 1440px and 360px.
- [ ] Prod compose boots on the VPS; sign-in via invitation works over TLS.
- [ ] A real punch on a real phone from the office lands: photo stamped,
      EXIF-free, geofence verdict correct, audit row written.
- [ ] An offline punch queues and syncs when signal returns.
- [ ] Leave: apply → approve (new UI) → the day shows on the muster.
- [ ] Production holds real data: location with geofence and IP allowlist,
      real shift timings, a roster for every pilot employee, real leave
      types with opening balances, this year's holidays — and no
      placeholder seed rows anywhere.
- [ ] Every pilot login is joined to an employee record, the administrator's
      included and pointing at their own row rather than the seeded VY-0001.
      A login without one cannot punch and has no leave.
- [ ] Invitations delivered to every pilot employee; one sampled acceptance
      completes on a personal phone end to end: PWA install, camera and
      location permissions granted, punch lands.
- [ ] The employee comms note went out before day one.
- [ ] Restore rehearsal done; runbook exists; Sentry receiving (or deferred
      in writing).
- [ ] `/vyuha-security` verdict: DEPLOY.
- [ ] §2 inputs all supplied; §0 exclusions acknowledged in writing.

Any unticked box moves the launch, not the bar.

## 4. After the pilot — the remaining ~10 sessions

Week 1: the leave/approvals join (supervised, per OPEN-QUESTIONS — subject-
handler registry, raise+handle in one change), regularization and on-duty
flows (REQ-F — Pending days currently have no exit), notifications read API
+ bell + preferences UI and the 7 unwired events, user-role assignment UI.
Week 2: reports batch (Monthly Muster, Late Arrivals, Early Exits, Missing
Punch, Overtime, Leave Balance/Ledger), `exceljs` + XLSX house formatting
(needs the dependency approval), Payroll Input behind the column sign-off,
scheduled exports. Then: comp-off UI, delegation UI, team leave calendar,
restricted-holiday election UI, calculator, TOTP, Playwright E2E for the
three critical flows, the 500-employee performance pass, `/ultrareview` to
close each phase.
