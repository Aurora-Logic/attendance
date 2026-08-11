# ADR 0001 — Drizzle instead of Prisma

Status: accepted
Date: 11 August 2026
Supersedes: `02-technical-design.md` §2 (ORM row) and §3 (`prisma/schema.prisma` paths)

## Context

The technical design named Prisma as the ORM. That choice was vetoed: Prisma is
not to be used. Postgres remains the database, unchanged.

The data access layer is not a detail that can be deferred. §4 of the technical
design commits to conventions that every table inherits — `org_id` scoping,
soft delete, audit diffs — and §4.3 commits to specific index shapes. Whatever
replaces Prisma has to express all of it in the first migration, because
retrofitting a scoping rule across 40 tables is the kind of work this project
is explicitly trying to avoid.

## Decision

**Drizzle ORM** over `node-postgres`, with **drizzle-kit** generating plain SQL
migration files.

Rejected alternatives:

- **Kysely** — an excellent query builder, but it has no migration generator
  and no schema-as-code artefact. The delivery plan says "the schema is the
  argument, get it reviewed first"; a hand-maintained pile of SQL files is a
  worse thing to review than one typed schema module per domain.
- **Raw `pg` with hand-written SQL** — maximum control, but it gives up the
  compile-time link between a column and the TypeScript type that reads it.
  `packages/shared` exists to make API/web drift a build failure; giving up
  types at the database boundary undoes that at the other end.

## Why this is an improvement, not a substitute

Three things the design requires that Prisma could only reach through an
escape hatch, and Drizzle expresses directly:

1. **Exclusion constraint on `shift_assignments`** (§4.3: "make overlaps
   impossible at the database level, not just in validation"). This needs
   `EXCLUDE USING gist (employee_id WITH =, daterange(...) WITH &&)`. Prisma's
   schema language cannot express it; it would have to be a manually edited
   migration that `prisma migrate` then treats as drift.
2. **Partial index** `attendance_days (org_id, date) WHERE status='ABSENT'`.
   Same problem — Prisma has no partial index syntax.
3. **Append-only enforcement** on `punches` and `audit_logs` (REQ-B-09a,
   REQ-M-01). A database-level rule beats a convention. With SQL migrations
   under our control this is a revoked UPDATE/DELETE grant plus a trigger.

## Consequences

- `apps/api/src/platform/db/` holds the client, the base repository, and the
  platform schema modules. Attendance tables live in
  `apps/api/src/modules/attendance/` and are picked up by `drizzle.config.ts`
  via a glob.
- **The Drizzle client is created without a global schema generic**, and code
  uses the builder API (`db.select().from(table)`) rather than the relational
  API (`db.query.users.findMany()`). The relational API needs every table
  registered on one client object, which would force `platform/` to import
  `modules/` and break the §1 dependency rule. This is the one place where the
  boundary rule costs us ergonomics, and it is worth it.
- The "every query filters `org_id` and `deleted_at IS NULL` through a Prisma
  extension" rule becomes a `ScopedRepository` base class. A middleware cannot
  be relied on here, so the guarantee is enforced two ways: the base class is
  the only sanctioned way to reach a scoped table, and an integration test
  asserts that a query built for org A returns no rows belonging to org B.
- Migrations are plain, reviewable, forward-only SQL, which the Definition of
  Done already requires to be reversible where possible.
- UUID v7 primary keys come from a `uuid_generate_v7()` SQL function created in
  the first migration. Postgres 16 has no built-in v7 (that lands in 18), and a
  function keeps the default on the column rather than relying on every caller.
