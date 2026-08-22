ALTER TYPE "public"."punch_source" ADD VALUE 'ADMIN_ENTRY';--> statement-breakpoint
ALTER TABLE "punches" ALTER COLUMN "photo_file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "punches" ALTER COLUMN "thumbnail_file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "punches" ADD COLUMN "recorded_by_user_id" uuid;