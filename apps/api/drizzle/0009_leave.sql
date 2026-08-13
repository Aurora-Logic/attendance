-- Phase 2: what the leave slice needs that migration 0004 could not know yet.
--
-- 0004 created every leave table (technical design section 4.2) and the
-- append-only trigger on `leave_ledger`. It did not, and could not, express the
-- four things below, because each of them is a consequence of how the slice
-- actually posts movements rather than of the table shapes:
--
--   1. THE INVARIANT, as a check constraint. REQ-G-03 says the six numbers on
--      a balance are a ledger projection. A projection that can drift is a
--      second source of truth, so the database refuses a row where
--      closing <> opening + accrued - availed + adjusted + carried_forward.
--   2. An idempotency key for the scheduled accrual and carry-forward jobs.
--      Those jobs retry (queue.registry: five attempts), and a monthly accrual
--      posted twice cannot be un-posted -- the ledger is append-only, so the
--      correction would be a third row and the balance would still be wrong
--      for whoever read it in between. `period_key` makes the second post fail
--      at the database rather than succeed quietly.
--   3. The comp-off credit's link to the leave type it credits, and the two
--      fields REQ-G-11 needs to keep an expiring credit from vanishing
--      silently: when it lapsed, and which warning has already gone out.
--   4. Who decided a leave request and why. The contract exposes `decidedBy`
--      and REQ-F-05 makes a rejection reason mandatory; `updated_by` cannot
--      carry either, because an unrelated edit overwrites it.
--
-- Nothing here is destructive: every statement is ADD or CREATE, and no
-- existing column changes type or nullability.
--
-- Reverse with:
--   DROP INDEX "comp_off_credits_pending_lapse_idx";
--   DROP INDEX "leave_ledger_period_uq";
--   ALTER TABLE "leave_requests" DROP COLUMN "decision_reason";
--   ALTER TABLE "leave_requests" DROP COLUMN "cancellation_reason";
--   ALTER TABLE "leave_requests" DROP COLUMN "decided_by";
--   ALTER TABLE "leave_requests" DROP COLUMN "decided_at";
--   ALTER TABLE "comp_off_credits" DROP COLUMN "expiry_warned_days";
--   ALTER TABLE "comp_off_credits" DROP COLUMN "lapsed_at";
--   ALTER TABLE "comp_off_credits" DROP CONSTRAINT "comp_off_credits_leave_type_id_leave_types_id_fk";
--   ALTER TABLE "comp_off_credits" DROP COLUMN "leave_type_id";
--   ALTER TABLE "leave_ledger" DROP COLUMN "period_key";
--   ALTER TABLE "leave_balances" DROP CONSTRAINT "leave_balances_closing_is_the_sum";

-- ---------------------------------------------------------------------------
-- 1. THE INVARIANT (REQ-G-03).
--
-- `availed` is stored as a positive quantity taken, which is why it is
-- subtracted; the ledger underneath stores an AVAILED movement as a negative
-- row. The two directions meet here and in `projectLedger` on the server, and
-- this constraint is what stops them meeting only in the comments.
--
-- numeric(6,2) arithmetic is exact, so this is an equality and not a
-- tolerance. Every existing row is all zeroes, which satisfies it.
--
-- Written as a table constraint rather than a trigger deliberately: a
-- constraint is checked on every path into the table, including a repair
-- script run by hand at midnight, which is exactly when the balance would
-- otherwise be edited without its ledger.
-- ---------------------------------------------------------------------------
ALTER TABLE "leave_balances"
  ADD CONSTRAINT "leave_balances_closing_is_the_sum"
  CHECK (closing = opening + accrued - availed + adjusted + carried_forward);--> statement-breakpoint

COMMENT ON CONSTRAINT "leave_balances_closing_is_the_sum" ON "leave_balances" IS
  'REQ-G-03: closing = opening + accrued - availed + adjusted + carried forward.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Exactly-once posting for the scheduled jobs (REQ-G-05, REQ-G-01).
--
-- `period_key` names the period a job-posted movement is for: '2026-04' for
-- April's monthly accrual, '2026' for a yearly one, '2026->2027' for a carry
-- forward. It is NULL for every movement caused by a person -- an availed, an
-- adjustment, a reversal -- and the index is partial so those are unaffected.
--
-- The index includes `movement_type` so that a LAPSE and an ACCRUAL for the
-- same period are distinct rows, and excludes `days` so that a retry posting a
-- *different* amount for the same period is refused rather than accepted as a
-- second movement.
-- ---------------------------------------------------------------------------
ALTER TABLE "leave_ledger" ADD COLUMN "period_key" text;--> statement-breakpoint

CREATE UNIQUE INDEX "leave_ledger_period_uq"
  ON "leave_ledger" USING btree
  ("org_id","employee_id","leave_type_id","leave_year","movement_type","period_key")
  WHERE period_key IS NOT NULL;--> statement-breakpoint

COMMENT ON COLUMN "leave_ledger"."period_key" IS
  'Set only by a scheduled job, and unique per movement: the accrual for April 2026 can be posted once.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Comp-off credits (REQ-G-11).
--
-- `leave_type_id` is NOT NULL without a default. The column can be added that
-- way because `comp_off_credits` has never been written to: 0004 created the
-- table and this migration ships the first code that inserts into it. If a
-- database somewhere does hold rows, this statement fails loudly, which is the
-- right outcome -- a credit that credits no particular type is a balance
-- movement nobody can reconcile, and a backfilled guess would be worse than a
-- stopped deploy.
--
-- RESTRICT on the type, matching every other leave foreign key: retiring
-- Compensatory Off while credits are outstanding has to be a deliberate act.
-- ---------------------------------------------------------------------------
ALTER TABLE "comp_off_credits" ADD COLUMN "leave_type_id" uuid NOT NULL;--> statement-breakpoint

ALTER TABLE "comp_off_credits"
  ADD CONSTRAINT "comp_off_credits_leave_type_id_leave_types_id_fk"
  FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id")
  ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- REQ-G-11: "expired credits appear on a report rather than vanishing
-- silently". Set when the sweep posts the LAPSE ledger row, and the reason the
-- sweep is idempotent: a credit is lapsed once, and the row that says so
-- survives.
ALTER TABLE "comp_off_credits" ADD COLUMN "lapsed_at" timestamp with time zone;--> statement-breakpoint

-- The smallest warning threshold already sent, in days: 7, then 2. An integer
-- rather than two booleans so that adding a third threshold later is a change
-- to the job and not to the table.
ALTER TABLE "comp_off_credits" ADD COLUMN "expiry_warned_days" integer;--> statement-breakpoint

-- 0004's `comp_off_credits_expiry_idx` covers the whole table. The sweep only
-- ever looks at credits that are still standing, and on a table that
-- accumulates a year of lapsed rows that is the difference between an index
-- scan and a filter over all of them.
CREATE INDEX "comp_off_credits_pending_lapse_idx"
  ON "comp_off_credits" USING btree ("org_id","expires_on")
  WHERE lapsed_at IS NULL AND consumed_by_leave_request_id IS NULL AND deleted_at IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. The decision on a leave request (REQ-G-09, REQ-G-10, REQ-F-05).
--
-- Separate from `updated_by` because that column moves on any edit -- an
-- attachment added after approval would rewrite who approved it.
--
-- `decided_by` carries no foreign key to `users`, for the reason `columns.ts`
-- gives for `created_by`: a decision can be recorded by a background
-- escalation where there is no acting user, and `audit_logs` is the
-- authoritative actor trail either way.
--
-- The check pairs the two: a request cannot claim a decision time without a
-- decider, which is the shape a partial write would leave behind.
-- ---------------------------------------------------------------------------
ALTER TABLE "leave_requests" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_decision_is_attributed"
  CHECK ((decided_at IS NULL) = (decided_by IS NULL));--> statement-breakpoint

COMMENT ON CONSTRAINT "leave_requests_decision_is_attributed" ON "leave_requests" IS
  'REQ-G-09: a decided request names who decided it.';
