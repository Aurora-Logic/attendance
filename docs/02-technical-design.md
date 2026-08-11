# 02 — Technical Design

Companion to `01-product-requirements.md`. Read both before writing code.

---

## 1. Architectural stance

**Modular monolith, one repository, one deployable API, one deployable web client.**

Microservices would be wrong here: a single team, one database, and heavily interlinked domains (attendance ↔ leave ↔ employee ↔ approvals). But the module boundaries must be real, because CRM and ERP are coming into this same codebase.

```
                      ┌──────────────────────────────┐
   Browser / PWA ───▶ │  Web client (React, shadcn)  │
                      └──────────────┬───────────────┘
                                     │ REST /api/v1
                      ┌──────────────▼───────────────┐
                      │            API               │
                      │                              │
                      │  platform/  ← shared kernel  │
                      │    auth, rbac, org, people,  │
                      │    audit, notify, files,     │
                      │    jobs, export, integration │
                      │                              │
                      │  modules/                    │
                      │    attendance/   ← now       │
                      │    crm/          ← later     │
                      │    erp/          ← later     │
                      └───┬──────────┬───────────┬───┘
                          │          │           │
                    ┌─────▼───┐ ┌────▼────┐ ┌────▼─────┐
                    │Postgres │ │ Redis   │ │ S3-compat│
                    │         │ │ (queue) │ │ (photos) │
                    └─────────┘ └─────────┘ └──────────┘

        Office LAN
        ┌────────────────────────────────┐
        │  TallyPrime (port 9000, XML)   │
        │        ▲                       │
        │        │  localhost only       │
        │  ┌─────┴──────────────┐        │
        │  │ Tally Connector    │──────────────▶ outbound HTTPS
        │  │ agent (Phase 6+)   │        │      poll for jobs
        │  └────────────────────┘        │
        └────────────────────────────────┘
```

**Dependency rule:** `modules/*` may import from `platform/*`. `platform/*` must never import from `modules/*`. Modules must never import from each other directly — they communicate through the platform event bus. Enforce this with an ESLint boundary rule in Phase 0, not by discipline.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict, everywhere | One language across API, web, and the future connector agent |
| API framework | **NestJS** (Fastify adapter) | Its module system maps 1:1 to the platform/modules boundary above; DI makes the RBAC and audit interceptors clean. Heavier than plain Fastify, and that ceremony is the point here. |
| ORM | **Prisma** | Readable schema file, good migrations, strong TS types |
| Database | **PostgreSQL 16** | Date/interval handling, partial indexes, `generated always as identity`, JSONB for audit diffs |
| Cache / queue | **Redis + BullMQ** | Exports, recomputes, notifications, nightly sweeps |
| Object storage | **S3-compatible** (MinIO in dev, S3/R2 in prod) | Punch photos, exports |
| Web | **React 18 + Vite + TypeScript** | |
| UI | **shadcn/ui via shadcn MCP** + Tailwind | Mandatory — see CLAUDE.md §3 |
| Icons | `lucide-react` | Mandatory — no emoji |
| Server state | TanStack Query | |
| Client state | Zustand, sparingly | Shortcut registry, UI shell state only |
| Forms | React Hook Form + Zod | Same Zod schemas shared with the API via `packages/shared` |
| Tables | TanStack Table headless + shadcn Table | Column chooser, sorting, saved views |
| Dates | `date-fns` + `date-fns-tz` | No moment, no dayjs |
| Excel | `exceljs` (server-side, in a worker) | Formatting control that a CSV can't give |
| Image stamping | `sharp` | Server-side burn-in + EXIF strip |
| Auth | Own implementation: Argon2id + JWT access + rotating refresh | No third-party identity provider dependency |
| Testing | Vitest (unit), Supertest (API), Playwright (E2E on the critical paths) | |
| Deployment | Docker Compose behind Nginx/Caddy | Single VPS is sufficient at this scale |

**Alternative to confirm before Phase 0:** if NestJS ceremony proves excessive, plain Fastify + a hand-rolled module registry is acceptable. Decide once; do not mix.

---

## 3. Repository layout

```
setu/
├─ CLAUDE.md
├─ docs/                        01/02/03 + OPEN-QUESTIONS.md + ADRs
├─ apps/
│  ├─ api/
│  │  ├─ prisma/schema.prisma
│  │  ├─ prisma/migrations/
│  │  ├─ src/
│  │  │  ├─ platform/
│  │  │  │  ├─ auth/ rbac/ org/ people/ audit/
│  │  │  │  ├─ notification/ file/ export/ job/
│  │  │  │  ├─ integration/     ← Tally seam lives here
│  │  │  │  └─ common/          ← errors, pagination, guards, interceptors
│  │  │  ├─ modules/
│  │  │  │  └─ attendance/
│  │  │  │     ├─ shift/ roster/ punch/ day-engine/
│  │  │  │     ├─ leave/ holiday/ regularization/
│  │  │  │     ├─ approval/ report/
│  │  │  │     └─ attendance.module.ts
│  │  │  └─ main.ts
│  │  ├─ seed/
│  │  └─ test/
│  └─ web/
│     ├─ src/
│     │  ├─ app/          routing, layout shell, providers
│     │  ├─ components/   ui/ (shadcn) + shared app components
│     │  ├─ features/     mirrors modules/ on the API side
│     │  ├─ lib/          api client, keyboard registry, formatters
│     │  └─ hooks/
│     └─ public/          PWA manifest, service worker
├─ packages/
│  ├─ shared/             Zod schemas, DTO types, permission constants, enums
│  └─ config/             eslint, tsconfig, tailwind preset
└─ docker/
```

`packages/shared` is the contract. A DTO shape is defined once there and imported by both sides. Drift between API and web types is a build failure, not a runtime surprise.

---

## 4. Data model

Conventions for every table: `id` (UUID v7), `org_id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at` (soft delete). Every query filters `org_id` and `deleted_at IS NULL` through a Prisma extension — never by hand in each query.

### 4.1 Platform

| Table | Key columns |
|---|---|
| `organizations` | name, legal_name, timezone, date_format, week_start, leave_year_start_month, logo_key |
| `locations` | name, code, address, timezone, geofence_lat, geofence_lng, geofence_radius_m, ip_allowlist (text[]), holiday_calendar_id |
| `departments` | name, code, head_employee_id, parent_id |
| `designations` | name, code, grade |
| `employees` | employee_code (unique per org), first_name, last_name, work_email, personal_email, mobile, date_of_joining, date_of_leaving, employment_type, department_id, designation_id, location_id, reporting_manager_id, default_shift_id, weekly_off_pattern_id, holiday_calendar_id, is_field_staff, status |
| `users` | employee_id (unique, nullable), email (unique), password_hash, status, totp_secret, last_login_at, failed_attempts, locked_until |
| `roles` | name, description, is_system |
| `permissions` | key (e.g. `attendance.view.all`), description |
| `role_permissions` | role_id, permission_id |
| `user_roles` | user_id, role_id |
| `sessions` | user_id, refresh_token_hash, family_id, device_fingerprint, ip, user_agent, expires_at, revoked_at |
| `devices` | employee_id, fingerprint, label, first_seen_at, last_seen_at, status |
| `invitations` | email, employee_id, token_hash, expires_at, accepted_at |
| `audit_logs` | actor_user_id, impersonator_user_id, action, entity_type, entity_id, before (jsonb), after (jsonb), ip, user_agent, created_at — **append-only** |
| `notifications` | user_id, event_type, title, body, payload (jsonb), read_at, channels_sent (text[]) |
| `notification_preferences` | user_id, event_type, channel, enabled |
| `settings` | scope (org/location), scope_id, key, value (jsonb) |
| `files` | storage_key, mime, bytes, checksum, purpose, uploaded_by, expires_at |
| `export_jobs` | requested_by, report_key, filters (jsonb), status, file_id, row_count, error, started_at, finished_at |
| `saved_views` | user_id, report_key, name, config (jsonb), is_shared |
| `integration_connections` | system (`TALLY`), name, status, agent_token_hash, last_heartbeat_at, config (jsonb) |
| `external_refs` | system, entity_type, external_guid, external_alter_id, internal_type, internal_id, last_synced_at — the Tally mapping table |

### 4.2 Attendance

| Table | Key columns |
|---|---|
| `shifts` | name, code, start_time, end_time, crosses_midnight, break_minutes, grace_in_before, grace_in_after, late_after, grace_out_before, grace_out_after, early_exit_before, min_half_day_minutes, min_full_day_minutes, ot_after_minutes, is_active |
| `weekly_off_patterns` | name, config (jsonb — weekdays, alternate-Saturday rule) |
| `shift_assignments` | employee_id, shift_id, effective_from, effective_to — no overlaps (exclusion constraint) |
| `holiday_calendars` | name, year |
| `holidays` | calendar_id, date, name, is_restricted |
| `restricted_holiday_elections` | employee_id, holiday_id, leave_year |
| `punches` | employee_id, attendance_date, punch_type (IN/OUT), server_time, client_time, clock_skew_seconds, photo_file_id, latitude, longitude, gps_accuracy_m, distance_from_geofence_m, ip, device_fingerprint, source (WEB/MOBILE/OFFLINE_SYNC), user_agent, app_version, is_half_day_marked, half_day_part, outside_window, reason, idempotency_key (unique per employee) — **immutable, no updates, no deletes** |
| `attendance_days` | employee_id, date, shift_id, scheduled_in, scheduled_out, first_in_punch_id, last_out_punch_id, worked_minutes, break_minutes, ot_minutes, status, late_minutes, early_exit_minutes, flags (text[]), leave_request_id, is_manual_override, override_reason, computed_at, locked — **unique (employee_id, date)** |
| `attendance_adjustments` | attendance_date, employee_id, regularization_id, adjusted_in, adjusted_out, reason, approved_by |
| `regularizations` | employee_id, date, kind, requested_in, requested_out, reason, attachment_file_id, approval_request_id, status |
| `on_duty_requests` | employee_id, from_date, to_date, reason, site_name, approval_request_id, status |
| `leave_types` | name, code, is_paid, accrual_method, annual_entitlement, carry_forward_allowed, carry_forward_cap, allows_half_day, min_days, max_days, notice_days, attachment_required_after_days, counts_sandwich_days, requires_two_step_approval, applicable_employment_types |
| `leave_balances` | employee_id, leave_type_id, leave_year, opening, accrued, availed, adjusted, carried_forward, closing |
| `leave_ledger` | employee_id, leave_type_id, leave_year, movement_type, days, reference_type, reference_id, note, created_at — **append-only** |
| `leave_requests` | employee_id, leave_type_id, from_date, to_date, total_days, reason, attachment_file_id, approval_request_id, status, cancelled_at |
| `leave_request_days` | leave_request_id, date, portion (FULL / FIRST_HALF / SECOND_HALF), is_counted |
| `comp_off_credits` | employee_id, earned_for_date, days, expires_on, consumed_by_leave_request_id |
| `approval_requests` | type, requester_user_id, subject_type, subject_id, current_step, status, escalated_at |
| `approval_steps` | approval_request_id, step_no, approver_user_id, delegated_from_user_id, action, reason, acted_at |
| `attendance_period_locks` | location_id (nullable = org-wide), year, month, locked_by, locked_at, unlocked_by, unlocked_at, reason |

### 4.3 Indexing

Non-negotiable indexes — add these in the first migration, not after a performance complaint:

```
attendance_days   (org_id, date, employee_id)          -- daily muster
attendance_days   (org_id, employee_id, date)          -- employee timeline
attendance_days   (org_id, date) WHERE status='ABSENT' -- partial, absenteeism
punches           (org_id, employee_id, attendance_date, server_time)
punches           (org_id, attendance_date)
leave_requests    (org_id, employee_id, from_date, to_date)
leave_ledger      (org_id, employee_id, leave_type_id, leave_year)
audit_logs        (org_id, entity_type, entity_id, created_at DESC)
approval_requests (org_id, status, current_step)
```

Add an exclusion constraint on `shift_assignments` to make overlaps impossible at the database level, not just in validation.

---

## 5. The attendance day engine

The single most important piece of logic in the product. Everything reports off `attendance_days`, so it must be deterministic.

**Contract:** `computeDay(employeeId, date) → AttendanceDay`. Pure with respect to its inputs — reads punches, roster, leave, holidays, weekly offs, adjustments, and settings; writes exactly one row. Running it twice produces the same result. It never reads its own previous output except to preserve `is_manual_override`.

```
1.  Resolve shift for (employee, date) from shift_assignments → default_shift
2.  If period is locked for (location, year, month) → abort, no write
3.  If is_manual_override on the existing row → keep status, recompute
    only worked_minutes and flags, mark and exit
4.  Resolve calendar context:
      holiday?  weekly off?  approved leave (full / first-half / second-half)?
5.  Load punches for the date (for a midnight-crossing shift, the window is
    shift_start-grace_in_before .. shift_end+grace_out_after, which may
    extend into the next calendar date)
6.  Apply approved adjustments (regularization) over the raw punches
7.  worked_minutes = (last_out − first_in) − break_minutes, capped at max_work_minutes
8.  Derive status by the resolution order in REQ-E-02
9.  Derive late_minutes, early_exit_minutes, ot_minutes
10. Derive flags[]
11. Upsert attendance_days, write audit entry only if the row materially changed
```

**Triggers** (all enqueue a `recompute-day` job rather than running inline, except punch which runs inline so the employee sees immediate status):

| Event | Days recomputed |
|---|---|
| Punch created | That day |
| Leave approved / cancelled | Every date in range |
| Regularization approved | That day |
| Roster or shift master changed | Every affected employee-day in the range |
| Holiday calendar changed | Every affected employee-day |
| Employee joining/leaving date changed | Affected range |
| Nightly sweep 02:00 IST | Previous 3 days, all active employees |
| Missing-punch closeout 23:45 IST | Today, employees with IN and no OUT past their window |

**Backfill:** a job creates `attendance_days` rows forward for every active employee each night for the coming day, so the muster grid is never sparse.

---

## 6. API design

- Base path `/api/v1`. REST, resource-oriented, plural nouns.
- Auth: `Authorization: Bearer <access>`; refresh via `POST /auth/refresh` with an httpOnly cookie holding the rotating refresh token.
- Success: the resource, or `{ data, meta: { page, pageSize, total } }` for collections.
- Error envelope, always:
  ```json
  { "error": { "code": "PUNCH_OUTSIDE_WINDOW", "message": "Punch window for General Shift closed at 09:40.",
               "details": { "windowEnd": "2026-08-11T04:10:00Z" }, "requestId": "01J..." } }
  ```
  Error codes are a shared enum in `packages/shared`. The web client maps codes to messages; it never string-matches on `message`.
- Every mutating endpoint accepts `Idempotency-Key`.
- Filtering: `?from=&to=&locationId=&departmentId=&employeeId=&status=&flags=`. Sorting: `?sort=-date,employeeCode`.
- Pagination: page/pageSize for reports, cursor for the audit log and punch feed.

**Representative endpoints**

```
POST   /auth/login | /auth/refresh | /auth/logout
POST   /auth/invitations/:token/accept
GET    /me   (profile, permissions, today's shift and status)

POST   /punches                       multipart: photo + payload
GET    /punches?employeeId=&date=
POST   /punches/sync                  offline queue drain, array + idempotency keys

GET    /attendance/days?from=&to=&...
GET    /attendance/days/:employeeId/:date
PATCH  /attendance/days/:employeeId/:date/override
POST   /attendance/recompute          { employeeIds[], from, to }  (HR/Admin)
POST   /attendance/locks              { locationId, year, month }
DELETE /attendance/locks/:id          { reason }  (Admin)

GET/POST/PATCH  /shifts | /rosters | /weekly-off-patterns
POST   /rosters/bulk

GET/POST /leave/types
GET    /leave/balances?employeeId=&year=
GET    /leave/ledger?employeeId=&leaveTypeId=
POST   /leave/requests
POST   /leave/requests/:id/cancel
GET    /leave/calendar?month=

POST   /regularizations
POST   /on-duty-requests

GET    /approvals?type=&status=
POST   /approvals/:id/approve   { reason? }
POST   /approvals/:id/reject    { reason }
POST   /approvals/bulk
POST   /approvals/delegations

GET    /reports/:reportKey            paginated data for the report shell
POST   /exports                       { reportKey, filters, format }  → 202 + jobId
GET    /exports/:jobId
GET    /exports/:jobId/download       → signed URL redirect

GET/POST/PATCH  /employees | /departments | /designations | /locations
POST   /employees/import/validate | /employees/import/commit
GET/PUT /settings
GET/POST/PATCH /roles
GET    /audit-logs
```

---

## 7. Punch photo pipeline

```
Client                          API                        Storage
──────                          ───                        ───────
capture (front camera only)
  ↓ downscale to ≤1280px, JPEG q0.8
  ↓ POST /punches (multipart)
                          validate window, geofence,
                          device, idempotency
                          ↓ sharp: strip EXIF,
                            burn stamp (name, code,
                            type, server time, date)
                          ↓ checksum, put object ──────▶  photos/{orgId}/{yyyy}/{MM}/{employeeId}/{punchId}.jpg
                          ↓ insert punch row
                          ↓ computeDay inline
                          ↓ return status + thumbnail URL
```

### Compression (REQ-D-03a)

Storage math drives this. At 500 employees × 2 punches × 26 days = 26,000 images/month:

| Per-image size | Per month | Per year |
|---|---|---|
| 2 MB (raw camera) | 52 GB | 624 GB |
| 400 KB (client downscale only) | 10.4 GB | 125 GB |
| **120 KB (target)** | **3.1 GB** | **37 GB** |

Pipeline: client downscales to ≤1280px long edge at JPEG q0.8 (target <200 KB) → server strips EXIF → `sharp` burns the stamp → server re-encodes to progressive JPEG with a quality ladder that binary-searches to land in the **80–150 KB** band → a **256px thumbnail** is generated and stored alongside.

- Two objects per punch: `.../{punchId}.jpg` (full) and `.../{punchId}_thumb.jpg`.
- Serve WebP when `Accept` allows it; keep JPEG as the stored canonical.
- **All list, table, and report views load thumbnails only.** Fetching a full image in a list is a review failure — at 500 rows it is 60 MB of traffic.
- A test asserts the burned stamp is still legible after compression (OCR the output, or a pixel-contrast check on the stamp region). Compress the stamp into unreadability and the anti-fraud control is gone.
- Quality band and thumbnail size are settings, with the storage estimate table above rendered next to them.
- Object storage lifecycle: transition to infrequent-access after 90 days, purge at the retention limit.

### Other pipeline rules

- Camera constraint: `getUserMedia({ video: { facingMode: { exact: "user" } } })`. No `<input type="file">` fallback — that is the anti-fraud control.
- Reject uploads over 3MB and anything that isn't a JPEG/PNG by magic bytes, not extension.
- The stamp is applied server-side because a client-side stamp is trivially forged.
- Retrieval only via signed URLs valid for 5 minutes, issued after a permission check on the requesting user's scope.
- A retention job purges photos older than the configured window and nulls `photo_file_id`, leaving the punch record intact.

---

## 8. Offline punch (PWA)

- Service worker caches the app shell. The punch route works offline.
- Queue stored in IndexedDB: `{ idempotencyKey, type, clientTime, photoBlob, coords, deviceFingerprint }`.
- Background Sync where supported, plus a drain on next app open.
- The UI is explicit: "Queued — will sync when you're back online," with a count badge. Never let someone believe a queued punch is confirmed.
- On sync, `POST /punches/sync` processes the array; the server records `source=OFFLINE_SYNC` and `sync_delay_seconds`, and flags the punch for visibility in reports.
- Server-side guard: reject queued punches older than 48 hours; they must go through regularization instead.

---

## 9. Keyboard shortcut layer

A first-class subsystem, not scattered `onKeyDown` handlers.

```ts
// lib/keyboard/registry.ts
type Shortcut = {
  id: string;
  keys: string;            // 'alt+g'
  alias?: string;          // 'alt+n' for browser-reserved keys
  label: string;           // shown in the hint chip and the Ctrl+F1 sheet
  scope: 'global' | 'screen' | 'modal' | 'field';
  when?: () => boolean;    // permission or state gating
  run: () => void;
};
```

- A `ShortcutProvider` holds a **scope stack**. Opening a modal pushes a scope; only the top scope plus `global` shortcuts fire.
- `useShortcut(shortcut)` registers on mount, unregisters on unmount. Registering a duplicate key in the same scope throws in development.
- `<ShortcutHint keys="alt+g" />` renders the chip. A control with a registered shortcut and no visible hint is a review failure.
- Shortcuts never fire while a text input has focus, except `Ctrl+A` (save), `Esc`, `Alt+C`, and `Ctrl+N` — matching Tally's behaviour.
- Browser-reserved keys: attempt registration, detect non-delivery, and fall back to the documented alias. Both are shown on the hint. In the installed PWA, more keys reach the app — do not hardcode assumptions about which.
- `Alt+G` (Go To) is a command palette: fuzzy search across screens, reports, employees, and create-actions, permission-filtered, arrow-navigable, `Enter` to execute.

---

## 10. RBAC implementation

- Permissions are string constants in `packages/shared/permissions.ts`. Nothing checks a role name.
- API: a `@RequirePermission('attendance.view.all')` decorator plus a guard. Data scoping (`self` / `team` / `all`) is resolved into a `where` fragment by a `ScopeService` and applied in the repository — the controller never builds it.
- `/me` returns the effective permission set. The web client uses `<Can permission="...">` and a `usePermission()` hook to hide or disable controls.
- **Client gating is cosmetic.** Every endpoint enforces independently. A test asserts that each protected endpoint returns 403 for an under-privileged token.

---

## 11. Background jobs (BullMQ)

| Queue | Trigger | Job |
|---|---|---|
| `attendance` | event | `recompute-day`, `recompute-range` |
| `attendance` | cron 23:45 | `close-missing-punches` |
| `attendance` | cron 02:00 | `nightly-recompute` (last 3 days) |
| `attendance` | cron 02:15 | `provision-next-day-rows` |
| `leave` | cron monthly | `accrue-leave`, `carry-forward` (leave-year rollover) |
| `leave` | cron daily | `expire-comp-offs` |
| `export` | on demand | `generate-excel` |
| `notification` | event | `send-notification` |
| `notification` | cron | `escalate-stale-approvals`, `punch-reminders` |
| `maintenance` | cron weekly | `purge-expired-photos`, `purge-expired-exports` |

All jobs are idempotent and safe to re-run. Failed jobs retry with backoff and surface in an admin job monitor.

---

## 12. Notifications

```ts
interface NotificationChannel {
  key: 'in_app' | 'email' | 'whatsapp';
  send(to: Recipient, message: RenderedNotification): Promise<void>;
}
```

Call sites emit a domain event (`leave.approved`) with a payload. A dispatcher resolves recipients, renders per-channel templates, checks user preferences, and fans out. **Adding WhatsApp later must mean registering one new channel implementation and nothing else.** If a feature call site names a channel directly, it's wrong.

---

## 13. Excel export

- Runs in a worker, never in the request cycle.
- `exceljs` with a shared `buildWorkbook(reportKey, rows, meta)` helper enforcing house formatting: org name and logo in the header block, filter criteria stated, generated-at timestamp, frozen header row, autofilter, tabular number formats, `dd-MM-yyyy` dates, no merged cells inside the data grid.
- Streams rows from a cursor — never loads a full month into memory.
- Output goes to object storage; the Downloads tray polls the job and offers a signed URL.
- The **Payroll Input** export (REQ-J-04) has a versioned column contract in `packages/shared/exports/payroll-input.v1.ts`. Changing it requires a new version file, not an edit.

---

## 14. Tally and future ERP seams

Nothing here is built now beyond the tables and interfaces marked **Phase 0**. The point is to make Phase 6 additive.

### 14.1 Why an agent, not a direct connection

TallyPrime exposes an HTTP/XML gateway on port 9000, and it only responds while Tally is open on that machine. Exposing that port to the internet to let a cloud app reach it would be a serious security mistake. Instead:

- A small **Tally Connector** agent runs on the office machine alongside Tally.
- It makes **outbound** HTTPS calls to `/integrations/tally/jobs` to claim work, talks to Tally on `localhost:9000`, and posts results back.
- No inbound firewall rule, no port forwarding, no static IP requirement.
- It authenticates with a per-connection token; heartbeats update `integration_connections.last_heartbeat_at`, and a stale heartbeat raises an admin notification.

### 14.2 Sync model

- **Direction:** Tally is the system of record for ledgers, stock items, and vouchers. The app reads; it does not write back until explicitly decided.
- **Incremental sync** uses Tally's `GUID` (stable identity) and `ALTERID` (monotonic change counter). Store both in `external_refs`, request only records with an `ALTERID` greater than the last synced value, and never re-import the world.
- **Mapping** is explicit: `external_refs (system='TALLY', entity_type='LEDGER', external_guid, external_alter_id, internal_type, internal_id)`. No fuzzy name matching between Tally masters and internal records — a name match is a suggestion for a human to confirm, never an automatic link.
- **Conflict rule:** for Tally-owned entities, Tally wins and the local copy is overwritten. Log every overwrite.

Indicative request shape (verify against Tally's current developer reference before implementing):

```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>GC Communication</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>
```

### 14.3 The attendance → Tally payroll link

Payroll runs in Tally, which models attendance through Attendance/Production Types and Attendance Vouchers. So the natural Phase 6 output is not just an Excel sheet — it's a Tally-importable attendance voucher generated from a locked period, with employee identity resolved through `external_refs` rather than by name.

Build now, so this is possible later:
1. `external_refs` table, with an `EMPLOYEE` entity type (**Phase 0**).
2. An `employee.tally_ref` display field on the employee screen, blank for now (**Phase 0**).
3. The Payroll Input export as a versioned, shaped contract rather than an ad-hoc sheet (**Phase 4**).
4. `integration_connections` and an `IntegrationProvider` interface with a stubbed Tally implementation that only heartbeats (**Phase 0**).

Do not build XML generation, the connector agent, or voucher import in Phases 0–5.

### 14.4 What CRM and ERP will need from the platform

Build these as generic platform capabilities now, used by attendance, so the later modules inherit them: RBAC and scoping, approvals, audit, notifications, file storage, export framework, saved views, the keyboard/Go To layer, master data (org, location, department, employee), and the job runner. If any of these end up living inside `modules/attendance/`, Phase 6 becomes a rewrite.

---

## 15. Security

| Risk | Control |
|---|---|
| Proxy punching (a colleague punches for you) | Mandatory front-camera photo, server-side stamp, device binding, geofence, IP allowlist, punch audit with photos |
| Photo forgery | No gallery upload path, EXIF stripped, server-side stamping, checksum stored |
| Client clock manipulation | Server time is authoritative; skew recorded and flagged above 5 min |
| Retroactive tampering | Punches immutable; corrections are adjusting records; append-only audit; period lock |
| Token theft | Short-lived access token, rotating refresh with reuse detection, session revocation |
| Credential stuffing | Argon2id, per-account and per-IP rate limits, lockout with email notice, optional TOTP |
| Privilege escalation | Server-side permission checks on every endpoint; scope resolved in the repository; 403 tests per endpoint |
| IDOR | Every read filtered by `org_id` + scope; never trust an ID from the client |
| Injection | Prisma parameterised queries only; no raw SQL without an explicit review |
| File upload abuse | Magic-byte type check, size cap, re-encode through `sharp`, non-executable storage, signed-URL access only |
| Data leakage in exports | Export permission checked, scope applied to rows, every export audited, links expire |
| Location privacy | Consent notice on first punch, retention limit, coordinates visible only to permitted roles |
| Dependency risk | Lockfile committed, `npm audit` in CI, no new dependency without approval |

Run `/security-review` before closing Phase 1 and again before deployment.

---

## 16. Testing

| Level | What | Bar |
|---|---|---|
| Unit | Day engine, leave day counting, accrual, window evaluation, geofence distance, shortcut registry | Day engine ≥ 90% branch coverage. It gets a dedicated table-driven suite covering: night shift, half day both ways, leave + half day, holiday + punch, missing OUT, out-of-window with reason, offline sync, manual override, locked period. |
| Integration | Every endpoint: happy path, validation failure, 401, 403, idempotent retry | Every endpoint has a 403 test |
| E2E (Playwright) | Punch in → punch out → day computes; apply leave → approve → day shows ON_LEAVE; lock period → export payroll input | These three flows must pass before any deploy |
| Performance | Seeded 500 employees × 24 months; report and export benchmarks from NFR-02/03 | Run at the end of each phase |

CI: typecheck → lint → unit → integration → build. Red CI blocks merge.

---

## 17. Environments and deployment

- **Local:** Docker Compose — Postgres, Redis, MinIO, MailHog. `pnpm dev` runs API and web.
- **Staging:** identical compose stack on a VPS, seeded with synthetic data. Never real employee photos.
- **Production:** same stack behind Caddy with automatic TLS. Nightly `pg_dump` to off-site object storage, with a documented and **rehearsed** restore. Object storage versioning on.
- Config strictly through environment variables, validated by Zod at boot — the process refuses to start on a missing or malformed var.
- Migrations run on deploy, forward-only, reversible where possible.
- Observability: structured JSON logs with a request ID threaded through, `/health` and `/ready`, error tracking (Sentry or equivalent), and a job monitor page for BullMQ.

---

## 18. Seed data

`seed/` provides: one organisation, two locations, five departments, four seeded roles with the §2.1 permission matrix, three shifts (General, Morning, Night), a weekly-off pattern, a holiday calendar for the current year, five leave types, 25 employees across the hierarchy, and 60 days of realistic punch history including late arrivals, missing punches, approved leave, and one manual override. A separate `seed:perf` generates the 500-employee dataset for NFR benchmarking.

Seed data is clearly synthetic. No real names, no real photos.
