CREATE TABLE "rate_limit_fallback_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"bucket" text NOT NULL,
	"subject" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_fallback_attempts_bucket_subject_idx" ON "rate_limit_fallback_attempts" USING btree ("bucket","subject","attempted_at");
