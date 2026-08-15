-- REQ-J-05: scheduled exports, delivered to the Downloads tray.
--
-- The requirement says a saved report configuration can be *emailed* daily,
-- weekly or monthly. This deployment has no mail transport -- it was removed
-- deliberately, because the pilot has no mail server -- so a run produces
-- exactly what the Export button produces, into the same tray, with the same
-- seven-day retention on `files.expires_at` and the same signed download. Only
-- what starts the job differs. `packages/shared/src/reports.ts` carries the
-- full reasoning beside the contract.
--
-- Three things worth stating about the shape:
--
-- 1. No `from` or `to` in `filters`
--
-- The period a run covers is derived from the cadence when it runs, never
-- stored. A schedule created in August with a stored range would export the
-- same fortnight for ever, and would look healthy doing it: a file arrives, it
-- has rows, and nothing anywhere is in an error state.
--
-- 2. `day_of_month` is capped at 28
--
-- A monthly schedule set to the 30th would never run in February, and one set
-- to the 31st would skip five months a year, silently. Anyone who wants "the
-- end of the month" wants the month that has just finished, which is what the
-- 1st already gives them.
--
-- 3. `last_run_on` is a date, not an instant
--
-- It is the idempotency key. The sweep runs every fifteen minutes, so without
-- it a schedule set for 06:00 would fire again at 06:15 and at every sweep
-- until midnight. A date answers "has it run today"; an instant would need a
-- window comparison that is wrong twice a year wherever the clocks change.
--
-- `owner_user_id` cascades, unlike `export_jobs.requested_by` which restricts.
-- A produced file is a record that must survive its requester leaving; a
-- schedule with no owner is a timer nobody can see, edit or stop.
--
-- Nothing here rewrites a row and every statement is reversible.
--
-- Reverse with:
--   DROP TABLE IF EXISTS "report_schedules";
--   DROP TYPE IF EXISTS "report_schedule_cadence";

DO $$ BEGIN
  CREATE TYPE "report_schedule_cadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_schedules" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE restrict,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "report_key" text NOT NULL,
  "name" text NOT NULL,
  "filters" jsonb NOT NULL,
  "columns" jsonb NOT NULL,
  "sort" text,
  "format" text DEFAULT 'XLSX' NOT NULL,
  "cadence" "report_schedule_cadence" NOT NULL,
  "hour" smallint NOT NULL,
  "minute" smallint DEFAULT 0 NOT NULL,
  "weekday" smallint,
  "day_of_month" smallint,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_run_on" date,
  "last_export_job_id" uuid REFERENCES "export_jobs"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "report_schedules_format_check" CHECK ("format" IN ('CSV', 'XLSX')),
  CONSTRAINT "report_schedules_hour_check" CHECK ("hour" BETWEEN 0 AND 23),
  CONSTRAINT "report_schedules_minute_check" CHECK ("minute" BETWEEN 0 AND 59),
  CONSTRAINT "report_schedules_weekday_check" CHECK ("weekday" IS NULL OR "weekday" BETWEEN 1 AND 7),
  CONSTRAINT "report_schedules_day_of_month_check"
    CHECK ("day_of_month" IS NULL OR "day_of_month" BETWEEN 1 AND 28),
  -- A cadence without the field it needs is a schedule that can never fire.
  -- The service refuses it first; this is what stops a repair script or a
  -- future writer creating one nobody would ever see run.
  CONSTRAINT "report_schedules_cadence_fields_check" CHECK (
    ("cadence" = 'WEEKLY' AND "weekday" IS NOT NULL)
    OR ("cadence" = 'MONTHLY' AND "day_of_month" IS NOT NULL)
    OR "cadence" = 'DAILY'
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_owner_idx"
  ON "report_schedules" ("org_id", "owner_user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_due_idx"
  ON "report_schedules" ("org_id", "cadence")
  WHERE "is_active" AND "deleted_at" IS NULL;
