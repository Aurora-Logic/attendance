ALTER TYPE "public"."approval_type" ADD VALUE 'SALES_DISCOUNT';--> statement-breakpoint
ALTER TYPE "public"."estimate_status" ADD VALUE 'PENDING_APPROVAL';--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "approval_request_id" uuid;