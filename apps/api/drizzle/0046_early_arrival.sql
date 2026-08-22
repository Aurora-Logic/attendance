ALTER TABLE "attendance_days" ADD COLUMN "early_arrival_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD COLUMN "early_arrival" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD COLUMN "early_streak" integer DEFAULT 0 NOT NULL;