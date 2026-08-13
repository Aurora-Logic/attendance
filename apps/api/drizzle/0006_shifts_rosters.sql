-- Phase 1, the shift / weekly-off / roster slice (REQ-C-01 … REQ-C-06).
--
-- There are no CREATE TABLE statements here, and that is deliberate.
-- Migration 0004 already created `shifts`, `weekly_off_patterns` and
-- `shift_assignments` -- the roster table technical design §4.2 names -- along
-- with `shift_assignments_no_overlap`, the exclusion constraint REQ-C-04's
-- "overlapping assignments are rejected" actually rests on. Re-creating any of
-- them here would fail on the first deploy and, worse, a `CREATE ... IF NOT
-- EXISTS` version would quietly do nothing while looking like it had worked.
--
-- What was missing is everything below: the bounds the day engine assumes but
-- nothing enforced, and the one index this slice's list query needs and 0004's
-- indexes cannot serve.
--
-- Everything here is hand-written. Drizzle's schema for these tables lives in
-- `src/modules/attendance/schema/shift.schema.ts` and does not describe these
-- constraints, so they are outside the snapshot for the same reason 0004's
-- exclusion constraint is: `drizzle-kit generate` diffs the last snapshot
-- against the TypeScript schema, and a constraint absent from both produces no
-- diff and is neither recreated nor dropped.
--
-- Reverse with:
--   DROP INDEX "shift_assignments_org_range_idx";
--   ALTER TABLE "weekly_off_patterns" DROP CONSTRAINT "weekly_off_patterns_config_shape";
--   ALTER TABLE "shifts" DROP CONSTRAINT "shifts_schedule_ordered";
--   ALTER TABLE "shifts" DROP CONSTRAINT "shifts_minutes_within_a_day";
--
-- Nothing here is destructive: every statement is ADD or CREATE, and no column
-- or row is touched.

-- ---------------------------------------------------------------------------
-- REQ-C-01: the ten minute-valued policy columns.
--
-- Every one of them is added to or subtracted from a shift boundary by
-- `compute-day.ts`. A negative grace window silently inverts the comparison it
-- appears in -- the punch window closes before it opens, and every punch on
-- that shift is judged outside it -- and a grace window of a year accepts a
-- punch from any date at all. Neither produces an error anywhere; both produce
-- a month of wrong musters.
--
-- The Zod schema in `packages/shared/src/shifts.ts` applies the same 0..1440
-- bounds, which is what gives the form a per-field message. This is the
-- backstop for the paths that never see it: a bulk import, a repair script, a
-- future Tally sync.
--
-- One constraint rather than ten, because they are one rule and ten names
-- would be ten things to keep in step.
-- ---------------------------------------------------------------------------
ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_minutes_within_a_day" CHECK (
    break_minutes      BETWEEN 0 AND 1440 AND
    grace_in_before    BETWEEN 0 AND 1440 AND
    grace_in_after     BETWEEN 0 AND 1440 AND
    late_after         BETWEEN 0 AND 1440 AND
    grace_out_before   BETWEEN 0 AND 1440 AND
    grace_out_after    BETWEEN 0 AND 1440 AND
    early_exit_before  BETWEEN 0 AND 1440 AND
    min_half_day_minutes BETWEEN 0 AND 1440 AND
    min_full_day_minutes BETWEEN 0 AND 1440 AND
    ot_after_minutes   BETWEEN 0 AND 1440
  );--> statement-breakpoint

COMMENT ON CONSTRAINT "shifts_minutes_within_a_day" ON "shifts" IS
  'REQ-C-01: every policy field is a whole number of minutes inside one day.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- REQ-C-02, from the other direction.
--
-- A shift whose end is at or before its start is a night shift, and a night
-- shift is only attributed to its start date when `crosses_midnight` is set.
-- Without the flag the day engine builds `scheduled_out` on the same calendar
-- date as `scheduled_in`, so the window has zero or negative length: the OUT
-- punch is always early, worked minutes are always negative, and the day is
-- always ABSENT. The flag is the only thing that distinguishes "22:00 to 06:00
-- tomorrow" from a data-entry mistake, and nothing was asking for it.
-- ---------------------------------------------------------------------------
ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_schedule_ordered" CHECK (
    crosses_midnight OR end_time > start_time
  );--> statement-breakpoint

COMMENT ON CONSTRAINT "shifts_schedule_ordered" ON "shifts" IS
  'REQ-C-02: a shift ending at or before it starts must declare crosses_midnight.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- REQ-C-03: a structural floor under `weekly_off_patterns.config`.
--
-- `weekly-off.ts` says of this column that jsonb is "the one column type
-- Postgres will not constrain for us" and validates the full shape on every
-- read with `parseWeeklyOffConfig`. That stays: this constraint deliberately
-- does not attempt the weekday ranges or the strict key set, which belong in
-- the Zod schema where they can produce a field-level message.
--
-- What it does catch is the shape that makes the read-time validator throw for
-- everybody at once -- a JSON array, a bare string, a null written by a repair
-- script, an object with no `weekdays` at all -- turning a whole
-- organisation's day computation into an exception at the moment somebody
-- saves the wrong thing, rather than at 02:00 when the nightly sweep runs.
-- Cheap, and it cannot disagree with the read validator because it only rules
-- out what that validator could never accept either.
--
-- `jsonb_exists` is not decoration. `jsonb_typeof(config -> 'weekdays')` alone
-- returns SQL NULL for a missing key, a CHECK that evaluates to NULL passes,
-- and the constraint would have waved through exactly the row it was written
-- to stop. Observed, not theorised: the first version of this migration
-- accepted `{"saturdaysOfMonth": [2, 4]}`.
--
-- The function form rather than the `?` operator so nothing downstream -- a
-- driver, a migration splitter, a psql variable -- can mistake it for a
-- placeholder.
-- ---------------------------------------------------------------------------
ALTER TABLE "weekly_off_patterns"
  ADD CONSTRAINT "weekly_off_patterns_config_shape" CHECK (
    jsonb_typeof(config) = 'object'
    AND jsonb_exists(config, 'weekdays')
    AND jsonb_typeof(config -> 'weekdays') = 'array'
  );--> statement-breakpoint

COMMENT ON CONSTRAINT "weekly_off_patterns_config_shape" ON "weekly_off_patterns" IS
  'REQ-C-03: config is an object carrying a weekdays array. Full validation is parseWeeklyOffConfig.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The roster list (`GET /rosters?from=&to=`): every assignment in this
-- organisation that overlaps a period, for everybody.
--
-- 0004's three indexes cannot serve it. `shift_assignments_employee_idx` and
-- `shift_assignments_coverage_idx` both lead on `employee_id`, which the query
-- does not supply -- the screen asks for a department or for nobody in
-- particular -- and the gist index the exclusion constraint created is keyed
-- on `employee_id` too. Without this, listing a month's roster is a sequential
-- scan of every assignment the organisation has ever made.
--
-- Partial on `deleted_at` to match every other index on this table, so a
-- soft-deleted assignment costs nothing to skip (REQ-M-04).
-- ---------------------------------------------------------------------------
CREATE INDEX "shift_assignments_org_range_idx"
  ON "shift_assignments" ("org_id", "effective_from", "effective_to")
  WHERE "deleted_at" IS NULL;
