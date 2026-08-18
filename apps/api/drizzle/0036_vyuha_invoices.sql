ALTER TYPE "public"."sales_document_type" ADD VALUE 'INVOICE';--> statement-breakpoint
ALTER TABLE "sales_order_invoices" ALTER COLUMN "voucher_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_invoices" ADD COLUMN "invoice_document_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_invoices_invoice_uq" ON "sales_order_invoices" USING btree ("invoice_document_id");