CREATE TABLE "voucher_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" text NOT NULL,
	"ledger_name" text,
	"is_deemed_positive" boolean,
	"stock_item_name" text,
	"stock_item_id" uuid,
	"actual_qty" text,
	"billed_qty" text,
	"rate" numeric,
	"amount" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"master_id" text,
	"alter_id" bigint DEFAULT 0 NOT NULL,
	"voucher_date" date NOT NULL,
	"voucher_type" text NOT NULL,
	"voucher_number" text DEFAULT '' NOT NULL,
	"party_name" text DEFAULT '' NOT NULL,
	"party_id" uuid,
	"narration" text DEFAULT '' NOT NULL,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"amount" numeric NOT NULL,
	"last_pulled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_lines_uq" ON "voucher_lines" USING btree ("voucher_id","line_no");--> statement-breakpoint
CREATE INDEX "voucher_lines_item_idx" ON "voucher_lines" USING btree ("stock_item_id");--> statement-breakpoint
CREATE INDEX "vouchers_org_date_idx" ON "vouchers" USING btree ("org_id","voucher_date");--> statement-breakpoint
CREATE INDEX "vouchers_org_type_date_idx" ON "vouchers" USING btree ("org_id","voucher_type","voucher_date");--> statement-breakpoint
CREATE INDEX "vouchers_party_idx" ON "vouchers" USING btree ("party_id","voucher_date");--> statement-breakpoint
CREATE INDEX "vouchers_org_number_idx" ON "vouchers" USING btree ("org_id","voucher_number");