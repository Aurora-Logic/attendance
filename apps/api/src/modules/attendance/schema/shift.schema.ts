import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../../../platform/db/columns.js';
import { employees, organizations } from '../../../platform/db/schema/index.js';

/**
 * REQ-C-01. Every policy number the day engine applies lives on this row, not
 * in a constant — REQ-K-01 promises that changing a policy setting alters
 * behaviour without a redeploy, and the engine reads these columns on every
 * compute.
 *
 * The defaults are the ones printed in REQ-C-01's table. `start_time` and
 * `end_time` deliberately have none: the general shift's timings are still
 * unanswered (OPEN-QUESTIONS item 2), and a guessed default would silently
 * become the policy the first time somebody created a shift without thinking.
 */
export const shifts = pgTable(
  'shifts',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code').notNull(),

    // Wall-clock times, not instants. A shift starts at 09:00 in the office's
    // timezone whatever the date; converting to an instant is the day engine's
    // job and needs the date to do it.
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),

    /** REQ-C-02: the day is attributed to the shift start date, not the OUT date. */
    crossesMidnight: boolean('crosses_midnight').notNull().default(false),
    breakMinutes: integer('break_minutes').notNull().default(0),

    graceInBefore: integer('grace_in_before').notNull().default(30),
    graceInAfter: integer('grace_in_after').notNull().default(10),
    lateAfter: integer('late_after').notNull().default(10),
    graceOutBefore: integer('grace_out_before').notNull().default(10),
    graceOutAfter: integer('grace_out_after').notNull().default(120),
    earlyExitBefore: integer('early_exit_before').notNull().default(10),
    minHalfDayMinutes: integer('min_half_day_minutes').notNull().default(240),
    minFullDayMinutes: integer('min_full_day_minutes').notNull().default(480),
    otAfterMinutes: integer('ot_after_minutes').notNull().default(30),

    isActive: boolean('is_active').notNull().default(true),

    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('shifts_org_code_uq').on(t.orgId, t.code).where(ALIVE),
    index('shifts_org_active_idx').on(t.orgId, t.isActive),
    // A half-day threshold above the full-day threshold would make HALF_DAY
    // unreachable, and the mistake is invisible until somebody reads a month of
    // wrong musters. REQ-E-02 orders PRESENT before HALF_DAY, so the engine
    // cannot detect it either.
    check('shifts_day_thresholds_ordered', sql`min_half_day_minutes <= min_full_day_minutes`),
  ],
);

/**
 * REQ-C-03. The rule is data, not code: "Weekly off: configurable in the UI —
 * Admin ticks the off days, alternate-Saturday rule as a toggle, per-person
 * override available. Nothing hardcoded." (05-decisions).
 *
 * `config` is read by `matchesWeeklyOff` in the day engine; see
 * `weekly-off.ts` for the shape and why it is validated on read rather than
 * trusted, jsonb being the one column type Postgres cannot constrain for us.
 */
export const weeklyOffPatterns = pgTable(
  'weekly_off_patterns',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    config: jsonb('config').notNull(),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('weekly_off_patterns_org_name_uq').on(t.orgId, t.name).where(ALIVE),
    index('weekly_off_patterns_org_idx').on(t.orgId),
  ],
);

/**
 * REQ-C-04, the roster. "Overlapping assignments are rejected" — and rejected
 * by Postgres, not by a service that can be bypassed by an import, a repair
 * script, or two concurrent requests that both pass validation before either
 * commits. The exclusion constraint is added in the Phase 1 migration because
 * Drizzle has no builder for one; see `0004_attendance_tables.sql`.
 *
 * `effective_to` null means open-ended, which is the normal case for a standing
 * assignment.
 */
export const shiftAssignments = pgTable(
  'shift_assignments',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'restrict' }),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    ...standardColumns(),
  },
  (t) => [
    index('shift_assignments_employee_idx').on(t.orgId, t.employeeId, t.effectiveFrom),
    index('shift_assignments_shift_idx').on(t.orgId, t.shiftId),
    // An inverted range would produce an empty daterange, which overlaps
    // nothing — the exclusion constraint would accept any number of them.
    check(
      'shift_assignments_range_ordered',
      sql`effective_to IS NULL OR effective_to >= effective_from`,
    ),
  ],
);
