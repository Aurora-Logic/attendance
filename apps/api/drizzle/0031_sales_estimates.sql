CREATE TYPE "public"."estimate_status" AS ENUM('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."sales_document_type" AS ENUM('ESTIMATE');--> statement-breakpoint
CREATE TABLE "sales_document_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"stock_item_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"unit" text,
	"rate" numeric(16, 2) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"tax_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sales_document_sequences" (
	"org_id" uuid NOT NULL,
	"doc_type" "sales_document_type" NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"doc_type" "sales_document_type" NOT NULL,
	"number" text NOT NULL,
	"status" "estimate_status" DEFAULT 'DRAFT' NOT NULL,
	"date" date NOT NULL,
	"valid_until" date,
	"party_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"customer_name" text NOT NULL,
	"owner_id" uuid,
	"notes" text,
	"terms" text,
	"subtotal" numeric(16, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_document_id_sales_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sales_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document_sequences" ADD CONSTRAINT "sales_document_sequences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_owner_id_employees_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_document_lines_doc_line_uq" ON "sales_document_lines" USING btree ("document_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_document_lines_org_item_idx" ON "sales_document_lines" USING btree ("org_id","stock_item_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_document_sequences_uq" ON "sales_document_sequences" USING btree ("org_id","doc_type");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_documents_org_type_number_uq" ON "sales_documents" USING btree ("org_id","doc_type","number");--> statement-breakpoint
CREATE INDEX "sales_documents_org_type_date_idx" ON "sales_documents" USING btree ("org_id","doc_type","date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sales_documents_org_party_idx" ON "sales_documents" USING btree ("org_id","party_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sales_documents_org_company_idx" ON "sales_documents" USING btree ("org_id","company_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sales_documents_org_deal_idx" ON "sales_documents" USING btree ("org_id","deal_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "sales_documents_org_owner_idx" ON "sales_documents" USING btree ("org_id","owner_id") WHERE deleted_at IS NULL;