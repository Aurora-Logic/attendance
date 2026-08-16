DROP INDEX "sync_jobs_claim_idx";--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "last_condition" text;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_token_uq" ON "integration_connections" USING btree ("agent_token_hash") WHERE agent_token_hash IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_company_uq" ON "integration_connections" USING btree ("org_id","system","company_guid") WHERE company_guid IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sync_jobs_claim_idx" ON "sync_jobs" USING btree ("connection_id","state","created_at");--> statement-breakpoint
COMMENT ON COLUMN integration_connections.last_condition IS
  'REQ-Q-05: the specific problem the last heartbeat carried, reported or derived, so ERROR names its fix.';
