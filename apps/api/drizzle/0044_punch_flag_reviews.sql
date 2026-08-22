CREATE TYPE "public"."punch_flag_review_action" AS ENUM('ACCEPT', 'KEEP', 'HALF_DAY', 'NOTE');--> statement-breakpoint
CREATE TABLE "punch_flag_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"punch_id" uuid NOT NULL,
	"action" "punch_flag_review_action" NOT NULL,
	"note" text,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "punch_flag_reviews" ADD CONSTRAINT "punch_flag_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_flag_reviews" ADD CONSTRAINT "punch_flag_reviews_punch_id_punches_id_fk" FOREIGN KEY ("punch_id") REFERENCES "public"."punches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "punch_flag_reviews_punch_idx" ON "punch_flag_reviews" USING btree ("org_id","punch_id","created_at");