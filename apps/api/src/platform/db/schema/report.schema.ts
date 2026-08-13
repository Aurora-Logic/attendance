import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, standardColumns } from '../columns.js';
import { files } from './file.schema.js';
import { users } from './identity.schema.js';
import { organizations } from './organizations.schema.js';

/**
 * Report exports and saved views (REQ-J-01, REQ-J-03, REQ-J-06).
 *
 * Platform rather than attendance, and the tables were here before this slice
 * was: an export is a queued job that turns rows into a file with a retention
 * date, and none of that is attendance-specific. The CRM and ERP modules will
 * export through the same tray. What the attendance module owns is the *row
 * source* -- which report exists, and what a row of it looks like -- and that
 * lives in `modules/attendance/reports/`.
 *
 * Both tables moved here from `file.schema.ts`, which now holds only `files`.
 * They were sharing that file with the object-storage pointer purely because
 * they reference it, and the report slice needed to extend them.
 */

export const exportJobStatusEnum = pgEnum('export_job_status', [
  'QUEUED',
  'RUNNING',
  'DONE',
  'FAILED',
]);

/**
 * REQ-J-03: exports run as background jobs and land in a Downloads tray.
 *
 * `format`, `filename` and `progress` are migration 0010. Progress is a
 * percentage rather than a row count because the tray shows a bar and the
 * denominator is not known until the count query has run; the count itself is
 * `row_count`, written once at the end.
 *
 * There is deliberately no `expires_at` here. Retention belongs to the file
 * (REQ-J-03's seven days is `files.expires_at`, which the existing purge job
 * already sweeps), and a second copy of the date on this row would be a second
 * thing to keep in step with the only one that decides anything.
 */
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
    /**
     * Text with a check constraint rather than a second enum: adding XLSX is
     * then one constraint change instead of an `ALTER TYPE`, and the value is
     * read by name in exactly one place.
     */
    format: text('format').notNull().default('CSV'),
    /** What the browser will call the file. Written at request time so the tray has a name to show while the job is still queued. */
    filename: text('filename'),
    /** 0-100. The tray reads it while the job runs; nothing else does. */
    progress: smallint('progress').notNull().default(0),

    fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
    rowCount: integer('row_count'),
    error: text('error'),

    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),

    ...standardColumns(),
  },
  (t) => [index('export_jobs_requester_idx').on(t.orgId, t.requestedBy, t.createdAt.desc())],
);

/**
 * REQ-J-01: saved views on the shared report shell.
 *
 * The unique index (migration 0010) is on the lower-cased name, so "Late last
 * month" and "late last month" cannot both exist for one reader -- saving over
 * an existing view is the intended way to update it, and two views a reader
 * cannot tell apart is the failure that makes them stop using the feature.
 */
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
  (t) => [
    index('saved_views_lookup_idx').on(t.orgId, t.reportKey, t.userId),
    uniqueIndex('saved_views_name_unique_idx')
      .on(t.orgId, t.userId, t.reportKey, sql`lower(${t.name})`)
      .where(sql`deleted_at IS NULL`),
  ],
);
