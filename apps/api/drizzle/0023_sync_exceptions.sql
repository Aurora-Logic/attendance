CREATE TYPE "public"."sync_exception_state" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TABLE "sync_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"tally_error" text NOT NULL,
	"state" "sync_exception_state" DEFAULT 'OPEN' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "sync_exceptions" ADD CONSTRAINT "sync_exceptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_exceptions" ADD CONSTRAINT "sync_exceptions_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_exceptions_org_state_idx" ON "sync_exceptions" USING btree ("org_id","state","created_at");--> statement-breakpoint
CREATE INDEX "sync_exceptions_connection_idx" ON "sync_exceptions" USING btree ("connection_id","state");