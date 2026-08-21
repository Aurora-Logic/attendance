import type { AttendanceFlag, AttendanceStatus } from '@vyuha/shared';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../../../platform/db/db.provider.js';
import { employees, locations, organizations, settings } from '../../../platform/db/schema/index.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import {
  attendanceAdjustments,
  attendanceDays,
  attendancePeriodLocks,
  holidays,
  leaveRequestDays,
  leaveRequests,
  onDutyRequests,
  punchFlagReviews,
  punches,
  restrictedHolidayElections,
  shiftAssignments,
  shifts,
  weeklyOffPatterns,
} from '../schema/index.js';
import type { AdjustmentFact, HolidayFact, LeaveFact, PunchFact, ShiftPolicy } from './compute-day.js';
import { parseWeeklyOffConfig, type WeeklyOffConfig } from './weekly-off.js';

/**
 * Every read the day engine performs, and the single row it writes.
 *
 * `ScopedRepository` is not the base class here for two reasons. `punches` has
 * no soft-delete columns (REQ-D-12), so it does not satisfy `ScopedTable` at
 * all; and the engine's reads are joins and expressions rather than
 * single-table selects. The rule it exists to enforce still holds -- every
 * statement below filters `org_id` from `ctx` and `deleted_at IS NULL` where
 * the table has one -- and `orgScoped()` is the single helper that does it, so
 * a new query cannot quietly start from an empty WHERE.
 */

/** REQ-E-03: "capped at a configurable maximum (default 16h)". */
export const DEFAULT_MAX_WORK_MINUTES = 16 * 60;

/**
 * Settings keys this module reads from the platform `settings` table.
 *
 * REQ-C-03 says a weekly-off pattern is assignable "at org, location,
 * department, or employee level; the most specific assignment wins". Only the
 * employee level has a column in technical design §4.2, so the org level lives
 * here -- `settings` is where REQ-L-02 puts org policy, and using it avoids
 * adding attendance columns to platform tables. Location and department levels
 * are not modelled anywhere yet and are deliberately not invented.
 */
export const SETTING_KEYS = {
  maxWorkMinutes: 'attendance.max_work_minutes',
  defaultWeeklyOffPatternId: 'attendance.default_weekly_off_pattern_id',
} as const;

const maxWorkMinutesSchema = z.number().int().positive().max(24 * 60);
const patternIdSchema = z.string().uuid();

export interface EmployeeContext {
  readonly id: string;
  readonly locationId: string | null;
  readonly defaultShiftId: string | null;
  readonly weeklyOffPatternId: string | null;
  /** The employee's own calendar, falling back to the location's. */
  readonly holidayCalendarId: string | null;
  /** IANA zone: the location's if it has one, otherwise the organisation's. */
  readonly timezone: string;
}

export interface ResolvedShift {
  readonly policy: ShiftPolicy;
  readonly scheduledIn: Date;
  readonly scheduledOut: Date;
}

export interface ExistingDayRow {
  readonly id: string;
  readonly status: AttendanceStatus;
  readonly isManualOverride: boolean;
  readonly shiftId: string | null;
  readonly scheduledIn: Date | null;
  readonly scheduledOut: Date | null;
  readonly firstInPunchId: string | null;
  readonly lastOutPunchId: string | null;
  readonly workedMinutes: number;
  readonly breakMinutes: number;
  readonly otMinutes: number;
  readonly lateMinutes: number;
  readonly earlyExitMinutes: number;
  readonly flags: readonly AttendanceFlag[];
  readonly leaveRequestId: string | null;
}

/**
 * The columns the engine owns.
 *
 * Not among them: `locked`, which belongs to the REQ-E-09 lock action, and the
 * four REQ-E-08 override columns. The engine *reads* `is_manual_override` and
 * reflects it in the status and the flags, but writing it is not its business
 * -- only HR sets or clears an override, and only with a reason.
 */
export interface DayRowValues {
  readonly status: AttendanceStatus;
  readonly shiftId: string;
  readonly scheduledIn: Date;
  readonly scheduledOut: Date;
  readonly firstInPunchId: string | null;
  readonly lastOutPunchId: string | null;
  readonly workedMinutes: number;
  readonly breakMinutes: number;
  readonly otMinutes: number;
  readonly lateMinutes: number;
  readonly earlyExitMinutes: number;
  readonly flags: readonly AttendanceFlag[];
  readonly leaveRequestId: string | null;
}

/**
 * Drizzle maps a `timestamp` *column* to a Date itself, so a value read through
 * the schema arrives as one. This asserts that rather than assuming it: the
 * value has crossed a process boundary, and a driver change that started
 * handing back text would produce plausible-looking wrong answers instead of a
 * failure.
 */
function requireInstant(value: unknown, label: string): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  throw new Error(`Expected ${label} to be a valid timestamp, received ${JSON.stringify(value)}.`);
}

/**
 * The same, for a value that came out of a raw `sql` expression rather than a
 * mapped column.
 *
 * Drizzle installs its own pg type parsers and maps timestamps per column, so
 * an expression it has no column for arrives as Postgres's own text rendering
 * -- "2026-03-10 03:30:00+00", which is not ISO-8601 and which JavaScript
 * parses only by a non-standard extension. `SHIFT_INSTANT_FORMAT` therefore
 * asks Postgres for unambiguous UTC ISO text and this turns it into an instant.
 * Learned the hard way: the first version of this query returned that string
 * and every scheduled time would have been wrong or thrown.
 */
function parseUtcInstant(value: unknown, label: string): Date {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${label} to be ISO-8601 text, received ${JSON.stringify(value)}.`);
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Expected ${label} to be a valid instant, received "${value}".`);
  }
  return instant;
}

/** UTC ISO-8601 with a literal Z, which `new Date` reads without ambiguity. */
const SHIFT_INSTANT_FORMAT = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);

export class DayEngineRepository {
  constructor(
    private readonly db: Database,
    private readonly ctx: OrgContext,
  ) {}

  /**
   * The org predicate every statement in this class starts from. Mirrors
   * `ScopedRepository.scoped()`; see the class comment for why that base class
   * cannot be used directly.
   */
  private orgScoped(orgPredicate: SQL, ...extra: (SQL | undefined)[]): SQL {
    const predicate = and(orgPredicate, ...extra);
    if (predicate === undefined) {
      throw new Error('Scope predicate collapsed to undefined; refusing to run an unscoped query.');
    }
    return predicate;
  }

  async findEmployee(employeeId: string): Promise<EmployeeContext | null> {
    const rows = await this.db
      .select({
        id: employees.id,
        locationId: employees.locationId,
        defaultShiftId: employees.defaultShiftId,
        weeklyOffPatternId: employees.weeklyOffPatternId,
        holidayCalendarId: sql<
          string | null
        >`coalesce(${employees.holidayCalendarId}, ${locations.holidayCalendarId})`,
        timezone: sql<string>`coalesce(${locations.timezone}, ${organizations.timezone})`,
      })
      .from(employees)
      .innerJoin(organizations, eq(organizations.id, employees.orgId))
      .leftJoin(locations, and(eq(locations.id, employees.locationId), isNull(locations.deletedAt)))
      .where(
        this.orgScoped(
          eq(employees.orgId, this.ctx.orgId),
          eq(employees.id, employeeId),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Step 1: resolve the shift for (employee, date) from `shift_assignments`,
   * falling back to the employee's default shift (REQ-C-04).
   *
   * The wall-clock to instant conversion is done by Postgres rather than in
   * JavaScript. `AT TIME ZONE` knows the full zone history; reproducing it here
   * would mean either a new dependency or a hand-rolled offset table, and a
   * shift boundary computed one hour out marks a whole shift late.
   *
   * Returns null when no shift resolves at all. The caller turns that into a
   * loud configuration error rather than guessing a policy -- see
   * `day-engine.service.ts`.
   */
  async resolveShift(employee: EmployeeContext, date: string): Promise<ResolvedShift | null> {
    // At most one assignment can cover a date: the exclusion constraint
    // `shift_assignments_no_overlap` makes a second one unwritable. The LIMIT
    // is defence against a constraint being dropped, not a tie-break.
    const assignment = await this.db
      .select({ shiftId: shiftAssignments.shiftId })
      .from(shiftAssignments)
      .where(
        this.orgScoped(
          eq(shiftAssignments.orgId, this.ctx.orgId),
          eq(shiftAssignments.employeeId, employee.id),
          isNull(shiftAssignments.deletedAt),
          lte(shiftAssignments.effectiveFrom, date),
          or(isNull(shiftAssignments.effectiveTo), gte(shiftAssignments.effectiveTo, date)),
        ),
      )
      .limit(1);

    const shiftId = assignment[0]?.shiftId ?? employee.defaultShiftId;
    if (shiftId === null) return null;

    const rows = await this.db
      .select({
        id: shifts.id,
        breakMinutes: shifts.breakMinutes,
        graceInBefore: shifts.graceInBefore,
        graceInAfter: shifts.graceInAfter,
        lateAfter: shifts.lateAfter,
        graceOutBefore: shifts.graceOutBefore,
        graceOutAfter: shifts.graceOutAfter,
        earlyExitBefore: shifts.earlyExitBefore,
        minHalfDayMinutes: shifts.minHalfDayMinutes,
        minFullDayMinutes: shifts.minFullDayMinutes,
        otAfterMinutes: shifts.otAfterMinutes,
        scheduledIn: sql`to_char(
          ((${date}::date + ${shifts.startTime}) AT TIME ZONE ${employee.timezone}) AT TIME ZONE 'UTC',
          ${SHIFT_INSTANT_FORMAT})`,
        // REQ-C-02: a night shift's end belongs to the next calendar date, and
        // the day is still attributed to the start date.
        scheduledOut: sql`to_char(
          (((${date}::date + (CASE WHEN ${shifts.crossesMidnight} THEN 1 ELSE 0 END)) + ${shifts.endTime}) AT TIME ZONE ${employee.timezone}) AT TIME ZONE 'UTC',
          ${SHIFT_INSTANT_FORMAT})`,
      })
      .from(shifts)
      .where(
        this.orgScoped(
          eq(shifts.orgId, this.ctx.orgId),
          eq(shifts.id, shiftId),
          isNull(shifts.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;

    const { scheduledIn, scheduledOut, ...policy } = row;
    return {
      policy,
      scheduledIn: parseUtcInstant(scheduledIn, 'the shift start for this date'),
      scheduledOut: parseUtcInstant(scheduledOut, 'the shift end for this date'),
    };
  }

  /**
   * Step 2, REQ-E-09. A null `location_id` on the lock is org-wide and covers
   * every employee including one with no location of their own.
   */
  async isPeriodLocked(employee: EmployeeContext, date: string): Promise<boolean> {
    const [year, month] = date.split('-');
    if (year === undefined || month === undefined) {
      throw new RangeError(`Expected a YYYY-MM-DD date, received "${date}".`);
    }

    const employeeLocationId = employee.locationId;
    const scopeMatches =
      employeeLocationId === null
        ? isNull(attendancePeriodLocks.locationId)
        : or(
            isNull(attendancePeriodLocks.locationId),
            eq(attendancePeriodLocks.locationId, employeeLocationId),
          );

    const rows = await this.db
      .select({ id: attendancePeriodLocks.id })
      .from(attendancePeriodLocks)
      .where(
        this.orgScoped(
          eq(attendancePeriodLocks.orgId, this.ctx.orgId),
          isNull(attendancePeriodLocks.deletedAt),
          // A lock that has been lifted is history, not a lock.
          isNull(attendancePeriodLocks.unlockedAt),
          eq(attendancePeriodLocks.year, Number(year)),
          eq(attendancePeriodLocks.month, Number(month)),
          scopeMatches,
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async findExistingDay(employeeId: string, date: string): Promise<ExistingDayRow | null> {
    const rows = await this.db
      .select({
        id: attendanceDays.id,
        status: attendanceDays.status,
        isManualOverride: attendanceDays.isManualOverride,
        shiftId: attendanceDays.shiftId,
        scheduledIn: attendanceDays.scheduledIn,
        scheduledOut: attendanceDays.scheduledOut,
        firstInPunchId: attendanceDays.firstInPunchId,
        lastOutPunchId: attendanceDays.lastOutPunchId,
        workedMinutes: attendanceDays.workedMinutes,
        breakMinutes: attendanceDays.breakMinutes,
        otMinutes: attendanceDays.otMinutes,
        lateMinutes: attendanceDays.lateMinutes,
        earlyExitMinutes: attendanceDays.earlyExitMinutes,
        flags: attendanceDays.flags,
        leaveRequestId: attendanceDays.leaveRequestId,
      })
      .from(attendanceDays)
      .where(
        this.orgScoped(
          eq(attendanceDays.orgId, this.ctx.orgId),
          eq(attendanceDays.employeeId, employeeId),
          eq(attendanceDays.date, date),
          isNull(attendanceDays.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /** Step 4, REQ-H-02/H-03. */
  async findHoliday(employee: EmployeeContext, date: string): Promise<HolidayFact | null> {
    const calendarId = employee.holidayCalendarId;
    if (calendarId === null) return null;

    const rows = await this.db
      .select({
        isRestricted: holidays.isRestricted,
        electionId: restrictedHolidayElections.id,
      })
      .from(holidays)
      .leftJoin(
        restrictedHolidayElections,
        and(
          eq(restrictedHolidayElections.holidayId, holidays.id),
          eq(restrictedHolidayElections.employeeId, employee.id),
          isNull(restrictedHolidayElections.deletedAt),
        ),
      )
      .where(
        this.orgScoped(
          eq(holidays.orgId, this.ctx.orgId),
          eq(holidays.calendarId, calendarId),
          eq(holidays.date, date),
          isNull(holidays.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;
    return { isRestricted: row.isRestricted, elected: row.electionId !== null };
  }

  /** Step 4, REQ-C-03. Employee pattern first, then the org-level default. */
  async findWeeklyOffPattern(employee: EmployeeContext): Promise<WeeklyOffConfig | null> {
    const patternId = employee.weeklyOffPatternId ?? (await this.readOrgWeeklyOffPatternId());
    if (patternId === null) return null;

    const rows = await this.db
      .select({ id: weeklyOffPatterns.id, config: weeklyOffPatterns.config })
      .from(weeklyOffPatterns)
      .where(
        this.orgScoped(
          eq(weeklyOffPatterns.orgId, this.ctx.orgId),
          eq(weeklyOffPatterns.id, patternId),
          isNull(weeklyOffPatterns.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;
    return parseWeeklyOffConfig(row.config, row.id);
  }

  /**
   * Step 4, REQ-G-06. `is_counted = false` marks a weekly off or holiday inside
   * the range that was not deducted, and such a day is not a leave day.
   */
  async findApprovedLeave(employeeId: string, date: string): Promise<LeaveFact | null> {
    const rows = await this.db
      .select({
        leaveRequestId: leaveRequests.id,
        portion: leaveRequestDays.portion,
      })
      .from(leaveRequestDays)
      .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.leaveRequestId))
      .where(
        this.orgScoped(
          eq(leaveRequestDays.orgId, this.ctx.orgId),
          eq(leaveRequestDays.date, date),
          eq(leaveRequestDays.isCounted, true),
          isNull(leaveRequestDays.deletedAt),
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.status, 'APPROVED'),
          isNull(leaveRequests.cancelledAt),
          isNull(leaveRequests.deletedAt),
        ),
      )
      // REQ-G-05 rejects overlapping requests, so there should be exactly one.
      // If a repair script ever produced two, a full day outranks a half and
      // the id breaks the remaining tie -- the engine must not return a
      // different answer on each run.
      .orderBy(asc(leaveRequestDays.portion), asc(leaveRequests.id))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return null;
    return { leaveRequestId: row.leaveRequestId, portion: row.portion };
  }

  /** Step 4, REQ-F-04. */
  async hasApprovedOnDuty(employeeId: string, date: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: onDutyRequests.id })
      .from(onDutyRequests)
      .where(
        this.orgScoped(
          eq(onDutyRequests.orgId, this.ctx.orgId),
          eq(onDutyRequests.employeeId, employeeId),
          eq(onDutyRequests.status, 'APPROVED'),
          lte(onDutyRequests.fromDate, date),
          gte(onDutyRequests.toDate, date),
          isNull(onDutyRequests.deletedAt),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Step 5. Read by `attendance_date`, which the punch endpoint set from the
   * shift start date (REQ-C-02) -- so a night shift's 02:00 OUT punch is here
   * even though its calendar date is tomorrow. Attribution is decided once, at
   * punch time; two places deciding it is two places to disagree.
   */
  async findPunches(employeeId: string, date: string): Promise<PunchFact[]> {
    const rows = await this.db
      .select({
        id: punches.id,
        punchType: punches.punchType,
        serverTime: punches.serverTime,
        effectiveTime: punches.effectiveTime,
        source: punches.source,
        isHalfDayMarked: punches.isHalfDayMarked,
        outsideWindow: punches.outsideWindow,
        outsideGeofence: punches.outsideGeofence,
        deviceMismatch: punches.deviceMismatch,
      })
      .from(punches)
      .where(
        this.orgScoped(
          eq(punches.orgId, this.ctx.orgId),
          eq(punches.employeeId, employeeId),
          eq(punches.attendanceDate, date),
        ),
      )
      .orderBy(asc(punches.serverTime), asc(punches.id));

    // The coalesce lives here rather than in the engine: `effective_time` is
    // set only when it differs from arrival (migration 0014), and the engine
    // should read one instant per punch without a branch about which kind it
    // is. `server_time` itself is not passed on -- nothing downstream of this
    // needs the instant a punch arrived, and offering both is offering a way
    // to compute a day from the wrong one.
    // Owner, 21 Aug 2026: an admin's acceptance (or half-day marking) from
    // Approvals clears what a punch would otherwise flag. Read as its own
    // query rather than a correlated subselect, so the verdict cannot depend
    // on how the select above is rendered.
    const accepted = new Set<string>();
    if (rows.length > 0) {
      const reviews = await this.db
        .select({ punchId: punchFlagReviews.punchId })
        .from(punchFlagReviews)
        .where(
          and(
            eq(punchFlagReviews.orgId, this.ctx.orgId),
            inArray(punchFlagReviews.punchId, rows.map((row) => row.id)),
            inArray(punchFlagReviews.action, ['ACCEPT', 'HALF_DAY']),
          ),
        );
      for (const review of reviews) accepted.add(review.punchId);
    }

    return rows.map(({ serverTime, effectiveTime, ...row }) => ({
      ...row,
      flagAccepted: accepted.has(row.id),
      effectiveTime: requireInstant(
        effectiveTime ?? serverTime,
        'punches.effective_time / punches.server_time',
      ),
    }));
  }

  /**
   * Step 6. Two approved regularizations can touch one day -- one supplying a
   * missing IN, another a missing OUT -- so the adjustments are folded in
   * chronological order rather than the latest one winning outright, which
   * would silently discard the earlier correction.
   */
  async findAdjustment(employeeId: string, date: string): Promise<AdjustmentFact | null> {
    const rows = await this.db
      .select({
        adjustedIn: attendanceAdjustments.adjustedIn,
        adjustedOut: attendanceAdjustments.adjustedOut,
      })
      .from(attendanceAdjustments)
      .where(
        this.orgScoped(
          eq(attendanceAdjustments.orgId, this.ctx.orgId),
          eq(attendanceAdjustments.employeeId, employeeId),
          eq(attendanceAdjustments.attendanceDate, date),
          isNull(attendanceAdjustments.deletedAt),
        ),
      )
      .orderBy(asc(attendanceAdjustments.createdAt), asc(attendanceAdjustments.id));

    if (rows.length === 0) return null;

    let adjustedIn: Date | null = null;
    let adjustedOut: Date | null = null;
    for (const row of rows) {
      if (row.adjustedIn !== null) adjustedIn = requireInstant(row.adjustedIn, 'adjusted_in');
      if (row.adjustedOut !== null) adjustedOut = requireInstant(row.adjustedOut, 'adjusted_out');
    }

    return { adjustedIn, adjustedOut };
  }

  /** REQ-E-03. A malformed setting is refused, not silently replaced. */
  async readMaxWorkMinutes(): Promise<number> {
    const value = await this.readOrgSetting(SETTING_KEYS.maxWorkMinutes);
    if (value === undefined) return DEFAULT_MAX_WORK_MINUTES;

    const parsed = maxWorkMinutesSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Setting "${SETTING_KEYS.maxWorkMinutes}" is not a positive whole number of minutes: ${JSON.stringify(value)}.`,
      );
    }
    return parsed.data;
  }

  private async readOrgWeeklyOffPatternId(): Promise<string | null> {
    const value = await this.readOrgSetting(SETTING_KEYS.defaultWeeklyOffPatternId);
    if (value === undefined || value === null) return null;

    const parsed = patternIdSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Setting "${SETTING_KEYS.defaultWeeklyOffPatternId}" is not a UUID: ${JSON.stringify(value)}.`,
      );
    }
    return parsed.data;
  }

  private async readOrgSetting(key: string): Promise<unknown> {
    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(
        this.orgScoped(
          eq(settings.orgId, this.ctx.orgId),
          eq(settings.scope, 'ORG'),
          isNull(settings.scopeId),
          eq(settings.key, key),
          isNull(settings.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? undefined : row.value;
  }

  /**
   * Step 11, the only write.
   *
   * `onConflictDoUpdate` rather than a plain insert because a punch computes
   * its day inline while the nightly sweep may be computing the same day in a
   * job (technical design §5, Triggers). The unique index turns that race into
   * one row, not a duplicate and not an error.
   *
   * Neither statement mentions `locked` or the override columns, and that is
   * load-bearing rather than tidy. Postgres evaluates CHECK constraints on the
   * *proposed* insert row before the conflict is detected, so an upsert that
   * carried `is_manual_override = true` with no reason would be refused by
   * `attendance_days_override_has_reason` even though the existing row it was
   * about to update has one. Leaving those columns to their owner makes the
   * proposed row trivially valid and the update non-destructive.
   */
  async writeDay(
    employeeId: string,
    date: string,
    values: DayRowValues,
    computedAt: Date,
  ): Promise<string> {
    const row = {
      orgId: this.ctx.orgId,
      employeeId,
      date,
      status: values.status,
      shiftId: values.shiftId,
      scheduledIn: values.scheduledIn,
      scheduledOut: values.scheduledOut,
      firstInPunchId: values.firstInPunchId,
      lastOutPunchId: values.lastOutPunchId,
      workedMinutes: values.workedMinutes,
      breakMinutes: values.breakMinutes,
      otMinutes: values.otMinutes,
      lateMinutes: values.lateMinutes,
      earlyExitMinutes: values.earlyExitMinutes,
      flags: [...values.flags],
      leaveRequestId: values.leaveRequestId,
      computedAt,
      updatedAt: computedAt,
      updatedBy: this.ctx.actorUserId,
    };

    const inserted = await this.db
      .insert(attendanceDays)
      .values({ ...row, createdAt: computedAt, createdBy: this.ctx.actorUserId })
      .onConflictDoUpdate({
        target: [attendanceDays.employeeId, attendanceDays.date],
        set: row,
      })
      .returning({ id: attendanceDays.id });

    const id = inserted[0]?.id;
    if (id === undefined) {
      throw new Error('The attendance_days upsert returned no row; the statement did not run.');
    }
    return id;
  }
}
