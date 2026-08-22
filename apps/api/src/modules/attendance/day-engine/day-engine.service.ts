import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@vyuha/shared';

import { AuditService } from '../../../platform/audit/audit.service.js';
import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import { parseCalendarDate } from './calendar-date.js';
import { computeDayResult, type DayResult } from './compute-day.js';
import {
  DayEngineRepository,
  type DayRowValues,
  type ExistingDayRow,
} from './day-engine.repository.js';

/**
 * Technical design §5, steps 1, 2 and 11: resolve the shift, respect the period
 * lock, and write exactly one `attendance_days` row. Steps 3 and 5 to 10 are
 * the pure `computeDayResult`.
 *
 * The engine writes nothing when nothing material changed. That is not an
 * optimisation -- it is what makes REQ-E-06's idempotency observable: recompute
 * an unchanged day and the row on disk is byte-identical, `updated_at` and
 * `computed_at` included, because no UPDATE ran. A version that rewrote the row
 * every time would satisfy "same values" while still failing "same row", and
 * the difference is visible to anyone auditing when a record last moved.
 *
 * §5 step 11 attaches the audit write to the same condition: "write audit entry
 * only if the row materially changed". A trail with one entry per nightly sweep
 * for every employee is a trail nobody can read.
 */

export interface ComputeDayOptions {
  /**
   * Injected so a caller recomputing a range uses one instant for all of it,
   * and so tests can sit exactly on the window-close boundary. Defaults to now.
   */
  readonly now?: Date;
}

export type ComputeDayOutcome =
  | { readonly outcome: 'written'; readonly attendanceDayId: string; readonly day: DayResult }
  | { readonly outcome: 'unchanged'; readonly attendanceDayId: string; readonly day: DayResult }
  /** REQ-E-09: the period is locked, so nothing was read further and nothing written. */
  | { readonly outcome: 'locked'; readonly reason: string };

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

/**
 * Whether the row on disk already says what the engine just computed.
 *
 * Compares only the columns the engine owns. `computed_at`, `updated_at` and
 * `locked` are excluded on purpose: the first two are bookkeeping about the
 * write itself, and treating them as material would make every recompute a
 * change and defeat the point.
 */
function materiallyEqual(existing: ExistingDayRow, computed: DayRowValues): boolean {
  return (
    existing.status === computed.status &&
    existing.shiftId === computed.shiftId &&
    sameInstant(existing.scheduledIn, computed.scheduledIn) &&
    sameInstant(existing.scheduledOut, computed.scheduledOut) &&
    existing.firstInPunchId === computed.firstInPunchId &&
    existing.lastOutPunchId === computed.lastOutPunchId &&
    existing.workedMinutes === computed.workedMinutes &&
    existing.breakMinutes === computed.breakMinutes &&
    existing.otMinutes === computed.otMinutes &&
    existing.lateMinutes === computed.lateMinutes &&
    existing.earlyExitMinutes === computed.earlyExitMinutes &&
    existing.earlyArrivalMinutes === computed.earlyArrivalMinutes &&
    existing.earlyArrival === computed.earlyArrival &&
    existing.earlyStreak === computed.earlyStreak &&
    existing.leaveRequestId === computed.leaveRequestId &&
    // `is_manual_override` is not compared: the engine reads it from this same
    // row and never writes it, so the two sides cannot differ. A comparison
    // that can only ever be true is a branch no test can cover.
    // Both sides are in the canonical `ATTENDANCE_FLAGS` order, so a string
    // comparison is a set comparison here and a reordering is not a change.
    existing.flags.join(',') === computed.flags.join(',')
  );
}

export class DayEngine {
  constructor(
    private readonly repository: DayEngineRepository,
    private readonly audit: AuditService,
    private readonly ctx: OrgContext,
  ) {}

  /**
   * `computeDay(employeeId, date) -> AttendanceDay` (technical design §5).
   *
   * Reads punches, roster, leave, holidays, weekly offs, adjustments and
   * settings; writes exactly one row.
   */
  async computeDay(
    employeeId: string,
    date: string,
    options: ComputeDayOptions = {},
  ): Promise<ComputeDayOutcome> {
    // Validated here rather than at the first query so a malformed date is a
    // clear error naming the argument, not an invalid-input-syntax from
    // Postgres four calls deep.
    parseCalendarDate(date);
    const now = options.now ?? new Date();

    const employee = await this.repository.findEmployee(employeeId);
    if (employee === null) {
      throw AppError.notFound('Employee', employeeId);
    }

    // Step 2, before anything else is read: a locked period is not recomputed
    // at all (REQ-E-09), so there is nothing to spend the queries on.
    if (await this.repository.isPeriodLocked(employee, date)) {
      return {
        outcome: 'locked',
        reason: `Attendance for ${date} is in a locked period and was not recomputed.`,
      };
    }

    // Step 1.
    const shift = await this.repository.resolveShift(employee, date);
    if (shift === null) {
      // Every threshold the engine applies lives on the shift row (REQ-C-01),
      // so there is no policy to apply without one and no honest default to
      // invent -- the general shift's timings are still unanswered
      // (OPEN-QUESTIONS item 2). Marking the day ABSENT would look like a fact
      // rather than a misconfiguration, which is the worse failure.
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'This employee has no shift for this date: no roster assignment covers it and no default shift is set.',
        { details: { employeeId, date } },
      );
    }

    const existing = await this.repository.findExistingDay(employeeId, date);

    const [holiday, weeklyOffPattern, leave, onDuty, punches, adjustment, maxWorkMinutes, earlyPolicy, previousStreak] =
      await Promise.all([
        this.repository.findHoliday(employee, date),
        this.repository.findWeeklyOffPattern(employee),
        this.repository.findApprovedLeave(employeeId, date),
        this.repository.hasApprovedOnDuty(employeeId, date),
        this.repository.findPunches(employeeId, date),
        this.repository.findAdjustment(employeeId, date),
        this.repository.readMaxWorkMinutes(),
        this.repository.readEarlyArrivalPolicy(),
        this.repository.findPreviousStreak(employeeId, date),
      ]);

    // Steps 3 and 5 to 10.
    const day = computeDayResult({
      date,
      now,
      shift: shift.policy,
      scheduledIn: shift.scheduledIn,
      scheduledOut: shift.scheduledOut,
      maxWorkMinutes,
      holiday,
      weeklyOffPattern,
      leave,
      onDuty,
      punches,
      adjustment,
      earlyArrival: { ...earlyPolicy, previousStreak },
      existing:
        existing === null
          ? null
          : { status: existing.status, isManualOverride: existing.isManualOverride },
    });

    // Step 11.
    if (existing !== null && materiallyEqual(existing, day)) {
      return { outcome: 'unchanged', attendanceDayId: existing.id, day };
    }

    const attendanceDayId = await this.repository.writeDay(employeeId, date, day, now);

    await this.audit.write({
      orgId: this.ctx.orgId,
      actorUserId: this.ctx.actorUserId,
      action: 'attendance.day.computed',
      entityType: 'attendance_days',
      entityId: attendanceDayId,
      before: existing === null ? undefined : auditView(existing),
      after: auditView(day),
    });

    return { outcome: 'written', attendanceDayId, day };
  }

  /**
   * REQ-E-09, asked before a caller writes something a recompute would have to
   * pick up.
   *
   * `computeDay` already refuses a locked date, which is enough for a caller
   * that only recomputes. It is not enough for one that writes a *record* the
   * engine will read later: an approved regularization stored against a locked
   * month would sit inert and then apply itself the moment the month was
   * reopened, which is a change nobody made at a time nobody chose. Those
   * callers ask first.
   *
   * Here rather than in each caller's repository so `attendance_period_locks`
   * has one reader. A second copy of this query is a second answer to the same
   * question waiting to disagree.
   */
  async isLocked(employeeId: string, date: string): Promise<boolean> {
    parseCalendarDate(date);
    const employee = await this.repository.findEmployee(employeeId);
    if (employee === null) throw AppError.notFound('Employee', employeeId);
    return this.repository.isPeriodLocked(employee, date);
  }
}

/**
 * The shape written to the audit trail. Flattened to primitives so the jsonb
 * diff in `AuditService` compares values rather than Date objects, which
 * stringify inconsistently depending on how they were constructed.
 */
function auditView(row: ExistingDayRow | DayResult): Record<string, unknown> {
  return {
    status: row.status,
    workedMinutes: row.workedMinutes,
    breakMinutes: row.breakMinutes,
    otMinutes: row.otMinutes,
    lateMinutes: row.lateMinutes,
    earlyExitMinutes: row.earlyExitMinutes,
    flags: [...row.flags],
    leaveRequestId: row.leaveRequestId,
    isManualOverride: row.isManualOverride,
    firstInPunchId: row.firstInPunchId,
    lastOutPunchId: row.lastOutPunchId,
  };
}

/**
 * The injectable seam. The engine itself is bound to an organisation because
 * every read it performs must be, and taking the org from an argument would
 * make "which org" a decision each caller repeats -- Security §15 lists IDOR
 * as "every read filtered by `org_id`; never trust an ID from the client".
 */
@Injectable()
export class DayEngineService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  forOrg(ctx: OrgContext): DayEngine {
    return new DayEngine(new DayEngineRepository(this.db, ctx), this.audit, ctx);
  }
}
