-- REQ-F-01 … REQ-F-05: the write side of regularization and on-duty.
--
-- Migration 0004 created `regularizations`, `attendance_adjustments` and
-- `on_duty_requests` with a `status` column and nothing else about the
-- decision. That is enough to record *that* a request was refused and not
-- enough to satisfy REQ-F-05, which says "rejection requires a reason. The
-- employee is notified with it" -- a reason that exists only inside a
-- notification cannot be read back on the employee's own list a week later,
-- and the audit trail is not a place an employee can look.
--
-- Three columns on each request table, matching `leave_requests` exactly so
-- the two request kinds read the same way everywhere they are joined:
--
--   `decided_at`       when the approver acted. Separate from `updated_at`,
--                      which moves on any edit.
--   `decided_by`       who acted. Separate from `updated_by` for the same
--                      reason: attaching an attachment after a decision would
--                      otherwise rewrite who made it.
--   `decision_reason`  REQ-F-05's reason. Mandatory on a rejection; the
--                      service enforces that, not the column, because a
--                      NOT NULL here would also demand one on an approval.
--
-- The check constraint pins the pair that must move together. A row with a
-- decision time and no decider is unattributable, and it is the shape a
-- half-finished write would leave behind.
--
-- The partial unique index is the invariant that stops the same day being
-- regularized twice in parallel. REQ-F-02's monthly cap is counted in the
-- service and a count is not a lock: two requests submitted a millisecond
-- apart both read "2 raised this month" and both pass. Scoped to PENDING so a
-- rejected request does not block a corrected re-raise for the same date,
-- which is the ordinary way this feature is used.
--
-- Reverse with:
--   DROP INDEX "regularizations_one_open_per_day_idx";
--   DROP INDEX "regularizations_status_idx";
--   ALTER TABLE "regularizations" DROP CONSTRAINT "regularizations_decision_is_attributed";
--   ALTER TABLE "regularizations" DROP COLUMN "decision_reason";
--   ALTER TABLE "regularizations" DROP COLUMN "decided_by";
--   ALTER TABLE "regularizations" DROP COLUMN "decided_at";
--   ALTER TABLE "on_duty_requests" DROP CONSTRAINT "on_duty_requests_decision_is_attributed";
--   ALTER TABLE "on_duty_requests" DROP COLUMN "decision_reason";
--   ALTER TABLE "on_duty_requests" DROP COLUMN "decided_by";
--   ALTER TABLE "on_duty_requests" DROP COLUMN "decided_at";
ALTER TABLE "regularizations" ADD COLUMN "decided_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "regularizations" ADD COLUMN "decided_by" uuid;
--> statement-breakpoint
ALTER TABLE "regularizations" ADD COLUMN "decision_reason" text;
--> statement-breakpoint
ALTER TABLE "regularizations" ADD CONSTRAINT "regularizations_decision_is_attributed" CHECK ((decided_at IS NULL) = (decided_by IS NULL));
--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD COLUMN "decided_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD COLUMN "decided_by" uuid;
--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD COLUMN "decision_reason" text;
--> statement-breakpoint
ALTER TABLE "on_duty_requests" ADD CONSTRAINT "on_duty_requests_decision_is_attributed" CHECK ((decided_at IS NULL) = (decided_by IS NULL));
--> statement-breakpoint
CREATE INDEX "regularizations_status_idx" ON "regularizations" USING btree ("org_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "regularizations_one_open_per_day_idx" ON "regularizations" USING btree ("org_id","employee_id","date") WHERE "regularizations"."status" = 'PENDING' AND "regularizations"."deleted_at" IS NULL;
