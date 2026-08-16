import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, standardColumns } from '../../../platform/db/columns.js';
import { employees, files, organizations, users } from '../../../platform/db/schema/index.js';
import { approvalRequests, approvalStatusEnum } from '../../../platform/db/schema/approval.schema.js';

export const regularizationKindEnum = pgEnum('regularization_kind', [
  'MISSING_IN',
  'MISSING_OUT',
  'WRONG_TIME',
  'FORGOT_TO_PUNCH',
]);

/** REQ-F-01. The reason is mandatory; the attachment is not. */
export const regularizations = pgTable(
  'regularizations',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    kind: regularizationKindEnum('kind').notNull(),
    requestedIn: timestamp('requested_in', { withTimezone: true }),
    requestedOut: timestamp('requested_out', { withTimezone: true }),
    reason: text('reason').notNull(),
    attachmentFileId: uuid('attachment_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    approvalRequestId: uuid('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    status: approvalStatusEnum('status').notNull().default('PENDING'),
    /**
     * Migration 0014, and the same three columns `leave_requests` carries.
     * Separate from `updated_at`/`updated_by`, which move on any edit: an
     * attachment added after a decision would otherwise rewrite who made it.
     */
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
    /** REQ-F-05 makes this mandatory on a rejection; the service enforces it. */
    decisionReason: text('decision_reason'),
    ...standardColumns(),
  },
  (t) => [
    index('regularizations_employee_date_idx').on(t.orgId, t.employeeId, t.date),
    // REQ-F-02's per-month cap is counted over this.
    index('regularizations_org_date_idx').on(t.orgId, t.date),
    index('regularizations_status_idx').on(t.orgId, t.status),
    // Migration 0016, widened by 0017. The cap in REQ-F-02 is counted in the
    // service and a count is not a lock -- two submissions a millisecond apart
    // both read the same total and both pass.
    //
    // Scoped to the *open* statuses so a rejected request does not block the
    // corrected re-raise, which is the ordinary use. ESCALATED is one of them:
    // REQ-G-09's timer moves an unanswered request up a level and it is still
    // in somebody's inbox, so a second request for the same day would be a
    // second live correction.
    uniqueIndex('regularizations_one_open_per_day_idx')
      .on(t.orgId, t.employeeId, t.date)
      .where(sql`${t.status} IN ('PENDING', 'ESCALATED') AND ${t.deletedAt} IS NULL`),
    // Migration 0017. The decision path resolves a request from its approval
    // and back again.
    index('regularizations_approval_request_idx').on(t.orgId, t.approvalRequestId),
    check(
      'regularizations_decision_is_attributed',
      sql`(decided_at IS NULL) = (decided_by IS NULL)`,
    ),
  ],
);

/**
 * REQ-F-03: "On approval, an adjusting record is written and the day is
 * recomputed. The original punches remain untouched and visible."
 *
 * This is the only thing that can move an IN or an OUT, and it sits beside the
 * punches rather than over them — which is what lets a report show both the
 * punch at 21:40 and the approved correction to 18:30.
 */
export const attendanceAdjustments = pgTable(
  'attendance_adjustments',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    attendanceDate: date('attendance_date', { mode: 'string' }).notNull(),
    regularizationId: uuid('regularization_id').references(() => regularizations.id, {
      onDelete: 'set null',
    }),
    adjustedIn: timestamp('adjusted_in', { withTimezone: true }),
    adjustedOut: timestamp('adjusted_out', { withTimezone: true }),
    reason: text('reason').notNull(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    ...standardColumns(),
  },
  (t) => [
    index('attendance_adjustments_day_idx').on(t.orgId, t.employeeId, t.attendanceDate),
    // An adjustment that moves nothing is a no-op the engine would still have
    // to reason about, and it would read as a correction in the audit trail.
    check(
      'attendance_adjustments_moves_something',
      sql`adjusted_in IS NOT NULL OR adjusted_out IS NOT NULL`,
    ),
  ],
);

/** REQ-F-04. On approval the covered days become ON_DUTY and count as present. */
export const onDutyRequests = pgTable(
  'on_duty_requests',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    siteName: text('site_name'),
    approvalRequestId: uuid('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    status: approvalStatusEnum('status').notNull().default('PENDING'),
    /** Migration 0014; see the note on `regularizations`. */
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
    /** REQ-F-05 makes this mandatory on a rejection; the service enforces it. */
    decisionReason: text('decision_reason'),
    ...standardColumns(),
  },
  (t) => [
    index('on_duty_requests_range_idx').on(t.orgId, t.employeeId, t.fromDate, t.toDate),
    index('on_duty_requests_status_idx').on(t.orgId, t.status),
    /** Migration 0017; see the note on `regularizations`. */
    index('on_duty_requests_approval_request_idx').on(t.orgId, t.approvalRequestId),
    check('on_duty_requests_range_ordered', sql`to_date >= from_date`),
    check(
      'on_duty_requests_decision_is_attributed',
      sql`(decided_at IS NULL) = (decided_by IS NULL)`,
    ),
  ],
);
