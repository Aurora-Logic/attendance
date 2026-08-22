CREATE TYPE "public"."regularization_origin" AS ENUM('EMPLOYEE', 'SYSTEM');--> statement-breakpoint
CREATE TABLE "fallback_job_schedules" (
	"scheduler_id" text PRIMARY KEY NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fallback_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"job_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"external_job_id" text,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "rate_limit_fallback_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"bucket" text NOT NULL,
	"subject" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regularizations" ALTER COLUMN "reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "regularizations" ADD COLUMN "origin" "regularization_origin" DEFAULT 'EMPLOYEE' NOT NULL;--> statement-breakpoint
CREATE INDEX "fallback_jobs_state_run_after_idx" ON "fallback_jobs" USING btree ("state","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "fallback_jobs_external_id_uq" ON "fallback_jobs" USING btree ("job_name","external_job_id") WHERE external_job_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "rate_limit_fallback_attempts_bucket_subject_idx" ON "rate_limit_fallback_attempts" USING btree ("bucket","subject","attempted_at");--> statement-breakpoint
ALTER TABLE "regularizations" ADD CONSTRAINT "regularizations_system_reason_optional" CHECK (origin = 'SYSTEM' OR reason IS NOT NULL);