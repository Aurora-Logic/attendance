ALTER TABLE "sales_document_lines" ADD COLUMN "hsn_code" text;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "place_of_supply" text;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "ship_to" jsonb;--> statement-breakpoint
ALTER TABLE "sales_documents" ADD COLUMN "details" jsonb;