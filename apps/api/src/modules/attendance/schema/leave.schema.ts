import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../../../platform/db/columns.js';
import { employees, files, organizations } from '../../../platform/db/schema/index.js';
import { approvalRequests, approvalStatusEnum } from './approval.schema.js';

export const leaveAccrualMethodEnum = pgEnum('leave_accrual_method', [
  'NONE',
  'MONTHLY',
  'YEARLY',
  'ON_JOINING',
]);

export const leaveMovementTypeEnum = pgEnum('leave_movement_type', [
  'OPENING',
  'ACCRUAL',
  'AVAILED',
  'ADJUSTMENT',
  'CARRY_FORWARD',
  'ENCASHMENT',
  'LAPSE',
  'REVERSAL',
]);

export const leaveDayPortionEnum = pgEnum('leave_day_portion', [
  'FULL',
  'FIRST_HALF',
  'SECOND_HALF',
]);

/**
 * Leave is counted in days and half days, so `numeric(6,2)` rather than a
 * float: 0.5 has an exact decimal representation and a binary float does not,
 * and a balance that reads 4.999999 in a report is a support call.
 *
 * `mode: 'number'` because every consumer wants arithmetic; the scale is fixed
 * at 2 so the round-trip through a JS number cannot lose a half day.
 */
const days = (name: string) => numeric(name, { precision: 6, scale: 2, mode: 'number' });

/**
 * REQ-G-01. Every rule is a column because the five seed types of REQ-G-02 are
 * "all editable", and the real entitlements are still unanswered
 * (OPEN-QUESTIONS item 4) — so nothing here carries a business default.
 *
 * `is_encashable` is informational only. CLAUDE.md §3 rule 7: no money math
 * happens in this product, and nothing reads this column to compute one.
 */
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    isPaid: boolean('is_paid').notNull().default(true),
    accrualMethod: leaveAccrualMethodEnum('accrual_method').notNull().default('NONE'),
    annualEntitlement: days('annual_entitlement').notNull().default(0),
    carryForwardAllowed: boolean('carry_forward_allowed').notNull().default(false),
    carryForwardCap: days('carry_forward_cap'),
    /** 05-decisions: allowed, limit per type; 0 disables. */
    negativeBalanceLimit: days('negative_balance_limit').notNull().default(0),
    isEncashable: boolean('is_encashable').notNull().default(false),
    allowsHalfDay: boolean('allows_half_day').notNull().default(true),
    minDays: days('min_days'),
    maxDays: days('max_days'),
    noticeDays: integer('notice_days').notNull().default(0),
    attachmentRequiredAfterDays: days('attachment_required_after_days'),
    countsSandwichDays: boolean('counts_sandwich_days').notNull().default(false),
    requiresTwoStepApproval: boolean('requires_two_step_approval').notNull().default(false),
    /** Empty means every employment type; REQ-G-01 makes it a per-type filter. */
    applicableEmploymentTypes: text('applicable_employment_types')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isActive: boolean('is_active').notNull().default(true),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('leave_types_org_code_uq').on(t.orgId, t.code).where(ALIVE),
    index('leave_types_org_active_idx').on(t.orgId, t.isActive),
  ],
);

/**
 * REQ-G-03. A cache of the ledger, not a second source of truth: every column
 * here is reproducible by summing `leave_ledger`, which is what makes a
 * disagreement between the two detectable rather than a matter of opinion.
 */
export const leaveBalances = pgTable(
  'leave_balances',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    /** The calendar year the leave year starts in; April start per 05-decisions. */
    leaveYear: integer('leave_year').notNull(),
    opening: days('opening').notNull().default(0),
    accrued: days('accrued').notNull().default(0),
    availed: days('availed').notNull().default(0),
    adjusted: days('adjusted').notNull().default(0),
    carriedForward: days('carried_forward').notNull().default(0),
    closing: days('closing').notNull().default(0),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('leave_balances_uq')
      .on(t.employeeId, t.leaveTypeId, t.leaveYear)
      .where(ALIVE),
    index('leave_balances_org_year_idx').on(t.orgId, t.leaveYear),
    // Migration 0009. THE INVARIANT, checked by the database on every path
    // into the table -- including a repair script run by hand, which is
    // exactly when a balance would otherwise be edited without its ledger.
    check(
      'leave_balances_closing_is_the_sum',
      sql`closing = opening + accrued - availed + adjusted + carried_forward`,
    ),
  ],
);

/**
 * REQ-G-03: "an immutable ledger ... every movement is a ledger row
 * referencing its cause." Append-only, like `punches` and `audit_logs`, and
 * guarded by the same trigger in migration 0004 — so no `updated_at`,
 * `updated_by` or `deleted_at`.
 */
export const leaveLedger = pgTable(
  'leave_ledger',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    leaveYear: integer('leave_year').notNull(),
    movementType: leaveMovementTypeEnum('movement_type').notNull(),
    /** Signed: an AVAILED row is negative, an ACCRUAL positive. */
    days: days('days').notNull(),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    note: text('note'),
    /**
     * Migration 0009. Set only by a scheduled job -- '2026-04' for April's
     * accrual, '2026->2027' for a carry forward -- and unique per movement, so
     * a retried job cannot post the same accrual twice into a table where
     * nothing can be taken back.
     */
    periodKey: text('period_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    // Technical design §4.3, verbatim: the balance reconstruction query.
    index('leave_ledger_balance_idx').on(t.orgId, t.employeeId, t.leaveTypeId, t.leaveYear),
    index('leave_ledger_reference_idx').on(t.orgId, t.referenceType, t.referenceId),
    uniqueIndex('leave_ledger_period_uq')
      .on(t.orgId, t.employeeId, t.leaveTypeId, t.leaveYear, t.movementType, t.periodKey)
      .where(sql`period_key IS NOT NULL`),
  ],
);

/** REQ-G-05. */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    totalDays: days('total_days').notNull(),
    reason: text('reason'),
    attachmentFileId: uuid('attachment_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    approvalRequestId: uuid('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    status: approvalStatusEnum('status').notNull().default('PENDING'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /**
     * Migration 0009. Separate from `updated_by`, which moves on any edit: an
     * attachment added after approval would otherwise rewrite who approved it.
     */
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
    /** REQ-F-05 makes this mandatory on a rejection; the service enforces it. */
    decisionReason: text('decision_reason'),
    cancellationReason: text('cancellation_reason'),
    ...standardColumns(),
  },
  (t) => [
    // Technical design §4.3, verbatim: the overlap check and the day engine's
    // leave lookup both range-scan this.
    index('leave_requests_range_idx').on(t.orgId, t.employeeId, t.fromDate, t.toDate),
    index('leave_requests_status_idx').on(t.orgId, t.status),
    check('leave_requests_range_ordered', sql`to_date >= from_date`),
    check(
      'leave_requests_decision_is_attributed',
      sql`(decided_at IS NULL) = (decided_by IS NULL)`,
    ),
  ],
);

/**
 * REQ-G-06. The expansion of a request into dates is stored rather than
 * recomputed: weekly offs, holidays and the sandwich rule all feed it, and the
 * day engine must see exactly the days that were approved — not the days the
 * calendar would produce if a holiday were added afterwards.
 */
export const leaveRequestDays = pgTable(
  'leave_request_days',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leaveRequestId: uuid('leave_request_id')
      .notNull()
      .references(() => leaveRequests.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    portion: leaveDayPortionEnum('portion').notNull().default('FULL'),
    /** False for a weekly off or holiday inside the range that is not deducted. */
    isCounted: boolean('is_counted').notNull().default(true),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('leave_request_days_uq').on(t.leaveRequestId, t.date).where(ALIVE),
    index('leave_request_days_date_idx').on(t.orgId, t.date),
  ],
);

/** REQ-G-11: earned for working a holiday or weekly off, expiring in 30 days. */
export const compOffCredits = pgTable(
  'comp_off_credits',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    /**
     * Migration 0009. Which type the credit credits, rather than a code the
     * service guesses at: a credit that names no type is a balance movement
     * nobody can reconcile against a ledger.
     */
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    earnedForDate: date('earned_for_date', { mode: 'string' }).notNull(),
    days: days('days').notNull(),
    expiresOn: date('expires_on', { mode: 'string' }).notNull(),
    consumedByLeaveRequestId: uuid('consumed_by_leave_request_id').references(
      () => leaveRequests.id,
      { onDelete: 'set null' },
    ),
    /** Migration 0009. Set when the sweep posts the LAPSE row, once. */
    lapsedAt: timestamp('lapsed_at', { withTimezone: true }),
    /** Migration 0009. The smallest warning threshold already sent: 7, then 2. */
    expiryWarnedDays: integer('expiry_warned_days'),
    ...standardColumns(),
  },
  (t) => [
    // One credit per worked day; a second recompute of the same holiday must
    // not mint a second day off.
    uniqueIndex('comp_off_credits_employee_date_uq')
      .on(t.employeeId, t.earnedForDate)
      .where(ALIVE),
    // The lapse warnings at 7 and 2 days scan by expiry (05-decisions).
    index('comp_off_credits_expiry_idx').on(t.orgId, t.expiresOn),
    index('comp_off_credits_pending_lapse_idx')
      .on(t.orgId, t.expiresOn)
      .where(
        sql`lapsed_at IS NULL AND consumed_by_leave_request_id IS NULL AND deleted_at IS NULL`,
      ),
  ],
);
