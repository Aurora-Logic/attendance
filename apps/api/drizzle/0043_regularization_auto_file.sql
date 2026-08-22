CREATE TYPE "public"."regularization_origin" AS ENUM('EMPLOYEE', 'SYSTEM');--> statement-breakpoint
ALTER TABLE "regularizations" ALTER COLUMN "reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "regularizations" ADD COLUMN "origin" "regularization_origin" DEFAULT 'EMPLOYEE' NOT NULL;--> statement-breakpoint
ALTER TABLE "regularizations" ADD CONSTRAINT "regularizations_system_reason_optional" CHECK (origin = 'SYSTEM' OR reason IS NOT NULL);