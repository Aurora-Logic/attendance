import type { PunchFlag } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId } from '../../../platform/db/columns.js';
import { employees, files, organizations } from '../../../platform/db/schema/index.js';

export const punchTypeEnum = pgEnum('punch_type', ['IN', 'OUT']);
export const punchSourceEnum = pgEnum('punch_source', ['WEB', 'MOBILE', 'OFFLINE_SYNC']);
export const halfDayPartEnum = pgEnum('half_day_part', ['FIRST_HALF', 'SECOND_HALF']);

/**
 * REQ-D-12: punches are immutable. Never edited, never deleted; a correction is
 * a separate adjusting record (REQ-F-03), and an Admin "voids" a punch by
 * writing one, not by touching this row (05-decisions, Access).
 *
 * Like `audit_logs`, the table therefore carries no `updated_at`,
 * `updated_by`, or `deleted_at` — those columns would imply a mutation path
 * that must never exist. Migration 0004 attaches the same
 * `vyuha_forbid_mutation()` trigger that guards `audit_logs`, on UPDATE,
 * DELETE and TRUNCATE. A rule enforced only in a service layer survives until
 * the first repair script.
 *
 * The consequence for readers: `ScopedRepository` cannot be used here (it
 * requires the soft-delete columns), so `PunchRepository` filters `org_id` by
 * hand and is the only place that does.
 */
export const punches = pgTable(
  'punches',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),

    /**
     * REQ-C-02: the *shift start* date, which for a night shift is not the
     * calendar date of the OUT punch. Attribution is decided once, at punch
     * time, and the day engine reads it rather than re-deriving it — two places
     * deciding which day a punch belongs to is two places to disagree.
     */
    attendanceDate: date('attendance_date', { mode: 'string' }).notNull(),

    punchType: punchTypeEnum('punch_type').notNull(),

    /** REQ-D-04/D-05: server time is authoritative, client time is evidence. */
    serverTime: timestamp('server_time', { withTimezone: true }).notNull().defaultNow(),
    clientTime: timestamp('client_time', { withTimezone: true }),
    clockSkewSeconds: integer('clock_skew_seconds'),

    /**
     * REQ-D-02: "Photo is mandatory on both IN and OUT ... there is no bypass."
     * NOT NULL is that sentence expressed where it cannot be argued with.
     * RESTRICT because the photo is the evidence that makes a punch defensible;
     * the REQ-L-03 retention purge marks `files.purged_at` rather than deleting.
     */
    photoFileId: uuid('photo_file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),

    /**
     * REQ-D-03a: "a 256px thumbnail is generated and stored alongside", and
     * "all list, table, and report views load thumbnails only. Fetching a full
     * image in a list is a review failure -- at 500 rows it is 60 MB of
     * traffic."
     *
     * NOT NULL for the same reason as the photo above: a punch with no
     * thumbnail is a punch every list has to fall back to the full image for,
     * and the fallback is the failure mode the requirement names. The two
     * objects are written before the row, so there is no window in which one
     * exists and the other does not.
     */
    thumbnailFileId: uuid('thumbnail_file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),

    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    gpsAccuracyM: doublePrecision('gps_accuracy_m'),
    distanceFromGeofenceM: doublePrecision('distance_from_geofence_m'),

    ip: text('ip'),
    deviceFingerprint: text('device_fingerprint'),
    source: punchSourceEnum('source').notNull(),
    userAgent: text('user_agent'),
    appVersion: text('app_version'),

    /** REQ-D-07: half day chosen at the moment of punching, not derived. */
    isHalfDayMarked: boolean('is_half_day_marked').notNull().default(false),
    halfDayPart: halfDayPartEnum('half_day_part'),

    /**
     * REQ-D-06. The punch endpoint owns window policy; the day engine only
     * reflects its verdict into REQ-E-04's `outside_window` flag.
     */
    outsideWindow: boolean('outside_window').notNull().default(false),

    /**
     * REQ-E-04 needs `outside_geofence` and `device_mismatch` as day flags, and
     * neither can be re-derived here: the geofence verdict folds in the
     * accuracy tolerance, mock-location detection and the field-staff exemption
     * of REQ-D-08, and the device verdict depends on the REQ-B-08 binding mode
     * at the time of the punch. Recomputing either in the engine would be a
     * second implementation of a policy that has already been applied — so the
     * punch records what it decided, exactly as `outside_window` above does.
     */
    outsideGeofence: boolean('outside_geofence').notNull().default(false),
    deviceMismatch: boolean('device_mismatch').notNull().default(false),

    /** REQ-D-06/D-08a: mandatory when the punch was allowed only with a reason. */
    reason: text('reason'),

    /**
     * The rest of what the punch decided about itself, from `PUNCH_FLAGS`.
     *
     * Only the verdicts with no column of their own live here --
     * `low_gps_accuracy`, `no_location`, `clock_skew`, `field_staff_exempt`,
     * and the two "the control was not configured" flags. `outside_window`,
     * `outside_geofence` and `device_mismatch` keep their booleans above
     * because the day engine reads them as typed facts, and `offline_sync` is
     * already `source`. Writing any of those here as well would be the same
     * fact stored twice, which is one fact too many to keep in step.
     *
     * `PunchRepository` composes the complete list for the API out of all
     * three sources, so a reader never has to know about the split.
     */
    flags: text('flags')
      .array()
      .notNull()
      .$type<PunchFlag[]>()
      .default(sql`'{}'::text[]`),

    /**
     * REQ-D-10: "the delay is recorded and shown in reports." Only ever set on
     * an `OFFLINE_SYNC` punch, and deliberately separate from
     * `clock_skew_seconds`: on a queued punch the same arithmetic measures how
     * long the phone was offline, not how wrong its clock is, and treating the
     * two as one number would flag every offline punch as a tampered clock.
     */
    syncDelaySeconds: integer('sync_delay_seconds'),

    /** REQ-D-11: a retry, an offline replay, or a double tap creates nothing new. */
    idempotencyKey: text('idempotency_key').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    // Technical design §4.3, both verbatim. The first is the day engine's own
    // read; the second is the daily punch report.
    index('punches_employee_date_idx').on(t.orgId, t.employeeId, t.attendanceDate, t.serverTime),
    index('punches_org_date_idx').on(t.orgId, t.attendanceDate),
    // REQ-D-11, "unique per employee". Scoped to the employee rather than the
    // org so one client's key space cannot collide with another's.
    uniqueIndex('punches_employee_idempotency_uq').on(t.employeeId, t.idempotencyKey),
  ],
);
