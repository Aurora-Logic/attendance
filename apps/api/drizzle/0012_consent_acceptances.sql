-- REQ-M-03: "Consent notice shown on first punch ... Acceptance is recorded."
-- Nothing recorded it (OPEN-QUESTIONS P1-4): the checkbox was component state
-- that vanished on reload, so the notice reappeared on every visit and there
-- was no evidence anybody had ever accepted anything.
--
-- One row per user per notice, keyed by a `consent_key` string rather than a
-- punch-specific column, for the reason the `settings` table gives: consent is
-- a platform mechanism and the attendance module is merely its first consumer.
-- The key it writes is 'attendance.punch_capture'.
--
-- `accepted_at` is its own column rather than `created_at` doing double duty,
-- because the acceptance instant is the legally meaningful fact and
-- bookkeeping columns must stay free to mean only bookkeeping.
--
-- The unique index is partial on the living rows, matching every other
-- uniqueness rule in this schema: a withdrawn (soft-deleted) acceptance frees
-- the slot so the notice can be accepted again, and the old row remains as
-- history.
--
-- Reverse with:
--   DROP INDEX "consent_acceptances_user_key_uq";
--   DROP TABLE "consent_acceptances";
CREATE TABLE "consent_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_key" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_acceptances_user_key_uq" ON "consent_acceptances" USING btree ("org_id","user_id","consent_key") WHERE deleted_at IS NULL;
