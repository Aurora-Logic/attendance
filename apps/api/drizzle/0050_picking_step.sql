CREATE TABLE "pick_record_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"pick_record_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pick_record_lines_qty_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "pick_records" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"picked_by" uuid,
	"picked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sales_document_lines" DROP CONSTRAINT "sales_document_lines_packed_le_ordered";--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD COLUMN "picked_qty" numeric(16, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
--> D-48: a pack implied a pick, so existing rows are picked at least as much as they were packed.
UPDATE "sales_document_lines" SET "picked_qty" = "packed_qty" WHERE "packed_qty" > "picked_qty";--> statement-breakpoint
ALTER TABLE "pick_record_lines" ADD CONSTRAINT "pick_record_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_record_lines" ADD CONSTRAINT "pick_record_lines_pick_record_id_pick_records_id_fk" FOREIGN KEY ("pick_record_id") REFERENCES "public"."pick_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_record_lines" ADD CONSTRAINT "pick_record_lines_line_id_sales_document_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."sales_document_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_records" ADD CONSTRAINT "pick_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_records" ADD CONSTRAINT "pick_records_document_id_sales_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sales_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_records" ADD CONSTRAINT "pick_records_picked_by_employees_id_fk" FOREIGN KEY ("picked_by") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pick_record_lines_pick_idx" ON "pick_record_lines" USING btree ("pick_record_id");--> statement-breakpoint
CREATE INDEX "pick_records_org_document_idx" ON "pick_records" USING btree ("org_id","document_id");--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_picked_le_ordered" CHECK (picked_qty >= 0 AND picked_qty <= quantity);--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_packed_le_picked" CHECK (packed_qty >= 0 AND packed_qty <= picked_qty);