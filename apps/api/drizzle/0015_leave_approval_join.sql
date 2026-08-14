-- REQ-G-03 / REQ-G-09 / REQ-I-01: the leave / approvals join.
--
-- `leave_requests.approval_request_id` has existed since migration 0004 and was
-- always null, because nothing raised a leave request into the approval
-- framework. It is populated from now on, in the same transaction as the leave
-- request itself, and this migration adds the two things the database has to
-- guarantee once that is true.
--
-- 1. `leave_ledger_request_movement_uq`
--
-- The AVAILED row that an approval writes, and the REVERSAL row a cancellation
-- writes, are each one-per-request by definition: a request is approved once
-- and, having been approved, is cancelled once. Before this join the ledger
-- write lived on the leave endpoint and its only protection was a status check
-- read a statement earlier -- two approvals arriving together could both read
-- PENDING and both deduct. The framework's compare-and-swap on
-- `approval_requests` now makes exactly one of them the winner, and this index
-- is what makes the loser impossible rather than merely unlikely.
--
-- It is deliberately narrow: `reference_type = 'leave_request'` only, so the
-- comp-off accrual and the manual adjustment -- which legitimately repeat for
-- one employee and type -- are untouched. `deleted_at` plays no part because
-- `leave_ledger` has no soft delete; the table refuses UPDATE and DELETE
-- outright (migration 0004's trigger).
--
-- `appendLedger` inserts with ON CONFLICT DO NOTHING, so a violation here does
-- not raise -- it writes nothing and reports zero rows, and `LeaveService`
-- refuses the decision on anything but one. The index and that check are one
-- mechanism: the index makes the second row impossible, the check makes the
-- silence audible.
--
-- Numbered 0015 rather than 0014: `0014_punch_effective_time` reached main
-- first, and the README is explicit that filename order, array order and
-- `when` order must all agree or a fresh database applies migrations in a
-- sequence nobody wrote.
--
-- 2. `leave_requests_approval_request_idx`
--
-- The decision path resolves a leave request from its approval and back again.
-- The reverse direction already has `approval_requests_subject_idx`.
--
-- Neither statement rewrites a row, and both are reversible.
--
-- Reverse with:
--   DROP INDEX IF EXISTS "leave_requests_approval_request_idx";
--   DROP INDEX IF EXISTS "leave_ledger_request_movement_uq";

CREATE UNIQUE INDEX IF NOT EXISTS "leave_ledger_request_movement_uq"
  ON "leave_ledger" ("org_id", "reference_id", "movement_type")
  WHERE "reference_type" = 'leave_request' AND "reference_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leave_requests_approval_request_idx"
  ON "leave_requests" ("org_id", "approval_request_id");
