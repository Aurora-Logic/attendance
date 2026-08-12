-- Phase 1, the punch endpoint: the three things a punch records that migration
-- 0004 left nowhere to put.
--
-- `thumbnail_file_id` is REQ-D-03a's second object per punch. NOT NULL because
-- the requirement is that every list loads a thumbnail and never the full
-- image; a nullable column is a column every list has to write a fallback for,
-- and the fallback is the failure the requirement names. Both objects are
-- written before the punch row, so no punch can exist with only one of them.
--
-- `flags` carries the REQ-D-08 / REQ-D-08a / REQ-D-05 verdicts that have no
-- column of their own -- low_gps_accuracy, no_location, clock_skew,
-- field_staff_exempt, and the two "this control is not configured yet" flags
-- that keep an unchecked punch from reading like a checked one while the
-- office coordinates and IP addresses are still unanswered (docs
-- OPEN-QUESTIONS items 1 and 3). outside_window, outside_geofence and
-- device_mismatch keep their existing booleans, because the day engine reads
-- those as typed facts and storing them twice would be one fact too many to
-- keep in step.
--
-- `sync_delay_seconds` is REQ-D-10's "the delay is recorded and shown in
-- reports". It is deliberately not clock_skew_seconds: on a queued punch the
-- same subtraction measures how long the phone was offline rather than how
-- wrong its clock is, and conflating them would flag every offline punch as a
-- tampered clock.
--
-- The guard below is the honest way to add a NOT NULL column with no default:
-- it can only succeed on an empty table, and it says so rather than failing
-- later with a constraint violation nobody can act on. `punches` is empty
-- everywhere today -- no endpoint has ever written one. If this ever raises,
-- the fix is a backfill, not a weakened constraint.
--
-- Reverse with:
--   ALTER TABLE "punches" DROP CONSTRAINT "punches_thumbnail_file_id_files_id_fk";
--   ALTER TABLE "punches" DROP COLUMN "sync_delay_seconds";
--   ALTER TABLE "punches" DROP COLUMN "flags";
--   ALTER TABLE "punches" DROP COLUMN "thumbnail_file_id";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "punches") THEN
    RAISE EXCEPTION 'punches already holds rows; thumbnail_file_id needs a backfill before it can be NOT NULL.';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "punches" ADD COLUMN "thumbnail_file_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "punches" ADD COLUMN "flags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "punches" ADD COLUMN "sync_delay_seconds" integer;--> statement-breakpoint
ALTER TABLE "punches" ADD CONSTRAINT "punches_thumbnail_file_id_files_id_fk" FOREIGN KEY ("thumbnail_file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;
