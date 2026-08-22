# Handoff — context for a fresh Claude window

Written 22 Aug 2026 on `phase-6a`. Read this, then `CLAUDE.md`, then
`docs/PENDING.md` (the live ledger). Everything below is true as of the
commit that added this file; the ledger is updated as work lands and wins
where the two disagree.

## Standing rules from the owner (do not re-ask)

- Work on `phase-6a`; push there after each working increment. Never push
  to `main`. The `v1.0.0-attendance` tag is immutable.
- **Do not launch, kill or drive Chrome** — it disrupts the owner's own
  work. Verify with curl, the API, and the test suites only.
- Every UI component from shadcn via the MCP; no emojis; no box-in-box;
  responsive at 360 px; Tally key parity (see `CLAUDE.md` §3).
- Reference REQ IDs in commit messages, never in rendered copy.
- The owner runs `/code-review ultra` themselves; it cannot be triggered
  from a session. The `/security-review` close-out was stopped by the owner
  on 22 Aug ("we will do it later") — its one finding was fixed as A-09.
- Two sessions may share this checkout. Before committing, `git status`
  and stage only your own files; never `git add -A` blind.

## Where things stand

| Stretch | Ledger rows | State |
|---|---|---|
| Reporting & analytics overhaul + mobile navigation (21 Aug brief) | P-01 … P-22 | All Done except P-18 (security review, deferred by owner) |
| Attendance rework (22 Aug brief: corrections out, admin entry, flags, early arrival, geofence, pickers, sidebar, REQ copy) | A-01 … A-09 | All Done, decisions recorded per row |
| Glyph registries, dashboard attendance block, ten more reports | B-01 … B-17 | Done (see ledger) |

The dev login created for verification is `verify@vyuha.local` /
`verify-only-2026` (an Admin clone in the dev DB; delete when done).

## Environment

- Web `:5173`, API `:3000`, Postgres `:55432` (`vyuha`/`vyuha_dev_only`,
  db `vyuha`), Redis, MinIO, Mailpit via `pnpm infra:up`.
- Gates, in order (the `vyuha-verify` skill):
  `pnpm --filter @vyuha/shared build` → `pnpm typecheck` → `pnpm lint` →
  shared / web / api tests → `pnpm build`. The api suite is flaky about one
  run in three; re-run before investigating.
- Migrations: `npx drizzle-kit generate --name <x>` with `DATABASE_URL`
  set, then `pnpm --filter @vyuha/api db:migrate`. Latest is 0043
  (`report_usage`). A backtick inside a drizzle `sql` template ends it.

## What is genuinely open

From the owner's own review of the branch (22 Aug):

1. **Code splitting.** The web build is one ~3 MB chunk (805 kB gzip) across
   63 routes; `React.lazy` is used nowhere in `App.tsx`. Tracked as P-23.
2. **Org scoping is convention, not enforcement.** 14 of 30 repositories do
   not extend `ScopedRepository`; 131 hand-written `sql` blocks do not
   literally contain `org_id` (most are fragments that receive it, or are
   scoped by an org-owned `connection_id`). No leak was found. Tracked as
   P-24: decide whether to enforce (lint rule / wrapper) before two
   customers share a database.
3. **Cross-org isolation coverage is thin** — 12 test files for 283 routes.
   Tracked as P-25.
4. **P-18 security review** — deferred by the owner; the first-pass finding
   (credentials endpoint) is already fixed as A-09.

Owner-side list (they do these themselves): `/code-review ultra`, merge to
main, live Tally connection, the access window, removing the dev login.

## Useful entry points

- Reports platform: `packages/shared/src/reports.ts` (definitions, join
  keys, export schema), `apps/api/src/platform/export/` (controller, export
  service with comparison columns), `apps/api/src/platform/masters/`
  (analytics + Tally report sources, the daily exception sweep),
  `apps/web/src/features/reports/` (shell, charts, series, comparison).
- Attendance rework: punch flags in `punch_flag_reviews`, admin entry via
  `POST /punches/admin`, early arrival on the day engine, geofence in the
  punch endpoint; Approvals is the single inbox.
- Notifications: event catalogue in `packages/shared/src/notifications.ts`,
  templates in `apps/api/src/platform/notifications/notification-events.ts`.
- Jobs: `apps/api/src/platform/jobs/queue.registry.ts` (names, queues,
  schedules). Daily: reorder sweep 01:15, exception sweep 01:45.
