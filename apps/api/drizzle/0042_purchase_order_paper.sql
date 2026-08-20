ALTER TABLE "purchase_order_lines" ADD COLUMN "discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "hsn_code" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "terms" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "ship_to" jsonb;