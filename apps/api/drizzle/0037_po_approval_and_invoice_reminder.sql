ALTER TYPE "public"."approval_type" ADD VALUE 'PURCHASE_ORDER';--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "invoice_reminder_sent_at" timestamp with time zone;