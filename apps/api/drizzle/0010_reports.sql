-- Phase 3, the report shell and export tray (REQ-J-01, REQ-J-03).
--
-- `export_jobs` and `saved_views` were created by migration 0001 and are not
-- recreated here. Three things were missing once the tray became real:
--
-- `format` says what was written. Text with a check rather than a second
-- Postgres enum, because 'XLSX' is a requirement this codebase cannot satisfy
-- yet -- no spreadsheet library is a dependency of the API -- and relaxing a
-- check when it can is one statement, where extending an enum type is an
-- ALTER TYPE that cannot run inside a transaction on older servers. The value
-- is already allowed here so that adding the writer needs no migration at all.
--
-- `progress` is REQ-J-03's "with progress". Bounded 0-100 in the database
-- rather than trusted from the worker: the tray renders it directly into a
-- progress bar, and a value of 4,000 from a division bug would render as a
-- filled bar on a job that has barely started.
--
-- `filename` is written when the job is queued, not when it finishes, so a
-- queued row in the tray already has a name to show instead of a placeholder
-- that changes under the reader.
--
-- The unique index on `saved_views` is the one thing here that is not additive
-- in spirit: without it, saving a view twice under the same name silently
-- makes two, and the reader has no way to tell them apart or to update one.
-- Lower-cased and partial on the living rows, following the convention in
-- `columns.ts` -- a soft-deleted view must not reserve its name forever.
--
-- Every statement is guarded, so re-running this migration is a no-op. That is
-- not decoration: this slice was built in parallel with four others, and the
-- file was applied by hand before the shared migration journal could safely be
-- written.
--
-- Reverse with:
--   DROP INDEX IF EXISTS "saved_views_name_unique_idx";
--   ALTER TABLE "export_jobs" DROP CONSTRAINT IF EXISTS "export_jobs_progress_range";
--   ALTER TABLE "export_jobs" DROP CONSTRAINT IF EXISTS "export_jobs_format_known";
--   ALTER TABLE "export_jobs" DROP COLUMN IF EXISTS "progress";
--   ALTER TABLE "export_jobs" DROP COLUMN IF EXISTS "filename";
--   ALTER TABLE "export_jobs" DROP COLUMN IF EXISTS "format";
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "format" text DEFAULT 'CSV' NOT NULL;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "filename" text;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "progress" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_jobs_format_known'
  ) THEN
    ALTER TABLE "export_jobs"
      ADD CONSTRAINT "export_jobs_format_known" CHECK ("format" IN ('CSV', 'XLSX'));
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_jobs_progress_range'
  ) THEN
    ALTER TABLE "export_jobs"
      ADD CONSTRAINT "export_jobs_progress_range" CHECK ("progress" BETWEEN 0 AND 100);
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "saved_views_name_unique_idx"
  ON "saved_views" USING btree ("org_id", "user_id", "report_key", lower("name"))
  WHERE "deleted_at" IS NULL;
