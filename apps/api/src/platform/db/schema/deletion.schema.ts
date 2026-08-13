import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryId } from '../columns.js';
import { organizations } from './organizations.schema.js';

/**
 * REQ-B-09a: "Admin can restore any soft-deleted record from a Recycle Bin
 * screen." This is the story behind each `deleted_at` — who set it, when, why,
 * and whether it was undone.
 *
 * Not a scoped table on purpose. `ScopedRepository` filters `deleted_at IS
 * NULL`, and a log of deletions whose own rows can be deleted is a log nothing
 * can be concluded from. It carries no `updated_at` either: a row is written
 * once at the delete and touched once at the restore, and nothing else may
 * amend it.
 *
 * The recycle bin does not read this table as its source of truth. It reads the
 * master tables for `deleted_at IS NOT NULL` and joins here for the actor and
 * the reason, so a row soft-deleted by some path that never wrote a record is
 * still listed and still restorable — visible without an explanation, rather
 * than invisible.
 */
export const deletionRecords = pgTable(
  'deletion_records',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),

    /** A `SoftDeletableEntity` from `@vyuha/shared`; text so a new master needs no enum migration. */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /**
     * Copied at the moment of deletion. The master row can be renamed after a
     * restore, and the bin has to report what was deleted rather than what the
     * record happens to be called when somebody reads the list.
     */
    entityLabel: text('entity_label').notNull(),

    reason: text('reason').notNull(),
    /** No foreign key, for the reason `columns.ts` gives for `created_by`. */
    deletedBy: uuid('deleted_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),

    restoredBy: uuid('restored_by'),
    restoredAt: timestamp('restored_at', { withTimezone: true }),
    restoreReason: text('restore_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Delete, restore, delete again is two rows and that is correct history.
    // Two *open* rows would put the same record in the bin twice, and one of
    // the two restores would be a no-op nobody could account for.
    uniqueIndex('deletion_records_open_uq')
      .on(t.entityType, t.entityId)
      .where(sql`restored_at IS NULL`),
    index('deletion_records_bin_idx')
      .on(t.orgId, t.deletedAt.desc())
      .where(sql`restored_at IS NULL`),
    index('deletion_records_entity_idx').on(t.orgId, t.entityType, t.entityId),

    // The reason floor lives in the database as well as in Zod. A rule enforced
    // only at the edge is a rule a repair script walks straight past, and "with
    // comments" is the whole point of these routes. Matches MIN_ADMIN_REASON.
    check('deletion_records_reason_substantive', sql`char_length(btrim(reason)) >= 10`),
    check(
      'deletion_records_restore_reason_substantive',
      sql`restore_reason IS NULL OR char_length(btrim(restore_reason)) >= 10`,
    ),
    check(
      'deletion_records_restore_is_complete',
      sql`(restored_at IS NULL) = (restore_reason IS NULL)`,
    ),
  ],
);
