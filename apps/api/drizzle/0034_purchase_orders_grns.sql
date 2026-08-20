CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."purchase_sync_state" AS ENUM('NOT_PUSHED', 'QUEUED', 'PUSHED', 'FAILED');--> statement-breakpoint
CREATE TABLE "grn_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"grn_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"received_qty" numeric(16, 3) DEFAULT '0' NOT NULL,
	"rejected_qty" numeric(16, 3) DEFAULT '0' NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "grn_lines_something_received" CHECK (received_qty + rejected_qty > 0),
	CONSTRAINT "grn_lines_rejection_reasoned" CHECK (rejected_qty = 0 OR rejection_reason IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "grns" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vendor_invoice_ref" text,
	"notes" text,
	"sync_state" "purchase_sync_state" DEFAULT 'NOT_PUSHED' NOT NULL,
	"remote_guid" text,
	"remote_voucher_number" text,
	"push_job_id" uuid,
	"last_pushed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_vendors" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"lead_time_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "po_line_requirements" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"allocated_qty" numeric(16, 3) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"stock_item_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"unit" text,
	"rate" numeric(16, 2) NOT NULL,
	"tax_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"tax_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"received_qty" numeric(16, 3) DEFAULT '0' NOT NULL,
	"rejected_qty" numeric(16, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "purchase_order_lines_received_le_ordered" CHECK (received_qty >= 0 AND rejected_qty >= 0 AND received_qty + rejected_qty <= quantity)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "purchase_order_status" DEFAULT 'DRAFT' NOT NULL,
	"date" date NOT NULL,
	"party_id" uuid NOT NULL,
	"vendor_name" text NOT NULL,
	"sales_order_id" uuid,
	"expected_date" date,
	"owner_id" uuid,
	"notes" text,
	"subtotal" numeric(16, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"approval_request_id" uuid,
	"sync_state" "purchase_sync_state" DEFAULT 'NOT_PUSHED' NOT NULL,
	"remote_guid" text,
	"remote_voucher_number" text,
	"push_job_id" uuid,
	"last_pushed_at" timestamp with time zone,
	"last_error" text,
	"short_closed_at" timestamp with time zone,
	"short_close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grn_id_grns_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_received_by_employees_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_vendors" ADD CONSTRAINT "item_vendors_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_requirements" ADD CONSTRAINT "po_line_requirements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_requirements" ADD CONSTRAINT "po_line_requirements_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_line_requirements" ADD CONSTRAINT "po_line_requirements_requirement_id_procurement_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."procurement_requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_owner_id_employees_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grn_lines_grn_idx" ON "grn_lines" USING btree ("grn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grns_org_number_uq" ON "grns" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "grns_org_po_idx" ON "grns" USING btree ("org_id","purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_vendors_item_party_uq" ON "item_vendors" USING btree ("stock_item_id","party_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "item_vendors_item_preferred_uq" ON "item_vendors" USING btree ("stock_item_id") WHERE is_preferred AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "po_line_requirements_uq" ON "po_line_requirements" USING btree ("purchase_order_line_id","requirement_id");--> statement-breakpoint
CREATE INDEX "po_line_requirements_req_idx" ON "po_line_requirements" USING btree ("requirement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_po_line_uq" ON "purchase_order_lines" USING btree ("purchase_order_id","line_no");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_org_item_idx" ON "purchase_order_lines" USING btree ("org_id","stock_item_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_org_number_uq" ON "purchase_orders" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "purchase_orders_org_status_idx" ON "purchase_orders" USING btree ("org_id","status") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "purchase_orders_org_party_idx" ON "purchase_orders" USING btree ("org_id","party_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "purchase_orders_sales_order_idx" ON "purchase_orders" USING btree ("sales_order_id");