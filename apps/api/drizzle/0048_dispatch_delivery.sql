ALTER TABLE "dispatch_notifications" ADD COLUMN "event" text DEFAULT 'dispatched' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatches" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dispatches" ADD COLUMN "delivered_by" uuid;--> statement-breakpoint
ALTER TABLE "dispatches" ADD COLUMN "received_by" text;--> statement-breakpoint
ALTER TABLE "dispatches" ADD COLUMN "delivery_note" text;