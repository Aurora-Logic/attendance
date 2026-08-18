CREATE TYPE "public"."requirement_source" AS ENUM('shortage', 'reorder', 'manual');--> statement-breakpoint
CREATE TYPE "public"."requirement_state" AS ENUM('open', 'ordered', 'received', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dispatch_mode" AS ENUM('local_auto', 'local_own_vehicle', 'outstation');--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"reorder_level" numeric(16, 3),
	"minimum_order_qty" numeric(16, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "procurement_requirements" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"source" "requirement_source" NOT NULL,
	"sales_order_id" uuid,
	"sales_order_line_id" uuid,
	"needed_by" date,
	"state" "requirement_state" DEFAULT 'open' NOT NULL,
	"ordered_qty" numeric(16, 3) DEFAULT '0' NOT NULL,
	"received_qty" numeric(16, 3) DEFAULT '0' NOT NULL,
	"closed_reason" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "procurement_requirements_qty_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "dispatch_attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dispatch_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dispatch_lines_qty_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "dispatch_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient" text,
	"status" text NOT NULL,
	"composed_text" text NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"number" text NOT NULL,
	"mode" "dispatch_mode" NOT NULL,
	"dispatched_by" uuid,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lr_number" text,
	"transporter_name" text,
	"transporter_contact" text,
	"vehicle_number" text,
	"driver_name" text,
	"expected_delivery_date" date,
	"notes" text,
	"sync_state" "document_sync_state" DEFAULT 'NOT_PUSHED' NOT NULL,
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
CREATE TABLE "pack_record_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"pack_record_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pack_record_lines_qty_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "pack_records" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"box_count" integer DEFAULT 1 NOT NULL,
	"packed_by" uuid,
	"packed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sales_order_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"method" text NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD COLUMN "packed_qty" numeric(16, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD COLUMN "invoiced_qty" numeric(16, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD COLUMN "dispatched_qty" numeric(16, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "short_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "short_close_reason" text;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "customer_email" text;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "customer_whatsapp" text;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_settings" ADD CONSTRAINT "item_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_settings" ADD CONSTRAINT "item_settings_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requirements" ADD CONSTRAINT "procurement_requirements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_requirements" ADD CONSTRAINT "procurement_requirements_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attachments" ADD CONSTRAINT "dispatch_attachments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attachments" ADD CONSTRAINT "dispatch_attachments_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attachments" ADD CONSTRAINT "dispatch_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "dispatch_lines_line_id_sales_document_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."sales_document_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_notifications" ADD CONSTRAINT "dispatch_notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_notifications" ADD CONSTRAINT "dispatch_notifications_dispatch_id_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_document_id_sales_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sales_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_dispatched_by_employees_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_record_lines" ADD CONSTRAINT "pack_record_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_record_lines" ADD CONSTRAINT "pack_record_lines_pack_record_id_pack_records_id_fk" FOREIGN KEY ("pack_record_id") REFERENCES "public"."pack_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_record_lines" ADD CONSTRAINT "pack_record_lines_line_id_sales_document_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."sales_document_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_records" ADD CONSTRAINT "pack_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_records" ADD CONSTRAINT "pack_records_document_id_sales_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sales_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_records" ADD CONSTRAINT "pack_records_packed_by_employees_id_fk" FOREIGN KEY ("packed_by") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_invoices" ADD CONSTRAINT "sales_order_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_invoices" ADD CONSTRAINT "sales_order_invoices_document_id_sales_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sales_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_invoices" ADD CONSTRAINT "sales_order_invoices_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequences_uq" ON "document_sequences" USING btree ("org_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "item_settings_item_uq" ON "item_settings" USING btree ("stock_item_id");--> statement-breakpoint
CREATE INDEX "procurement_requirements_org_state_idx" ON "procurement_requirements" USING btree ("org_id","state") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "procurement_requirements_org_item_idx" ON "procurement_requirements" USING btree ("org_id","stock_item_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "procurement_requirements_order_idx" ON "procurement_requirements" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "dispatch_attachments_dispatch_idx" ON "dispatch_attachments" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "dispatch_lines_dispatch_idx" ON "dispatch_lines" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "dispatch_notifications_dispatch_idx" ON "dispatch_notifications" USING btree ("dispatch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatches_org_number_uq" ON "dispatches" USING btree ("org_id","number");--> statement-breakpoint
CREATE INDEX "dispatches_org_document_idx" ON "dispatches" USING btree ("org_id","document_id");--> statement-breakpoint
CREATE INDEX "dispatches_org_sync_idx" ON "dispatches" USING btree ("org_id","sync_state") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "pack_record_lines_line_idx" ON "pack_record_lines" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "pack_records_org_document_idx" ON "pack_records" USING btree ("org_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_invoices_voucher_uq" ON "sales_order_invoices" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "sales_order_invoices_document_idx" ON "sales_order_invoices" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_packed_le_ordered" CHECK (packed_qty >= 0 AND packed_qty <= quantity);--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_invoiced_le_packed" CHECK (invoiced_qty >= 0 AND invoiced_qty <= packed_qty);--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_dispatched_le_invoiced" CHECK (dispatched_qty >= 0 AND dispatched_qty <= invoiced_qty);