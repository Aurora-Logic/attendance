-- Phase 2, the approval framework (REQ-I-01 … REQ-I-05).
--
-- Migration 0004 already created `approval_requests` and `approval_steps` --
-- generic over a polymorphic (subject_type, subject_id) pair, which is the
-- part REQ-I-01 turns on and the part that lets the leave slice attach without
-- a schema change. This migration adds only what building the framework showed
-- those two tables were missing, plus the delegation table REQ-I-04 needs and
-- 0004 has no equivalent of. Recreating what 0004 already made would be the
-- wrong move twice over: the second definition would drift, and the drop in
-- the reverse would take the first one's data with it.
--
-- Four additions, and why each exists rather than being derived:
--
-- `subject_summary` is REQ-I-03's inbox line -- "Casual Leave, 24-08-2026 to
-- 25-08-2026, 2 days". Written by whoever raised the request. The alternative
-- is joining the five subject tables in the inbox query, and five branches in
-- one query is four separate inboxes wearing one URL, which is precisely what
-- REQ-I-01 forbids. NOT NULL with no default because an inbox row with no
-- statement of what is being asked is not a row anyone can act on; the guard
-- below is the honest way to say that, and it can only succeed on an empty
-- table. `approval_requests` is empty everywhere today -- nothing has ever
-- written one. If this raises, the fix is a backfill, not a weakened column.
--
-- `current_step_started_at` is what REQ-G-09's "untouched for N days" is
-- measured from. Deliberately not `updated_at`: any write touches that column,
-- so a notification flag flipped by a job would reset the escalation clock,
-- and the bug would be a request that never escalates while every column looks
-- correct.
--
-- `escalate_after_days` carries REQ-G-09's N on the request. The leave type
-- that supplied it can be edited afterwards, and a request must escalate on
-- the terms it was raised under rather than on terms someone changed later.
--
-- `acted_by_user_id` is the second half of REQ-I-04's "delegated actions record
-- both identities". `approver_user_id` stays the person the step was routed
-- to; `acted_by_user_id` is who actually clicked, and `delegated_from_user_id`
-- names the authority they borrowed. Without the new column a delegated
-- approval is indistinguishable from the approver having done it themselves.
--
-- Reverse with:
--   DROP TABLE "approval_delegations";
--   DROP INDEX "approval_requests_escalation_idx";
--   ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_acted_by_user_id_users_id_fk";
--   ALTER TABLE "approval_steps" DROP COLUMN "acted_by_user_id";
--   ALTER TABLE "approval_requests" DROP COLUMN "escalate_after_days";
--   ALTER TABLE "approval_requests" DROP COLUMN "current_step_started_at";
--   ALTER TABLE "approval_requests" DROP COLUMN "subject_summary";
-- Nothing here is destructive: every statement is CREATE or ADD.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "approval_requests") THEN
    RAISE EXCEPTION 'approval_requests already holds rows; subject_summary needs a backfill before it can be NOT NULL.';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "approval_requests" ADD COLUMN "subject_summary" text NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "current_step_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "escalate_after_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint

ALTER TABLE "approval_steps" ADD COLUMN "acted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_acted_by_user_id_users_id_fk" FOREIGN KEY ("acted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- The escalation sweep's index. `status` leads and `org_id` is absent on
-- purpose: the job asks "what is stale anywhere", once, across every
-- organisation, and a leading org_id would turn that into a scan per org.
CREATE INDEX "approval_requests_escalation_idx" ON "approval_requests" USING btree ("status","current_step_started_at");--> statement-breakpoint

-- REQ-I-04: "Delegation: an approver can delegate to another user for a date
-- range." A standing grant rather than a per-request handover, because the
-- case it exists for is an approver going on leave and the requests have not
-- arrived yet.
--
-- Nothing is copied onto a request when a delegation is created. Whether a
-- delegate may act is asked at decision time against today's date, so revoking
-- a delegation takes effect at once instead of leaving already-routed requests
-- answerable by someone whose authority was withdrawn.
CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "approval_delegations_range_ordered" CHECK (to_date >= from_date),
	CONSTRAINT "approval_delegations_not_self" CHECK (from_user_id <> to_user_id)
);
--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegations_delegate_idx" ON "approval_delegations" USING btree ("org_id","to_user_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX "approval_delegations_owner_idx" ON "approval_delegations" USING btree ("org_id","from_user_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Hand-written from here. Drizzle has no builder for an exclusion constraint,
-- so this is not in the snapshot and a future `drizzle-kit generate` will
-- neither recreate nor drop it -- the same arrangement migration 0004 made for
-- `shift_assignments_no_overlap`.
-- ---------------------------------------------------------------------------

-- One live delegation per (approver, delegate) pair per day.
--
-- Rejected by Postgres rather than by a service, for the reason 0004 gives on
-- the roster: a checked-then-written service loses to two concurrent requests,
-- and the duplicate that results is invisible -- both rows say the same thing,
-- so the delegate can act either way and nobody notices until the audit trail
-- is read. `[]` because both dates are inclusive: a delegation ending on the
-- 10th and another starting on the 10th do overlap.
--
-- Keyed on the pair rather than on from_user_id alone: an approver going away
-- may legitimately delegate to two people at once, and forbidding that would
-- be a rule nobody asked for.
--
-- Partial on revoked_at and deleted_at so a withdrawn delegation does not
-- permanently reserve its date range (REQ-M-04: rows are never really gone).
-- btree_gist, for the `uuid WITH =` operator class, was created in 0004.
ALTER TABLE "approval_delegations"
  ADD CONSTRAINT "approval_delegations_no_overlap"
  EXCLUDE USING gist (
    "from_user_id" WITH =,
    "to_user_id" WITH =,
    daterange("from_date", "to_date", '[]') WITH &&
  ) WHERE ("revoked_at" IS NULL AND "deleted_at" IS NULL);--> statement-breakpoint

COMMENT ON CONSTRAINT "approval_delegations_no_overlap" ON "approval_delegations" IS
  'REQ-I-04: one live delegation per approver-delegate pair per day.';
