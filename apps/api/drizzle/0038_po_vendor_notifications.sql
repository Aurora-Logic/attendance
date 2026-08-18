CREATE TABLE "purchase_order_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
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
ALTER TABLE "purchase_orders" ADD COLUMN "vendor_email" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "vendor_whatsapp" text;--> statement-breakpoint
ALTER TABLE "purchase_order_notifications" ADD CONSTRAINT "purchase_order_notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_notifications" ADD CONSTRAINT "purchase_order_notifications_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_notifications_po_idx" ON "purchase_order_notifications" USING btree ("purchase_order_id");