CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"alias" text,
	"parent_group" text NOT NULL,
	"gstin" text,
	"address" text,
	"credit_limit" numeric,
	"credit_days" integer,
	"opening_balance" numeric,
	"absent_in_tally" boolean DEFAULT false NOT NULL,
	"last_pulled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parties_connection_idx" ON "parties" USING btree ("connection_id","name");--> statement-breakpoint
CREATE INDEX "parties_org_name_idx" ON "parties" USING btree ("org_id","name");