import { Injectable } from '@nestjs/common';
import { ERROR_CODES, type AttendanceDayDetail } from '@vyuha/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { DayEngineService } from '../day-engine/day-engine.service.js';
import { DayEngineRepository } from '../day-engine/day-engine.repository.js';
import { attendanceDays } from '../schema/index.js';
import type { OverrideDayInput } from './period-lock.dto.js';
import { AttendanceDayService } from './attendance-day.service.js';

/**
 * REQ-E-08: "HR can set a day's status directly. This requires a typed reason,
 * sets `manual_override`, records who and when, and is surfaced with a marker
 * in every report. Overrides survive recomputation."
 *
 * The surviving part already worked and is not re-implemented here.
 * `computeDayResult` reads `is_manual_override` off the existing row, pins the
 * status a human chose, and adds the `manual_override` flag — there is a
 * passing test for exactly that. What was missing was a way to *set* those
 * columns; the day engine deliberately never writes them (see the note on
 * `DayRowValues`).
 *
 * So the shape of an override is: write the four columns, then recompute. The
 * order matters and is the whole trick. The engine reads the row it is about to
 * replace, so the status has to be on disk before the recompute or the pin has
 * nothing to pin. Recomputing afterwards is what re-measures the hours around
 * the human's decision and puts `manual_override` into `flags` — without it the
 * marker REQ-E-08 promises "in every report" would never appear.
 */
@Injectable()
export class AttendanceOverrideService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly dayEngine: DayEngineService,
    private readonly days: AttendanceDayService,
    private readonly auditContext: AuditContext,
  ) {}

  async override(
    principal: Principal,
    employeeId: string,
    date: string,
    input: OverrideDayInput,
  ): Promise<AttendanceDayDetail> {
    const ctx = orgContextOf(principal);
    const engineRepository = new DayEngineRepository(this.db, ctx);

    const employee = await engineRepository.findEmployee(employeeId);
    if (employee === null) throw AppError.notFound('Employee', employeeId);

    // REQ-E-09, before anything is written: "no punches, leave,
    // regularizations, overrides, or recomputes affect locked days". Asked
    // through the day engine's own repository rather than reimplemented, so an
    // override and a recompute can never disagree about what is locked.
    if (await engineRepository.isPeriodLocked(employee, date)) {
      throw new AppError(
        ERROR_CODES.PERIOD_LOCKED,
        `${date} is in a locked period. Unlock it first — that needs an Admin and a reason.`,
        { details: { employeeId, date } },
      );
    }

    const engine = this.dayEngine.forOrg(ctx);

    // The row has to exist before it can be overridden, and it legitimately may
    // not: nobody has punched and the nightly sweep has not run. Computing it
    // first is not a side effect to be shy about — it is the same row the sweep
    // would have written, and without it an override of a quiet day would 404.
    let existing = await engineRepository.findExistingDay(employeeId, date);
    if (existing === null) {
      await engine.computeDay(employeeId, date);
      existing = await engineRepository.findExistingDay(employeeId, date);
      if (existing === null) {
        throw new Error(`The day engine wrote no row for ${employeeId} on ${date}.`);
      }
    }

    const clearing = input.status === null || input.status === undefined;
    if (clearing && !existing.isManualOverride) {
      throw AppError.conflict(
        `${date} is not overridden, so there is nothing to lift.`,
        { employeeId, date },
      );
    }

    const before = {
      status: existing.status,
      isManualOverride: existing.isManualOverride,
      flags: [...existing.flags],
    };

    const now = new Date();
    await this.writeOverride(ctx.orgId, existing.id, {
      status: clearing ? null : (input.status ?? null),
      reason: input.reason,
      actorUserId: principal.userId,
      at: now,
      clearing,
    });

    // Recomputed rather than written by hand. Everything except the status is a
    // measurement, and REQ-E-08 says the override keeps the status while the
    // measurements are taken again — which is precisely what the engine does
    // when it finds `is_manual_override` set.
    const outcome = await engine.computeDay(employeeId, date, { now });
    if (outcome.outcome === 'locked') {
      // Only reachable if a lock landed between the check above and here.
      throw new AppError(
        ERROR_CODES.PERIOD_LOCKED,
        'That period was locked while this override was being saved. Nothing was recomputed.',
        { details: { employeeId, date } },
      );
    }

    const detail = await this.days.findDay(principal, employeeId, date);

    this.auditContext.record({
      action: clearing ? 'attendance.day.override_cleared' : 'attendance.day.overridden',
      entityType: 'attendance_days',
      entityId: existing.id,
      before,
      after: {
        status: detail.status,
        isManualOverride: detail.isManualOverride,
        flags: [...detail.flags],
        reason: input.reason,
      },
    });

    return detail;
  }

  /**
   * The only writer of the four REQ-E-08 columns.
   *
   * `override_reason` is kept when the override is lifted, and
   * `is_manual_override` is what says whether one is in force. The alternative
   * -- nulling the reason -- would leave a day that was overridden for three
   * weeks with no trace of it on the row, and the audit trail as the only place
   * anyone could learn that. The database CHECK
   * (`attendance_days_override_has_reason`) is satisfied either way: it demands
   * a reason when the flag is set, not the absence of one when it is not.
   */
  private async writeOverride(
    orgId: string,
    attendanceDayId: string,
    values: {
      status: string | null;
      reason: string;
      actorUserId: string;
      at: Date;
      clearing: boolean;
    },
  ): Promise<void> {
    const rows = await this.db
      .update(attendanceDays)
      .set({
        ...(values.clearing || values.status === null
          ? {}
          : { status: sql`${values.status}::attendance_status` }),
        isManualOverride: !values.clearing,
        overrideReason: values.reason,
        overrideBy: values.actorUserId,
        overrideAt: values.at,
        updatedAt: values.at,
        updatedBy: values.actorUserId,
      })
      .where(
        and(
          eq(attendanceDays.orgId, orgId),
          eq(attendanceDays.id, attendanceDayId),
          isNull(attendanceDays.deletedAt),
        ),
      )
      .returning({ id: attendanceDays.id });

    if (rows.length === 0) {
      throw new Error(`Attendance day ${attendanceDayId} vanished while being overridden.`);
    }
  }
}
