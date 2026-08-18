CREATE TYPE "public"."document_sync_state" AS ENUM('NOT_PUSHED', 'QUEUED', 'PUSHED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."estimate_status" ADD VALUE 'CONFIRMED';--> statement-breakpoint
ALTER TYPE "public"."estimate_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."sales_document_type" ADD VALUE 'SALES_ORDER';--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "source_document_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "sync_state" "document_sync_state" DEFAULT 'NOT_PUSHED' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "remote_guid" text;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "remote_voucher_number" text;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "push_job_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "last_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE INDEX "sales_documents_org_sync_idx" ON "sales_documents" USING btree ("org_id","doc_type","sync_state") WHERE deleted_at IS NULL;