import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, standardColumns } from '../columns.js';
import { users } from './identity.schema.js';
import { organizations } from './organizations.schema.js';

export const filePurposeEnum = pgEnum('file_purpose', [
  'PUNCH_PHOTO',
  'PUNCH_PHOTO_THUMB',
  'EXPORT',
  'ATTACHMENT',
  'ORG_LOGO',
  'IMPORT',
]);

export const exportJobStatusEnum = pgEnum('export_job_status', [
  'QUEUED',
  'RUNNING',
  'DONE',
  'FAILED',
]);

/**
 * NFR-09: files live in object storage, never in the database and never on a
 * public URL. This table holds the pointer and the metadata; access is granted
 * per request through a short-lived signed URL after a permission check.
 */
export const files = pgTable(
  'files',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),

    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    /** Set at write time so tampering with the object is detectable later. */
    checksum: text('checksum').notNull(),
    purpose: filePurposeEnum('purpose').notNull(),

    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),

    /** REQ-L-03: the retention job purges past this and nulls the reference. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),

    ...standardColumns(),
  },
  (t) => [
    index('files_org_purpose_idx').on(t.orgId, t.purpose),
    index('files_expiry_idx').on(t.expiresAt),
  ],
);

/** REQ-J-03: exports run as background jobs and land in a Downloads tray. */
export const exportJobs = pgTable(
  'export_jobs',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    reportKey: text('report_key').notNull(),
    /** Recorded so REQ-J-06 can audit exactly what was exported, not just that something was. */
    filters: jsonb('filters').notNull(),

    status: exportJobStatusEnum('status').notNull().default('QUEUED'),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    rowCount: integer('row_count'),
    error: text('error'),

    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),

    ...standardColumns(),
  },
  (t) => [index('export_jobs_requester_idx').on(t.orgId, t.requestedBy, t.createdAt.desc())],
);

/** REQ-J-01: saved views on the shared report shell. */
export const savedViews = pgTable(
  'saved_views',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reportKey: text('report_key').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    ...standardColumns(),
  },
  (t) => [index('saved_views_lookup_idx').on(t.orgId, t.reportKey, t.userId)],
);
