CREATE TABLE "sync_inbox" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"result" text NOT NULL,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "webhook_secret_enc" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "webhook_install_id" text;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "closing_qty" numeric;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "sale_price" numeric;--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN "cost_price" numeric;--> statement-breakpoint
ALTER TABLE "sync_inbox" ADD CONSTRAINT "sync_inbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_inbox" ADD CONSTRAINT "sync_inbox_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_inbox_event_uq" ON "sync_inbox" USING btree ("connection_id","event_id");--> statement-breakpoint
CREATE INDEX "sync_inbox_deferred_idx" ON "sync_inbox" USING btree ("connection_id","received_at") WHERE payload IS NOT NULL;