-- Admin operations: soft delete with a reason, the recycle bin, and the
-- period-lock reason columns (REQ-B-09a, REQ-M-04, REQ-E-09).
--
-- Three things land here.
--
-- 1. `deletion_records`. REQ-B-09a wants a Recycle Bin listing soft-deleted
--    rows "with who deleted them and when", restorable within a retention
--    window. The alternative was `deleted_by` + `deleted_reason` on each of the
--    six master tables -- twelve columns that would have to be added again for
--    the seventh master, and that still could not record a *restore*. One log
--    table records the whole event: who, when, why, and whether it was undone.
--
--    It is deliberately not a scoped table. `ScopedRepository` filters
--    `deleted_at IS NULL`, and a log of deletions whose rows can themselves be
--    deleted is a log nobody can rely on. The recycle bin therefore reads the
--    master tables for `deleted_at IS NOT NULL` and joins this table for the
--    story -- so a row soft-deleted by some other path is still visible, just
--    without an actor or a reason, rather than silently absent.
--
--    The two CHECKs on reason length are the point of the whole slice: "with
--    comments" has to mean a sentence, and a rule enforced only in Zod is a
--    rule that a repair script walks straight past. Ten characters matches
--    `MIN_ADMIN_REASON` in `packages/shared/src/org.ts`.
--
-- 2. `attendance_period_locks.reason` becomes `lock_reason`, and
--    `unlock_reason` is added. REQ-E-09 requires a reason for *both* actions
--    and one column cannot hold two. The rename rather than a second column
--    beside an ambiguous `reason`: the two rows that exist in development were
--    written by a fixture and both hold a locking reason, so the rename is what
--    the data already says.
--
--    Both CHECKs are NOT VALID. Postgres still enforces them on every insert
--    and update from here on; what NOT VALID skips is the scan of rows written
--    before the rule existed. One such row exists (unlocked, with no unlock
--    reason) and backfilling it would mean inventing a reason in a migration,
--    which is exactly the kind of fiction an audit trail exists to prevent.
--
-- 3. The `attendance.unlock` permission key, granted to seeded Admin roles.
--    docs/OPEN-QUESTIONS P2-1: gating unlock on `attendance.lock` makes unlock
--    exactly as available as lock, which REQ-E-09 does not intend. The seed
--    reconciles the catalogue from `ALL_PERMISSIONS` too, so this is belt and
--    braces for a deployment that migrates without re-seeding -- without it,
--    `PATCH /roles` would reject the key as unknown.
--
--    Matching on the role *name* is data, not logic: it mirrors what
--    `seed/seed.ts` already does with `SYSTEM_ROLES`, and no code path branches
--    on it. A role somebody renamed is left alone rather than guessed at.
--
-- Every statement is guarded, so re-running the file is a no-op.
--
-- Reverse with:
--   DELETE FROM "role_permissions" WHERE "permission_id" IN
--     (SELECT "id" FROM "permissions" WHERE "key" = 'attendance.unlock');
--   DELETE FROM "permissions" WHERE "key" = 'attendance.unlock';
--   ALTER TABLE "attendance_period_locks"
--     DROP CONSTRAINT IF EXISTS "attendance_period_locks_unlock_has_reason",
--     DROP CONSTRAINT IF EXISTS "attendance_period_locks_lock_has_reason",
--     DROP COLUMN IF EXISTS "unlock_reason";
--   ALTER TABLE "attendance_period_locks" RENAME COLUMN "lock_reason" TO "reason";
--   DROP TABLE IF EXISTS "deletion_records";

CREATE TABLE IF NOT EXISTS "deletion_records" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	-- Copied at the moment of deletion. The master row can be renamed after a
	-- restore, and the bin has to say what was deleted, not what it is called now.
	"entity_label" text NOT NULL,
	"reason" text NOT NULL,
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_by" uuid,
	"restored_at" timestamp with time zone,
	"restore_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletion_records_reason_substantive"
		CHECK (char_length(btrim("reason")) >= 10),
	CONSTRAINT "deletion_records_restore_reason_substantive"
		CHECK ("restore_reason" IS NULL OR char_length(btrim("restore_reason")) >= 10),
	CONSTRAINT "deletion_records_restore_is_complete"
		CHECK (("restored_at" IS NULL) = ("restore_reason" IS NULL))
);--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'deletion_records_org_id_organizations_id_fk'
	) THEN
		ALTER TABLE "deletion_records"
			ADD CONSTRAINT "deletion_records_org_id_organizations_id_fk"
			FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
	END IF;
END $$;--> statement-breakpoint

-- `deleted_by` and `restored_by` carry no foreign key, for the reason
-- `columns.ts` gives for `created_by`: a row can be written by a job or a
-- repair script where there is no acting user, and `audit_logs` is the
-- authoritative actor trail either way.

-- One open deletion per entity. Delete, restore, delete again is two rows and
-- that is correct history; two *open* rows would mean the bin offered the same
-- record twice and one of the restores would be a no-op nobody could explain.
CREATE UNIQUE INDEX IF NOT EXISTS "deletion_records_open_uq"
	ON "deletion_records" USING btree ("entity_type","entity_id")
	WHERE "restored_at" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "deletion_records_bin_idx"
	ON "deletion_records" USING btree ("org_id","deleted_at" DESC)
	WHERE "restored_at" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "deletion_records_entity_idx"
	ON "deletion_records" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint

COMMENT ON TABLE "deletion_records" IS
	'REQ-B-09a: who soft-deleted a master, when, why, and whether it was restored.';--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		 WHERE table_name = 'attendance_period_locks' AND column_name = 'reason'
	) AND NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		 WHERE table_name = 'attendance_period_locks' AND column_name = 'lock_reason'
	) THEN
		ALTER TABLE "attendance_period_locks" RENAME COLUMN "reason" TO "lock_reason";
	END IF;
END $$;--> statement-breakpoint

ALTER TABLE "attendance_period_locks"
	ADD COLUMN IF NOT EXISTS "unlock_reason" text;--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'attendance_period_locks_lock_has_reason'
	) THEN
		ALTER TABLE "attendance_period_locks"
			ADD CONSTRAINT "attendance_period_locks_lock_has_reason"
			CHECK (char_length(btrim("lock_reason")) >= 10) NOT VALID;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'attendance_period_locks_unlock_has_reason'
	) THEN
		ALTER TABLE "attendance_period_locks"
			ADD CONSTRAINT "attendance_period_locks_unlock_has_reason"
			CHECK ("unlocked_at" IS NULL OR char_length(btrim("unlock_reason")) >= 10) NOT VALID;
	END IF;
END $$;--> statement-breakpoint

INSERT INTO "permissions" ("key", "description")
VALUES ('attendance.unlock', 'Unlock a locked attendance period with a reason')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."is_system" = true
   AND r."name" = 'Admin'
   AND r."deleted_at" IS NULL
   AND p."key" = 'attendance.unlock'
ON CONFLICT DO NOTHING;
