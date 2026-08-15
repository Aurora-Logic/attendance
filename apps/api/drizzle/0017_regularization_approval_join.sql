-- REQ-F-01 … REQ-F-05 / REQ-I-01: the regularization / approvals join.
--
-- `regularizations.approval_request_id` and `on_duty_requests.approval_request_id`
-- have existed since migration 0004 and were always null, because this slice
-- decided on its own endpoints. They are populated from now on, in the same
-- transaction as the request itself, and this migration adds the two things the
-- database has to guarantee once that is true. It follows 0015, which did the
-- same job for leave.
--
-- 1. `regularizations_one_open_per_day_idx` has to cover ESCALATED
--
-- Migration 0016 scoped the index to `status = 'PENDING'`, which was the whole
-- of "open" while nothing could move a request anywhere else. REQ-G-09's
-- escalation sweep can now set a request to ESCALATED, and an ESCALATED request
-- is still in somebody's inbox and still decidable -- the shared contract's
-- `OPEN_APPROVAL_STATUSES` says so and the framework refuses to treat it as
-- terminal. Leaving the index on PENDING alone would mean that the moment the
-- timer moved a correction up a level, the same employee could raise a second
-- one for the same day, and both would be live. The service-side check
-- (`findOpenForDate`) is widened to match; this index is what makes the race
-- between two submissions impossible rather than merely unlikely.
--
-- Recreated rather than altered, because Postgres has no ALTER INDEX for a
-- partial predicate. Dropped and created in the same transaction, so there is
-- no window in which the invariant is unenforced.
--
-- 2. Two indexes on the new foreign key
--
-- The decision path resolves a request from its approval and back again. The
-- reverse direction already has `approval_requests_subject_idx`.
-- `leave_requests_approval_request_idx` is the same index for the same reason.
--
-- Neither statement rewrites a row, and all three are reversible.
--
-- Reverse with:
--   DROP INDEX IF EXISTS "on_duty_requests_approval_request_idx";
--   DROP INDEX IF EXISTS "regularizations_approval_request_idx";
--   DROP INDEX IF EXISTS "regularizations_one_open_per_day_idx";
--   CREATE UNIQUE INDEX "regularizations_one_open_per_day_idx"
--     ON "regularizations" USING btree ("org_id","employee_id","date")
--     WHERE "regularizations"."status" = 'PENDING' AND "regularizations"."deleted_at" IS NULL;

DROP INDEX IF EXISTS "regularizations_one_open_per_day_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "regularizations_one_open_per_day_idx"
  ON "regularizations" USING btree ("org_id","employee_id","date")
  WHERE "regularizations"."status" IN ('PENDING', 'ESCALATED')
    AND "regularizations"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regularizations_approval_request_idx"
  ON "regularizations" ("org_id", "approval_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "on_duty_requests_approval_request_idx"
  ON "on_duty_requests" ("org_id", "approval_request_id");
