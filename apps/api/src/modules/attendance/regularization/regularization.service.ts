import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type KnownApprovalSubjectType,
  type RecomputeSummary,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { AppError, describeError } from '../../../platform/common/errors.js';
import type { Database } from '../../../platform/db/db.provider.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import { NOTIFICATION_EVENTS } from '../../../platform/notifications/notification-events.js';
import { NotificationDispatcher } from '../../../platform/notifications/notification.dispatcher.js';
import type {
  ApprovalSubjectDecision,
  ApprovalSubjectSettlement,
} from '../../../platform/approvals/approval-subject.registry.js';
import { addDays } from '../day-engine/calendar-date.js';
import { DayEngineService } from '../day-engine/day-engine.service.js';
import {
  RegularizationRepository,
  type OnDutyRow,
  type RegularizationRow,
} from './regularization.repository.js';

/**
 * Regularization and on-duty (REQ-F-01 … REQ-F-05).
 *
 * Three things shape this file.
 *
 * **The limits are settings, and they are read every time.** REQ-F-02's window
 * and monthly cap live in `settings`, and `regularization-policy.ts` takes both
 * as arguments so nothing here can quietly become the place a default lives.
 * The settings catalogue names this slice as what enforces them; before this
 * existed it said "nothing reads it yet", and that was true.
 *
 * **Approval writes a record and recomputes, in that order, inline.** REQ-F-03:
 * "On approval, an adjusting record is written and the day is recomputed. The
 * original punches remain untouched and visible." `HolidayService` set the
 * pattern and the reasoning transfers whole -- an attendance day still reading
 * PENDING after its correction was approved is the bug that reaches payroll, so
 * the work happens in the request and reports what it did rather than waiting
 * for a queue that does not yet declare a `recompute-day` job.
 *
 * **A locked period is asked about before anything is written, not after.**
 * `computeDay` refuses a locked date on its own, which is enough for a caller
 * that only recomputes. It is not enough here: an adjustment stored against a
 * locked month would sit inert and then apply itself the moment somebody
 * reopened the month. REQ-E-09 says a locked period is not affected by a
 * regularization, and "not affected" has to include later.
 *
 * **It decides through the approval framework, not beside it.** REQ-I-01 wants
 * one approval mechanism for leave, regularization, on-duty, flagged punches
 * and device rebinding. Raising a request now raises an `approval_requests` row
 * in the same transaction, so it reaches the inbox and REQ-G-09's escalation
 * sweep can see it; deciding one goes through `ApprovalService.decide`, which
 * is the single place REQ-I-05, delegation (REQ-I-04) and the step route are
 * enforced. The framework then calls back into `applyApprovalDecision` /
 * `applyOnDutyDecision` through `ApprovalSubjectRegistry`, and those two
 * methods are the only writers of the adjustment row and the only callers of
 * the recompute.
 *
 * The `/regularizations/:id/approve` endpoints are kept and are **not** a
 * second path: they resolve the attached approval and hand it to the framework,
 * so a correction decided in the inbox and one decided on its own screen run
 * identical code and cannot produce different adjustments.
 */


/**
 * REQ-I-01's polymorphic subjects, for the two kinds this slice owns.
 *
 * Typed against the shared contract's list rather than written as bare strings,
 * so a typo is a compile error rather than an approval request nothing will
 * ever pick up.
 */
export const REGULARIZATION_SUBJECT_TYPE: KnownApprovalSubjectType = 'regularization';
export const ON_DUTY_SUBJECT_TYPE: KnownApprovalSubjectType = 'on_duty_request';

@Injectable()
export class RegularizationService {
  private readonly logger = new Logger(RegularizationService.name);

  constructor(
    private readonly auditContext: AuditContext,
    private readonly audit: AuditService,
    private readonly notifications: NotificationDispatcher,
    private readonly dayEngine: DayEngineService,
  ) {}

  // ------------------------------------------------------------ REQ-F-02

  /**
   * What a decision *means* for a correction (REQ-F-03, REQ-F-05).
   *
   * Called by the framework through `ApprovalSubjectRegistry`, inside the
   * framework's transaction, and **deliberately without re-checking the
   * approver**: by the time this runs the framework has established that this
   * actor holds `regularization.approve` and may act on this step under
   * REQ-I-05 and REQ-I-04, and a second opinion here is a second place that
   * rule can be wrong.
   *
   * The adjustment row is written here and nowhere else, in the same
   * transaction as the step that approved it -- REQ-F-03's "an adjusting record
   * is written" and the approval that authorised it cannot be allowed to commit
   * apart, because a request marked approved with no adjustment beside it is a
   * correction the muster will never show and a retry cannot tell that state
   * from a fresh one.
   */
  async applyApprovalDecision(
    ctx: OrgContext,
    decision: ApprovalSubjectDecision,
    executor: Database,
  ): Promise<ApprovalSubjectSettlement | null> {
    const repository = new RegularizationRepository(executor, ctx);
    // No scope predicate: the framework has already decided this actor may act
    // on this request, and the handler's job is the record, not the reader.
    const request = await repository.findRegularization(decision.subjectId, sql`true`);
    if (request === null) throw AppError.notFound('Regularization', decision.subjectId);

    if (request.status !== 'PENDING' && request.status !== 'ESCALATED') {
      // The framework's compare-and-swap should have made this unreachable.
      // Refused rather than trusted, because the cost of being wrong is a
      // second adjustment on a day that already has one.
      throw new AppError(
        ERROR_CODES.APPROVAL_ALREADY_ACTIONED,
        `This regularization is already ${request.status.toLowerCase()}.`,
        { details: { status: request.status } },
      );
    }

    if (decision.status === 'ESCALATED') {
      const moved = await repository.escalateRegularization(decision.subjectId);
      if (!moved) throw alreadyActionedError(decision.subjectId);
      return async () => {
        // Straight to the trail: escalation is the job's doing and there is no
        // request for the audit interceptor to hang an entry on.
        await this.audit.write({
          orgId: ctx.orgId,
          actorUserId: null,
          action: 'regularization.escalated',
          entityType: 'regularization',
          entityId: decision.subjectId,
          before: { status: request.status },
          after: { status: 'ESCALATED', approvalRequestId: decision.approvalRequestId },
        });
      };
    }

    if (decision.status === 'REJECTED') {
      // No adjustment and no recompute: a rejected correction changed nothing,
      // which is why the adjustment is written on approval rather than on raise.
      const moved = await repository.decideRegularization(decision.subjectId, {
        status: 'REJECTED',
        decidedAt: decision.at,
        decidedBy: decision.decidedByUserId,
        reason: decision.reason,
      });
      if (!moved) throw alreadyActionedError(decision.subjectId);

      return async () => {
        this.auditContext.record({
          action: 'regularization.rejected',
          entityType: 'regularization',
          entityId: decision.subjectId,
          orgId: ctx.orgId,
          before: { status: request.status },
          after: { status: 'REJECTED', reason: decision.reason },
        });
        await this.notifyDecision(ctx.orgId, request, 'rejected', decision.reason);
      };
    }

    // REQ-E-09 asked *before* anything is written, not after. `computeDay`
    // refuses a locked date on its own, which is enough for a caller that only
    // recomputes; it is not enough here, because an adjustment stored against a
    // locked month would sit inert and then apply itself the moment somebody
    // reopened the month. Throwing rolls the framework's transaction back, so
    // the step that approved it is unwritten too.
    if (await this.dayEngine.forOrg(ctx).isLocked(request.employeeId, request.date)) {
      throw new AppError(
        ERROR_CODES.PERIOD_LOCKED,
        `Attendance for ${request.date} is in a locked period, so this correction cannot be applied. Unlock the period first.`,
        { details: { reason: 'PERIOD_LOCKED', date: request.date } },
      );
    }

    const moved = await repository.decideRegularization(decision.subjectId, {
      status: 'APPROVED',
      decidedAt: decision.at,
      decidedBy: decision.decidedByUserId,
      reason: decision.reason,
    });
    if (!moved) throw alreadyActionedError(decision.subjectId);

    const adjustmentId = await repository.insertAdjustment({
      employeeId: request.employeeId,
      attendanceDate: request.date,
      regularizationId: decision.subjectId,
      adjustedIn: request.requestedIn === null ? null : new Date(request.requestedIn),
      adjustedOut: request.requestedOut === null ? null : new Date(request.requestedOut),
      // The employee's own words, not the approver's. A report showing why a
      // day was corrected wants the reason the correction was asked for.
      reason: request.reason,
      approvedBy: decision.decidedByUserId,
    });

    return async () => {
      // After the commit, so the engine reads the adjustment that was written
      // rather than one still inside an open transaction.
      const recompute = await this.recomputeDates(ctx, request.employeeId, [request.date]);

      this.auditContext.record({
        action: 'regularization.approved',
        entityType: 'regularization',
        entityId: decision.subjectId,
        orgId: ctx.orgId,
        before: { status: request.status },
        after: {
          status: 'APPROVED',
          adjustmentId,
          date: request.date,
          adjustedIn: request.requestedIn,
          adjustedOut: request.requestedOut,
          reason: decision.reason,
          recompute,
        },
      });

      await this.notifyDecision(ctx.orgId, request, 'approved', decision.reason);
    };
  }

  // ------------------------------------------------------------ REQ-F-04

  /**
   * What a decision *means* for an on-duty request (REQ-F-04).
   *
   * There is no adjustment row here. The day engine reads `on_duty_requests`
   * directly (`hasApprovedOnDuty`, step 4), so moving the status is the whole
   * of the write and the recompute after the commit is what makes it visible.
   *
   * No lock check, unlike a correction: an on-duty request is raised *ahead* of
   * the days it covers, so the ordinary case has no closed period to collide
   * with, and `computeDay` answers `locked` without writing for any day that
   * does -- counted and reported in the summary rather than refused. Refusing
   * the whole request because one day of a fortnight sits in a closed month
   * would lose the other thirteen.
   */
  async applyOnDutyDecision(
    ctx: OrgContext,
    decision: ApprovalSubjectDecision,
    executor: Database,
  ): Promise<ApprovalSubjectSettlement | null> {
    const repository = new RegularizationRepository(executor, ctx);
    const request = await repository.findOnDuty(decision.subjectId, sql`true`);
    if (request === null) throw AppError.notFound('On-duty request', decision.subjectId);

    if (request.status !== 'PENDING' && request.status !== 'ESCALATED') {
      throw new AppError(
        ERROR_CODES.APPROVAL_ALREADY_ACTIONED,
        `This on-duty request is already ${request.status.toLowerCase()}.`,
        { details: { status: request.status } },
      );
    }

    if (decision.status === 'ESCALATED') {
      const moved = await repository.escalateOnDuty(decision.subjectId);
      if (!moved) throw alreadyActionedError(decision.subjectId);
      return async () => {
        await this.audit.write({
          orgId: ctx.orgId,
          actorUserId: null,
          action: 'on_duty.escalated',
          entityType: 'on_duty_request',
          entityId: decision.subjectId,
          before: { status: request.status },
          after: { status: 'ESCALATED', approvalRequestId: decision.approvalRequestId },
        });
      };
    }

    const moved = await repository.decideOnDuty(decision.subjectId, {
      status: decision.status,
      decidedAt: decision.at,
      decidedBy: decision.decidedByUserId,
      reason: decision.reason,
    });
    if (!moved) throw alreadyActionedError(decision.subjectId);

    if (decision.status === 'REJECTED') {
      return async () => {
        this.auditContext.record({
          action: 'on_duty.rejected',
          entityType: 'on_duty_request',
          entityId: decision.subjectId,
          orgId: ctx.orgId,
          before: { status: request.status },
          after: { status: 'REJECTED', reason: decision.reason },
        });
        await this.notifyOnDutyDecision(ctx.orgId, request, 'rejected', decision.reason);
      };
    }

    return async () => {
      const recompute = await this.recomputeDates(
        ctx,
        request.employeeId,
        datesBetween(request.fromDate, request.toDate),
      );

      this.auditContext.record({
        action: 'on_duty.approved',
        entityType: 'on_duty_request',
        entityId: decision.subjectId,
        orgId: ctx.orgId,
        before: { status: request.status },
        after: {
          status: 'APPROVED',
          fromDate: request.fromDate,
          toDate: request.toDate,
          reason: decision.reason,
          recompute,
        },
      });

      await this.notifyOnDutyDecision(ctx.orgId, request, 'approved', decision.reason);
    };
  }

  // ------------------------------------------------------------ internals

  /**
   * REQ-F-03's recompute, and REQ-E-09's lock, in the shape `HolidayService`
   * uses.
   *
   * `computeDay` decides the lock itself and answers `locked` without writing,
   * so a race between the check above and this call cannot corrupt a closed
   * month. What this has to survive is one employee's misconfiguration: the
   * engine refuses a date the employee has no shift for, and an approval must
   * not fail because somebody's roster has a gap. Counted, logged with the
   * cause, and reported back.
   */
  private async recomputeDates(
    ctx: OrgContext,
    employeeId: string,
    dates: readonly string[],
  ): Promise<RecomputeSummary> {
    const summary = { considered: 0, recomputed: 0, locked: 0, failed: 0 };
    const engine = this.dayEngine.forOrg(ctx);

    for (const date of dates) {
      summary.considered += 1;
      try {
        const outcome = await engine.computeDay(employeeId, date);
        if (outcome.outcome === 'locked') summary.locked += 1;
        else summary.recomputed += 1;
      } catch (error: unknown) {
        summary.failed += 1;
        this.logger.warn(
          `Approved request on ${date} could not recompute employee ${employeeId}: ${describeError(error)}`,
        );
      }
    }

    return summary;
  }

  /** REQ-K-03: "regularization outcome" is on the list of events that notify. */
  private async notifyDecision(
    orgId: string,
    request: RegularizationRow,
    outcome: 'approved' | 'rejected',
    reason: string | null,
  ): Promise<void> {
    await this.notifications.emit({
      orgId,
      type: NOTIFICATION_EVENTS.REGULARIZATION_DECIDED,
      audience: { kind: 'employees', employeeIds: [request.employeeId] },
      payload: {
        outcome,
        date: request.date,
        regularizationId: request.id,
        // REQ-F-05: the employee is notified *with* the reason, so it travels
        // in the payload rather than only into the audit trail.
        reason,
      },
    });
  }

  private async notifyOnDutyDecision(
    orgId: string,
    request: OnDutyRow,
    outcome: 'approved' | 'rejected',
    reason: string | null,
  ): Promise<void> {
    await this.notifications.emit({
      orgId,
      type: NOTIFICATION_EVENTS.REGULARIZATION_DECIDED,
      audience: { kind: 'employees', employeeIds: [request.employeeId] },
      payload: {
        outcome,
        date:
          request.fromDate === request.toDate
            ? request.fromDate
            : `${request.fromDate} to ${request.toDate}`,
        regularizationId: request.id,
        reason,
      },
    });
  }
}

// ---------------------------------------------------------------- helpers

function alreadyActionedError(id: string): AppError {
  return new AppError(
    ERROR_CODES.APPROVAL_ALREADY_ACTIONED,
    'Somebody else decided this request a moment ago. Reload to see the outcome.',
    { details: { id } },
  );
}

/** Every calendar date in an inclusive range. */
function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

