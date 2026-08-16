-- Phase 6b, slice 1: the sync engine's tables (09 §4.2) and the columns that
-- turn `external_refs` from a note into a sync anchor (09 §4.1).
--
-- Hand-written, like every migration since 0005. drizzle-kit's snapshot had
-- not been maintained since then, so `db:generate` proposed re-creating half
-- the schema; the snapshot regenerated alongside this migration is accurate
-- again, so the next `db:generate` diffs against reality.
--
-- Everything here is additive. Phase 0 rows in the altered tables carry NULL
-- in every new column, which is also what the columns mean: never synced.

CREATE TYPE "public"."sync_direction" AS ENUM('PULL', 'PUSH');--> statement-breakpoint
CREATE TYPE "public"."sync_job_state" AS ENUM('QUEUED', 'CLAIMED', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."tally_sync_state" AS ENUM('draft', 'queued', 'pushed', 'failed', 'voided_in_tally');--> statement-breakpoint

CREATE TABLE "sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"last_alter_id" bigint DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"company_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"direction" "sync_direction" NOT NULL,
	"entity_type" text NOT NULL,
	"payload" jsonb,
	"state" "sync_job_state" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "sync_journal" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"direction" "sync_direction" NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"request_hash" text NOT NULL,
	"response_hash" text,
	"request_body" text,
	"response_body" text,
	"result" text,
	"error_code" text,
	"error_text" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_journal" ADD CONSTRAINT "sync_journal_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_journal" ADD CONSTRAINT "sync_journal_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursors_uq" ON "sync_cursors" USING btree ("connection_id","entity_type");--> statement-breakpoint
CREATE INDEX "sync_jobs_claim_idx" ON "sync_jobs" USING btree ("connection_id","state");--> statement-breakpoint
CREATE INDEX "sync_journal_connection_idx" ON "sync_journal" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_journal_sweep_idx" ON "sync_journal" USING btree ("created_at");--> statement-breakpoint

ALTER TABLE "external_refs" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "external_refs" ADD COLUMN "remote_voucher_number" text;--> statement-breakpoint
ALTER TABLE "external_refs" ADD COLUMN "remote_voucher_type" text;--> statement-breakpoint
ALTER TABLE "external_refs" ADD COLUMN "sync_state" "tally_sync_state";--> statement-breakpoint
ALTER TABLE "external_refs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "external_refs" ADD COLUMN "last_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_refs" ADD COLUMN "last_pulled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_refs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_refs_idempotency_uq" ON "external_refs" USING btree ("connection_id","idempotency_key") WHERE connection_id IS NOT NULL AND idempotency_key IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint

ALTER TABLE "integration_connections" ADD COLUMN "company_guid" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "fy_from" date;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "fy_to" date;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "agent_version" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "tally_version" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "lease_holder" text;--> statement-breakpoint

-- REQ-T-06: the journal joins punches, leave_ledger and audit_logs as
-- trigger-enforced append-only -- with one narrow exception the others do not
-- have. D-20 keeps request/response bodies for 30 days and hashes for ever,
-- so the retention sweep must be able to null the two body columns, and must
-- be able to do nothing else. A row-level guard expresses exactly that: an
-- UPDATE may set request_body/response_body to NULL and may touch nothing
-- else. DELETE and TRUNCATE get the same statement-level refusal as the
-- other evidence tables.
CREATE OR REPLACE FUNCTION vyuha_sync_journal_guard()
RETURNS trigger
AS $$
BEGIN
  IF (NEW.request_body IS NOT NULL AND NEW.request_body IS DISTINCT FROM OLD.request_body)
     OR (NEW.response_body IS NOT NULL AND NEW.response_body IS DISTINCT FROM OLD.response_body) THEN
    RAISE EXCEPTION
      'Table sync_journal is append-only; UPDATE may only clear request_body/response_body (the D-20 retention sweep), never rewrite them.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF ROW(NEW.id, NEW.org_id, NEW.connection_id, NEW.direction, NEW.entity_type, NEW.entity_id,
         NEW.request_hash, NEW.response_hash, NEW.result, NEW.error_code, NEW.error_text,
         NEW.duration_ms, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.org_id, OLD.connection_id, OLD.direction, OLD.entity_type, OLD.entity_id,
         OLD.request_hash, OLD.response_hash, OLD.result, OLD.error_code, OLD.error_text,
         OLD.duration_ms, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION
      'Table sync_journal is append-only; UPDATE may only clear the body columns. The hash is the evidence and it does not expire.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$
LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER sync_journal_update_guard
  BEFORE UPDATE ON sync_journal
  FOR EACH ROW
  EXECUTE FUNCTION vyuha_sync_journal_guard();--> statement-breakpoint

CREATE TRIGGER sync_journal_no_delete
  BEFORE DELETE ON sync_journal
  FOR EACH STATEMENT
  EXECUTE FUNCTION vyuha_forbid_mutation();--> statement-breakpoint

-- TRUNCATE bypasses UPDATE/DELETE triggers entirely, so it needs its own.
CREATE TRIGGER sync_journal_no_truncate
  BEFORE TRUNCATE ON sync_journal
  FOR EACH STATEMENT
  EXECUTE FUNCTION vyuha_forbid_mutation();--> statement-breakpoint

COMMENT ON TABLE sync_journal IS
  'Append-only (REQ-T-06). Guarded by sync_journal_update_guard; only the D-20 body sweep may update, and only to NULL.';
