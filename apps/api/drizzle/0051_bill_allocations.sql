CREATE TABLE "bill_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"party_id" uuid,
	"party_name" text DEFAULT '' NOT NULL,
	"bill_name" text NOT NULL,
	"ref_type" text NOT NULL,
	"bill_date" date,
	"due_date" date,
	"amount" numeric NOT NULL,
	"last_pulled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_allocations_party_idx" ON "bill_allocations" USING btree ("org_id","party_id","bill_date");--> statement-breakpoint
CREATE INDEX "bill_allocations_bill_idx" ON "bill_allocations" USING btree ("org_id","party_name","bill_name");--> statement-breakpoint
CREATE INDEX "bill_allocations_voucher_idx" ON "bill_allocations" USING btree ("voucher_id");