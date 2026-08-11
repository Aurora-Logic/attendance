# 03 — Scope and Delivery Plan

Companion to `01-product-requirements.md` and `02-technical-design.md`.

---

## 1. Scope boundary

### In scope now

| Area | Included |
|---|---|
| Identity | Login, invites, password reset, sessions, TOTP, roles & permissions, device binding |
| Master data | Org, locations, departments, designations, employees, bulk import |
| Shifts | Shift masters, rosters, weekly offs, night shifts |
| Punch | Web + mobile PWA, photo, geofence, window rules, half day, offline queue |
| Attendance | Day engine, statuses, flags, overtime minutes, manual override, period lock |
| Leave | Types, balances, ledger, application, approval, cancellation, comp-off |
| Holidays | Calendars, restricted holidays, bulk import |
| Approvals | One generic framework covering leave, regularization, on-duty, flagged punches |
| Reports | 13 reports per REQ-J-01, saved views, photo viewer |
| Export | Excel on every report, Payroll Input contract, scheduled exports |
| Notifications | In-app + email, per-user preferences |
| Platform | Audit log, settings, file storage, job runner, keyboard layer, Go To palette |
| Seams | `external_refs`, `integration_connections`, `IntegrationProvider` interface — stubs only |

### Explicitly out of scope now

| Out | Why / when |
|---|---|
| Any salary, wage, tax, PF/ESI, or payslip calculation | Runs in Tally. Permanent exclusion. |
| Biometric device integration | Not planned |
| Live Tally sync, XML generation, connector agent | Phase 6 |
| CRM module | Phase 7 |
| ERP module (procurement, dispatch, estimates, POs) | Phase 8 |
| Native mobile apps | PWA is sufficient; revisit only if camera or background sync proves inadequate |
| Multi-company / multi-entity switching | Schema supports it; UI does not ship now |
| Shift swap and self-service roster requests | Backlog |
| Expense claims, travel requests, timesheets against projects | Backlog |
| Multilingual UI | Backlog |
| Casio calculator panel | Phase 5 (see note below) |

**On the calculator:** it's specified in REQ-N-03 and it should be built, but it earns its place in Phase 5 rather than earlier. It is a delight feature, not a blocker, and building it before the day engine is correct would be the wrong order.

---

## 2. Phases

Effort is given in **Claude Code sessions** (a focused working block), not calendar time. Each phase ends with `/ultrareview`.

---

### Phase 0 — Foundation (~4–6 sessions)

Nothing user-facing ships. Everything after this depends on getting it right.

**Deliverables**
- Monorepo, `packages/shared`, tooling, CI pipeline, Docker Compose (Postgres, Redis, MinIO, MailHog)
- ESLint boundary rule enforcing `platform` ↛ `modules` and module ↛ module
- Prisma schema for all platform tables (§4.1 of the technical design) + first migration with indexes
- Auth: login, refresh rotation with reuse detection, invite, reset, sessions, TOTP scaffold
- RBAC: permission constants, decorator + guard, `ScopeService`, `/me`
- Audit interceptor writing before/after diffs automatically
- File service (S3-compatible, signed URLs), job runner, notification dispatcher with in-app + email channels
- `external_refs`, `integration_connections`, stubbed `IntegrationProvider` (Tally heartbeat only)
- Web shell: layout, sidebar, page header pattern, table pattern, form pattern, toast, empty/error/loading states, theme tokens
- **Keyboard subsystem**: registry, scope stack, hint chip component, `Alt+G` Go To palette, `Ctrl+F1` sheet
- Seed script with the four roles and the §2.1 permission matrix

**Acceptance**
- A user can be invited, accept, log in, see an empty dashboard, and be denied a permission they lack — verified by an automated 403 test.
- `Alt+G` navigates. `Esc`, `Ctrl+A`, `Ctrl+Q` behave as specified in a demo form.
- Every shadcn component in use was installed via the shadcn MCP. Zero native form elements. Zero emojis.
- CI green: typecheck, lint, unit, integration, build.

**Exit gate:** do not start Phase 1 until the boundary lint rule is live and the audit interceptor writes automatically. Retrofitting either is expensive.

---

### Phase 1 — Punch and the day engine (~6–8 sessions)

The heart of the product.

**Deliverables**
- Employee, department, designation, location CRUD + bulk import (REQ-A-01…A-07)
- Shift masters, weekly-off patterns, rosters incl. bulk assignment (REQ-C-01…C-06)
- Punch API with photo pipeline, server-side stamping, geofence, IP allowlist, device binding, idempotency (REQ-D-01…D-13)
- Mobile-first Punch screen: live camera, server clock, today's shift and window, half-day option, confirmation
- PWA: manifest, service worker, offline queue, sync endpoint (REQ-D-10)
- **Day engine** with the full table-driven test suite (REQ-E-01…E-07)
- My Attendance screen (calendar + list)
- Team Attendance screen with scoping
- Punch Audit report with photo viewer

**Acceptance**
- Punch in → punch out → the Attendance Day shows correct status, worked minutes, and flags. Verified for: general shift, night shift crossing midnight, late arrival, early exit, half day marked at punch, half day derived from hours, missing OUT punch, out-of-window with reason, offline punch synced 6 hours later.
- Recomputing any day twice produces byte-identical output.
- The stored photo carries a server-burned stamp and no EXIF.
- Photos are unreachable without a valid signed URL, and the URL expires.
- No path exists to punch from the gallery or a file picker.
- Punch completes in under 3s on throttled 4G with a 1MB image.

**Exit gate:** run `/security-review`. Do not proceed with an open finding on the photo or punch path.

---

### Phase 2 — Leave, holidays, approvals (~5–7 sessions)

**Deliverables**
- Generic approval framework: requests, steps, inbox, bulk actions, delegation, escalation (REQ-I-01…I-05)
- Holiday calendars, restricted holidays, bulk import (REQ-H-01…H-04)
- Leave types, balances, append-only ledger, accrual and carry-forward jobs, pro-rating (REQ-G-01…G-05)
- Leave application with live day count and balance preview, validation, approval, cancellation, comp-off (REQ-G-06…G-11)
- Team leave calendar with a concurrent-absence warning (REQ-G-12)
- Regularization and on-duty flows (REQ-F-01…F-05)
- Day engine integration: leave approval, cancellation, holiday change, and regularization all recompute correctly

**Acceptance**
- Applying, approving, and cancelling leave moves the ledger correctly and the closing balance always equals opening + accrued − availed ± adjusted + carried forward. Asserted by a property test.
- A leave spanning a weekend and a holiday consumes only working days, unless the type counts sandwich days.
- A half-day leave plus a half-day worked renders as both, correctly, in the muster.
- An approver cannot approve their own request.
- An approval untouched for N days escalates automatically.

---

### Phase 3 — Reports and export (~4–6 sessions)

**Deliverables**
- Report shell: filter bar, column chooser, sort, pagination, saved views, `F12` configure, `Alt+F2` period
- All 13 reports (REQ-J-01)
- Excel export framework, Downloads tray, house formatting, streaming generation (REQ-J-03)
- Period lock / unlock with audit (REQ-E-09)
- **Payroll Input export**, versioned contract, locked periods only (REQ-J-04)
- Scheduled exports by email (REQ-J-05)

**Acceptance**
- Monthly muster for 500 employees renders its first page in under 1.5s and exports in under 30s.
- Exporting the same locked month twice produces identical files.
- Payroll Input cannot be exported from an unlocked period.
- Every report is exportable, and every export is audited.
- Every report is usable at 360px per the mobile table pattern.

**Exit gate:** get sign-off from whoever runs payroll on the Payroll Input columns before locking the v1 contract.

---

### Phase 4 — Notifications, dashboard, settings, roles (~3–4 sessions)

**Deliverables**
- Dashboards for all four roles (REQ-K-01)
- Notification events, preferences, bell with white count on the red dot (REQ-K-02…K-05)
- Settings screens, all policy fields, SMTP test send (REQ-L-01…L-05)
- Roles & Permissions editor (REQ-B-07)
- Audit log viewer + per-record history (REQ-M-02)
- Consent notice on first punch (REQ-M-03)

**Acceptance**
- Changing a policy setting immediately alters punch behaviour without a redeploy.
- A new role created in the UI grants and denies correctly on both API and UI.
- Every notification event fires on its trigger and respects per-user preferences.
- The last account holding `roles.manage` cannot be stripped of it.

---

### Phase 5 — Polish, hardening, deploy (~4–5 sessions)

**Deliverables**
- Casio-style calculator panel, `Ctrl+N` / `Alt+N` (REQ-N-03)
- Full keyboard pass: every actionable control reachable, every shortcut hinted, `Ctrl+F1` sheet complete
- Design consistency pass across all 19 screens against the apple-design skill — one hierarchy, no box-in-box, consistent density
- Accessibility pass (NFR-07)
- Performance pass against the 500-employee seed
- Playwright E2E for the three critical flows
- Deployment: Caddy + TLS, backups with a rehearsed restore, error tracking, job monitor, runbook
- Admin and employee user guides, one page each

**Acceptance**
- A Tally user completes punch → leave application → approval → month lock → payroll export without touching a mouse.
- `/ultrareview` and `/security-review` both clean.
- A restore from last night's backup into a clean environment succeeds.
- No screen fails the 360px check.

---

### Phase 6+ — Not now

| Phase | Scope | Prerequisite |
|---|---|---|
| 6 | Tally connector agent, master sync, attendance voucher generation | Phases 0–5 live and in daily use for a full month |
| 7 | CRM module (WhatsApp, email, telephony with IVR + SIM options, workflow builder) | Platform layer proven |
| 8 | ERP module (dispatch, estimates, purchase orders, procurement analytics) with Tally as the financial source of truth | Phase 6 sync working |

---

## 3. Build order rationale

Foundation before features, because RBAC, audit, and the keyboard layer are all cross-cutting and retrofitting them means touching every file. Punch and the day engine before leave, because leave modifies attendance days and needs something correct to modify. Reports after both, because a report is only as good as the records underneath. Polish last, but not optional — the previous version of this product was judged generic, and the fix for that is a dedicated pass, not hoping it accumulates.

---

## 4. Definition of Ready (before starting a task)

- The REQ ID exists in the PRD and its acceptance criteria are unambiguous.
- Any open question it depends on has been answered in `docs/OPEN-QUESTIONS.md`.
- The affected tables and endpoints are identified.
- The keyboard shortcut, if any, is decided.

## 5. Definition of Done

See `CLAUDE.md` §4. It applies to every task without exception.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Day engine logic drifts and reports stop being trustworthy | Fatal — the whole product's credibility | Table-driven test suite, idempotency assertion, ≥90% branch coverage, no engine change ships without a new test case |
| Photo storage grows unmanageably | Cost, backup time | Client downscale, 12-month retention with purge job, object storage lifecycle rules |
| Employees resist photo and location capture | Adoption failure | Consent notice, stated retention, visibility limited to permitted roles, communicate before rollout |
| Browsers block Tally-parity shortcuts | Key promise not delivered | Documented aliases shown on hints, PWA install recommended for desk users |
| Poor connectivity on shop floor | Punches lost | Offline queue with explicit queued state, 48-hour sync limit, regularization as the fallback |
| Scope creep back toward ERP mid-build | Phases never close | This document is the boundary; ERP requests go to the Phase 8 backlog |
| Platform concerns leak into the attendance module | Phase 7/8 become a rewrite | Boundary lint rule from Phase 0, checked at every `/ultrareview` |
| Payroll input columns wrong | Month-end rework, loss of trust | Get sign-off in Phase 3 before locking the v1 contract |
| Period lock too rigid or too loose | Either constant unlocking or silently shifting numbers | Lock is HR, unlock is Admin only, both audited with reasons |

---

## 7. Decisions

Confirmed answers are in `05-decisions.md`. That file is the authority — where it and any assumed default in these documents disagree, `05-decisions.md` wins.

Still open and needed before the phase shown:

| # | Question | Needed by |
|---|---|---|
| 1 | Office Maps link / coordinates for the geofence centre | Phase 1 |
| 2 | General shift timings: in, out, break duration | Phase 1 |
| 3 | Leave types with entitlement, carry-forward cap, negative limit, notice days | Phase 2 |
| 4 | This year's holiday list | Phase 2 |
| 5 | Who runs payroll, in what format, and the exact columns they need | Phase 3 |
| 6 | Attendance cycle: calendar month or a cutoff like 26th–25th | Phase 3 |
| 7 | Office IP address(es) for the web punch allowlist | Phase 1 |
| 8 | NestJS or plain Fastify *(default: NestJS)* | Phase 0 |
| 9 | Hosting and file storage *(default: VPS + R2)* | Phase 0 |
| 10 | Do all employees have a work email? If not, invites need another route | Phase 0 |
| 11 | Product name — **Setu** proposed, confirm or replace | Phase 0 |

---

## 8. How to start

```
1. Read CLAUDE.md, then docs/01, 02, 03 in full.
2. Answer §7 above, or confirm the defaults, and record the answers in
   docs/DECISIONS.md.
3. Scaffold the monorepo per technical design §3.
4. Write the full Prisma schema for platform tables before writing any
   endpoint — the schema is the argument, get it reviewed first.
5. Begin Phase 0. Commit in vertical slices. Reference REQ IDs in commits.
```
