import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  ON_DUTY_MAX_DAYS,
  PERMISSIONS,
  pageSlice,
  paginated,
  type OnDutyInput,
  type OnDutyQuery,
  type OnDutyRequest,
  type Paginated,
  type RecomputeSummary,
  type RegularizationInput,
  type RegularizationPolicyView,
  type RegularizationQuery,
  type RegularizationRefusal,
  type RegularizationRequest,
} from '@vyuha/shared';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError, describeError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { isUniqueViolation } from '../../../platform/db/pg-error.js';
import { NOTIFICATION_EVENTS } from '../../../platform/notifications/notification-events.js';
import { NotificationDispatcher } from '../../../platform/notifications/notification.dispatcher.js';
import { hasAnyPermission, orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService, type ScopeGrants } from '../../../platform/rbac/scope.service.js';
import { addDays } from '../day-engine/calendar-date.js';
import { DayEngineService } from '../day-engine/day-engine.service.js';
import { onDutyRequests, regularizations } from '../schema/index.js';
import {
  earliestRegularizableDate,
  monthBounds,
  refusalMessage,
  refuseRegularization,
} from './regularization-policy.js';
import {
  RegularizationRepository,
  type EmployeeRegularizationContext,
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
 * **It decides on its own endpoints.** REQ-I-01 wants one approval mechanism
 * for leave, regularization, on-duty, flagged punches and device rebinding,
 * and that join is deliberately supervised work (OPEN-QUESTIONS, "The leave /
 * approvals join, still unwired"). Until it lands, this is the decision point,
 * exactly as `LeaveService.approve` is for leave. `approval_request_id` is
 * already the foreign key for the join and stays null, so nothing written here
 * has to be unpicked when the framework starts creating rows.
 */

/** Who may see whose requests. The raise key is also the self key. */
export const REGULARIZATION_SCOPE_GRANTS: ScopeGrants = {
  self: PERMISSIONS.REGULARIZATION_RAISE,
  team: PERMISSIONS.REGULARIZATION_APPROVE,
};

const APPROVER_KEYS = [PERMISSIONS.REGULARIZATION_APPROVE] as const;

@Injectable()
export class RegularizationService {
  private readonly logger = new Logger(RegularizationService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly scopes: ScopeService,
    private readonly auditContext: AuditContext,
    private readonly notifications: NotificationDispatcher,
    private readonly dayEngine: DayEngineService,
  ) {}

  // ------------------------------------------------------------ REQ-F-02

  /**
   * The limits in force, and how much of the monthly one is spent.
   *
   * A GET, so the form can render honest bounds — the earliest date the
   * calendar should offer, and how many raises are left — instead of printing
   * 7 and 3 from a constant that goes stale the moment an administrator moves
   * the setting.
   */
  async policy(principal: Principal, requestedEmployeeId?: string): Promise<RegularizationPolicyView> {
    const repository = this.repository(principal);
    const employeeId = this.resolveEmployee(principal, requestedEmployeeId);
    const employee = await this.loadEmployee(repository, employeeId);

    const [limits, today] = await Promise.all([
      repository.readPolicy(),
      repository.todayFor(employee.timezone),
    ]);
    const month = monthBounds(today);
    const raisedThisMonth = await repository.countRaisedBetween(employeeId, month.from, month.to);

    return {
      windowDays: limits.windowDays,
      maxPerMonth: limits.maxPerMonth,
      earliestDate: earliestRegularizableDate({ today, windowDays: limits.windowDays }),
      today,
      raisedThisMonth,
      remainingThisMonth: Math.max(0, limits.maxPerMonth - raisedThisMonth),
    };
  }

  // ------------------------------------------------------------ REQ-F-01

  async raise(principal: Principal, input: RegularizationInput): Promise<RegularizationRequest> {
    const repository = this.repository(principal);
    const employeeId = this.resolveEmployee(principal, input.employeeId);
    const employee = await this.loadEmployee(repository, employeeId);

    const [limits, today] = await Promise.all([
      repository.readPolicy(),
      repository.todayFor(employee.timezone),
    ]);
    const month = monthBounds(today);
    const raisedThisMonth = await repository.countRaisedBetween(employeeId, month.from, month.to);

    const attempt = {
      date: input.date,
      today,
      windowDays: limits.windowDays,
      maxPerMonth: limits.maxPerMonth,
      raisedThisMonth,
      dateOfJoining: employee.dateOfJoining,
    };

    const refusal = refuseRegularization(attempt);
    if (refusal !== null) throw refusalError(refusal, attempt);

    // Before the write, not after: see the class comment on locked periods.
    if (await this.dayEngine.forOrg(orgContextOf(principal)).isLocked(employeeId, input.date)) {
      throw new AppError(ERROR_CODES.PERIOD_LOCKED, refusalMessage('PERIOD_LOCKED', attempt), {
        details: { reason: 'PERIOD_LOCKED', date: input.date },
      });
    }

    if ((await repository.findOpenForDate(employeeId, input.date)) !== null) {
      throw refusalError('ALREADY_PENDING', attempt);
    }

    const existingIn = await repository.firstInPunchAt(employeeId, input.date);
    const times = await repository.composeTimes({
      date: input.date,
      timezone: employee.timezone,
      requestedIn: input.requestedIn,
      requestedOut: input.requestedOut,
      existingIn,
    });

    const id = await this.insertRegularization(repository, {
      employeeId,
      date: input.date,
      kind: input.kind,
      requestedIn: times.adjustedIn,
      requestedOut: times.adjustedOut,
      reason: input.reason,
      attachmentFileId: input.attachmentFileId,
      attempt,
    });

    const record = await this.readRegularization(principal, id);

    this.auditContext.record({
      action: 'regularization.raised',
      entityType: 'regularization',
      entityId: id,
      before: null,
      after: {
        employeeId,
        date: input.date,
        kind: input.kind,
        requestedIn: times.adjustedIn?.toISOString() ?? null,
        requestedOut: times.adjustedOut?.toISOString() ?? null,
        reason: input.reason,
        raisedThisMonth: raisedThisMonth + 1,
        maxPerMonth: limits.maxPerMonth,
      },
    });

    return record;
  }

  async list(
    principal: Principal,
    query: RegularizationQuery,
  ): Promise<Paginated<RegularizationRequest>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).listRegularizations({
      scope: this.scopeFor(principal, regularizations.employeeId),
      status: query.status,
      employeeId: query.employeeId,
      from: query.from,
      to: query.to,
      limit,
      offset,
    });
    return paginated(rows.map(toRegularization), query, total);
  }

  async get(principal: Principal, id: string): Promise<RegularizationRequest> {
    return this.readRegularization(principal, id);
  }

  // ------------------------------------------------------------ REQ-F-03

  /**
   * "On approval, an adjusting record is written and the day is recomputed."
   *
   * The status move and the adjustment insert are one transaction, because
   * `attendance_adjustments` is what the day engine reads: a request marked
   * approved with no adjustment beside it is a correction the muster will never
   * show, and a retry cannot tell that state from a fresh one. The recompute
   * runs *after* the commit, so the engine reads the row that was written
   * rather than one still inside an open transaction.
   */
  async approve(
    principal: Principal,
    id: string,
    reason: string | null,
  ): Promise<RegularizationRequest> {
    const repository = this.repository(principal);
    const request = await this.loadForDecision(repository, principal, id);

    if (await this.dayEngine.forOrg(orgContextOf(principal)).isLocked(request.employeeId, request.date)) {
      throw new AppError(
        ERROR_CODES.PERIOD_LOCKED,
        `Attendance for ${request.date} is in a locked period, so this correction cannot be applied. Unlock the period first.`,
        { details: { reason: 'PERIOD_LOCKED', date: request.date } },
      );
    }

    const decidedAt = new Date();
    const adjustmentId = await repository.transaction(async (tx) => {
      const moved = await tx.decideRegularization(id, {
        status: 'APPROVED',
        decidedAt,
        decidedBy: principal.userId,
        reason,
      });
      // False means somebody else decided it between the read above and this
      // update. Raising here rolls the transaction back, so the adjustment
      // that would have been the second one is never written.
      if (!moved) throw alreadyActionedError(id);

      return tx.insertAdjustment({
        employeeId: request.employeeId,
        attendanceDate: request.date,
        regularizationId: id,
        adjustedIn: request.requestedIn === null ? null : new Date(request.requestedIn),
        adjustedOut: request.requestedOut === null ? null : new Date(request.requestedOut),
        // The employee's own words, not the approver's. A report showing why a
        // day was corrected wants the reason the correction was asked for.
        reason: request.reason,
        approvedBy: principal.userId,
      });
    });

    const recompute = await this.recomputeDates(principal, request.employeeId, [request.date]);

    this.auditContext.record({
      action: 'regularization.approved',
      entityType: 'regularization',
      entityId: id,
      before: { status: request.status },
      after: {
        status: 'APPROVED',
        adjustmentId,
        date: request.date,
        adjustedIn: request.requestedIn,
        adjustedOut: request.requestedOut,
        reason,
        recompute,
      },
    });

    await this.notifyDecision(principal, request, 'approved', reason);
    return this.readRegularization(principal, id);
  }

  /** REQ-F-05: "Rejection requires a reason. The employee is notified with it." */
  async reject(principal: Principal, id: string, reason: string): Promise<RegularizationRequest> {
    const repository = this.repository(principal);
    const request = await this.loadForDecision(repository, principal, id);

    // No adjustment and no recompute: a rejected correction changed nothing,
    // which is why the adjustment is written on approval rather than on raise.
    const moved = await repository.decideRegularization(id, {
      status: 'REJECTED',
      decidedAt: new Date(),
      decidedBy: principal.userId,
      reason,
    });
    if (!moved) throw alreadyActionedError(id);

    this.auditContext.record({
      action: 'regularization.rejected',
      entityType: 'regularization',
      entityId: id,
      before: { status: request.status },
      after: { status: 'REJECTED', reason },
    });

    await this.notifyDecision(principal, request, 'rejected', reason);
    return this.readRegularization(principal, id);
  }

  // ------------------------------------------------------------ REQ-F-04

  async raiseOnDuty(principal: Principal, input: OnDutyInput): Promise<OnDutyRequest> {
    const repository = this.repository(principal);
    const employeeId = this.resolveEmployee(principal, input.employeeId);
    const employee = await this.loadEmployee(repository, employeeId);

    const dates = datesBetween(input.fromDate, input.toDate);
    if (dates.length > ON_DUTY_MAX_DAYS) {
      throw AppError.validation(
        `An on-duty request may cover at most ${String(ON_DUTY_MAX_DAYS)} days; this one covers ${String(dates.length)}. Raise it in shorter stretches.`,
        { fields: [{ path: 'toDate', message: 'range too long', value: input.toDate }] },
      );
    }

    if (input.fromDate < employee.dateOfJoining) {
      throw AppError.validation(
        `${input.fromDate} is before this employee joined on ${employee.dateOfJoining}.`,
        { fields: [{ path: 'fromDate', message: 'before the date of joining' }] },
      );
    }

    // Unlike a regularization, on duty is raised *ahead* of the days it covers
    // -- REQ-F-04 is a field-duty declaration, not a correction -- so there is
    // no backward window and no future-date refusal here.
    const overlapping = await repository.findOverlappingOnDuty(
      employeeId,
      input.fromDate,
      input.toDate,
    );
    if (overlapping !== null) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Another on-duty request already covers part of these dates.',
        { details: { reason: 'OVERLAPPING_ON_DUTY', onDutyRequestId: overlapping } },
      );
    }

    const id = await repository.insertOnDuty({
      employeeId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      reason: input.reason,
      siteName: input.siteName,
    });

    this.auditContext.record({
      action: 'on_duty.raised',
      entityType: 'on_duty_request',
      entityId: id,
      before: null,
      after: {
        employeeId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason,
        siteName: input.siteName,
        days: dates.length,
      },
    });

    return this.readOnDuty(principal, id);
  }

  async listOnDuty(principal: Principal, query: OnDutyQuery): Promise<Paginated<OnDutyRequest>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).listOnDuty({
      scope: this.scopeFor(principal, onDutyRequests.employeeId),
      status: query.status,
      employeeId: query.employeeId,
      from: query.from,
      to: query.to,
      limit,
      offset,
    });
    return paginated(rows.map(toOnDuty), query, total);
  }

  async getOnDuty(principal: Principal, id: string): Promise<OnDutyRequest> {
    return this.readOnDuty(principal, id);
  }

  /**
   * REQ-F-04: "On approval, those days become ON_DUTY and count as present."
   *
   * There is no adjustment row here. The day engine reads
   * `on_duty_requests` directly (`hasApprovedOnDuty`, step 4), so approving is
   * the whole of the write and the recompute is what makes it visible.
   */
  async approveOnDuty(
    principal: Principal,
    id: string,
    reason: string | null,
  ): Promise<OnDutyRequest> {
    const repository = this.repository(principal);
    const request = await this.loadOnDutyForDecision(repository, principal, id);

    const moved = await repository.decideOnDuty(id, {
      status: 'APPROVED',
      decidedAt: new Date(),
      decidedBy: principal.userId,
      reason,
    });
    if (!moved) throw alreadyActionedError(id);

    const recompute = await this.recomputeDates(
      principal,
      request.employeeId,
      datesBetween(request.fromDate, request.toDate),
    );

    this.auditContext.record({
      action: 'on_duty.approved',
      entityType: 'on_duty_request',
      entityId: id,
      before: { status: request.status },
      after: {
        status: 'APPROVED',
        fromDate: request.fromDate,
        toDate: request.toDate,
        reason,
        recompute,
      },
    });

    await this.notifyOnDutyDecision(principal, request, 'approved', reason);
    return this.readOnDuty(principal, id);
  }

  /** REQ-F-05, the on-duty half. */
  async rejectOnDuty(principal: Principal, id: string, reason: string): Promise<OnDutyRequest> {
    const repository = this.repository(principal);
    const request = await this.loadOnDutyForDecision(repository, principal, id);

    const moved = await repository.decideOnDuty(id, {
      status: 'REJECTED',
      decidedAt: new Date(),
      decidedBy: principal.userId,
      reason,
    });
    if (!moved) throw alreadyActionedError(id);

    this.auditContext.record({
      action: 'on_duty.rejected',
      entityType: 'on_duty_request',
      entityId: id,
      before: { status: request.status },
      after: { status: 'REJECTED', reason },
    });

    await this.notifyOnDutyDecision(principal, request, 'rejected', reason);
    return this.readOnDuty(principal, id);
  }

  // ------------------------------------------------------------ internals

  private repository(principal: Principal): RegularizationRepository {
    return new RegularizationRepository(this.db, orgContextOf(principal));
  }

  private scopeFor(principal: Principal, employeeColumn: Parameters<ScopeService['resolve']>[2]) {
    return this.scopes.resolve(principal, REGULARIZATION_SCOPE_GRANTS, employeeColumn).where;
  }

  /**
   * Whose record this call acts on.
   *
   * Raising for yourself needs only `regularization.raise`, which every
   * Employee holds. Naming somebody else is the privileged act and is checked
   * here rather than at the route, because a guard cannot see which employee
   * the body asked for.
   */
  private resolveEmployee(principal: Principal, requested?: string): string {
    const own = principal.employeeId;
    if (requested === undefined || requested === own) {
      if (own === null) {
        throw AppError.validation(
          'This account has no employee record, so it has no attendance to correct. Name an employee.',
          { fields: [{ path: 'employeeId', message: 'required for this account' }] },
        );
      }
      return own;
    }
    if (!hasAnyPermission(principal, APPROVER_KEYS)) {
      throw AppError.forbidden('You may only raise a request for yourself.');
    }
    return requested;
  }

  private async loadEmployee(
    repository: RegularizationRepository,
    employeeId: string,
  ): Promise<EmployeeRegularizationContext> {
    const employee = await repository.findEmployee(employeeId);
    if (employee === null) throw AppError.notFound('Employee', employeeId);
    return employee;
  }

  private async readRegularization(
    principal: Principal,
    id: string,
  ): Promise<RegularizationRequest> {
    const row = await this.repository(principal).findRegularization(
      id,
      this.scopeFor(principal, regularizations.employeeId),
    );
    // Out of scope and non-existent answer the same, as everywhere else: a 403
    // would confirm that the id names a real request.
    if (row === null) throw AppError.notFound('Regularization', id);
    return toRegularization(row);
  }

  private async readOnDuty(principal: Principal, id: string): Promise<OnDutyRequest> {
    const row = await this.repository(principal).findOnDuty(
      id,
      this.scopeFor(principal, onDutyRequests.employeeId),
    );
    if (row === null) throw AppError.notFound('On-duty request', id);
    return toOnDuty(row);
  }

  /**
   * The request an approver is about to act on, with REQ-I-05 applied.
   *
   * "An approver cannot approve their own request; it routes to the next level
   * up." There is no next level to route to while this slice decides on its own
   * endpoints, so the refusal is the whole of it and another approver has to
   * act — which is what the framework will do properly when the join lands.
   */
  private async loadForDecision(
    repository: RegularizationRepository,
    principal: Principal,
    id: string,
  ): Promise<RegularizationRow> {
    const row = await repository.findRegularization(
      id,
      this.scopeFor(principal, regularizations.employeeId),
    );
    if (row === null) throw AppError.notFound('Regularization', id);
    assertDecidable(principal, row.employeeId, row.status, 'regularization');
    return row;
  }

  private async loadOnDutyForDecision(
    repository: RegularizationRepository,
    principal: Principal,
    id: string,
  ): Promise<OnDutyRow> {
    const row = await repository.findOnDuty(id, this.scopeFor(principal, onDutyRequests.employeeId));
    if (row === null) throw AppError.notFound('On-duty request', id);
    assertDecidable(principal, row.employeeId, row.status, 'on-duty request');
    return row;
  }

  private async insertRegularization(
    repository: RegularizationRepository,
    input: {
      employeeId: string;
      date: string;
      kind: RegularizationInput['kind'];
      requestedIn: Date | null;
      requestedOut: Date | null;
      reason: string;
      attachmentFileId: string | null;
      attempt: Parameters<typeof refusalMessage>[1];
    },
  ): Promise<string> {
    try {
      return await repository.insertRegularization(input);
    } catch (error: unknown) {
      // Two submissions racing each other land on the partial unique index
      // rather than on the read above; migration 0014 exists for exactly this.
      if (isUniqueViolation(error)) throw refusalError('ALREADY_PENDING', input.attempt, error);
      throw error;
    }
  }

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
    principal: Principal,
    employeeId: string,
    dates: readonly string[],
  ): Promise<RecomputeSummary> {
    const summary = { considered: 0, recomputed: 0, locked: 0, failed: 0 };
    const engine = this.dayEngine.forOrg(orgContextOf(principal));

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
    principal: Principal,
    request: RegularizationRow,
    outcome: 'approved' | 'rejected',
    reason: string | null,
  ): Promise<void> {
    await this.notifications.emit({
      orgId: principal.orgId,
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
    principal: Principal,
    request: OnDutyRow,
    outcome: 'approved' | 'rejected',
    reason: string | null,
  ): Promise<void> {
    await this.notifications.emit({
      orgId: principal.orgId,
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

/**
 * REQ-I-05, and the status check, in one place because both callers need both
 * and the order between them matters: an approver looking at their own already
 * decided request should be told it is theirs, which is the fact they can act
 * on by finding another approver.
 */
function assertDecidable(
  principal: Principal,
  requesterEmployeeId: string,
  status: string,
  subject: string,
): void {
  if (principal.employeeId !== null && principal.employeeId === requesterEmployeeId) {
    throw new AppError(
      ERROR_CODES.APPROVER_IS_REQUESTER,
      'You cannot decide your own request. Another approver has to.',
      { details: { subject } },
    );
  }
  if (status !== 'PENDING' && status !== 'ESCALATED') {
    throw new AppError(
      ERROR_CODES.APPROVAL_ALREADY_ACTIONED,
      `This ${subject} is already ${status.toLowerCase()}.`,
      { details: { status } },
    );
  }
}

function alreadyActionedError(id: string): AppError {
  return new AppError(
    ERROR_CODES.APPROVAL_ALREADY_ACTIONED,
    'Somebody else decided this request a moment ago. Reload to see the outcome.',
    { details: { id } },
  );
}

function refusalError(
  refusal: RegularizationRefusal,
  attempt: Parameters<typeof refusalMessage>[1],
  cause?: unknown,
): AppError {
  // A refusal here is always a statement about the state the request met -- a
  // date too old, a cap already spent -- rather than about the shape of the
  // request, which is why none of them is a 400. `HolidayService.elect` makes
  // the same call for the same reason.
  return new AppError(ERROR_CODES.CONFLICT, refusalMessage(refusal, attempt), {
    details: { reason: refusal, date: attempt.date },
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Every calendar date in an inclusive range. */
function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function toRegularization(row: RegularizationRow): RegularizationRequest {
  return {
    id: row.id,
    employee: { id: row.employeeId, name: row.employeeName },
    employeeCode: row.employeeCode,
    date: row.date,
    kind: row.kind,
    requestedIn: row.requestedIn,
    requestedOut: row.requestedOut,
    reason: row.reason,
    attachmentFileId: row.attachmentFileId,
    status: row.status,
    approvalRequestId: row.approvalRequestId,
    raisedAt: row.raisedAt,
    decidedAt: row.decidedAt,
    decidedBy:
      row.decidedById === null
        ? null
        : { id: row.decidedById, name: row.decidedByName ?? row.decidedById },
    decisionReason: row.decisionReason,
  };
}

function toOnDuty(row: OnDutyRow): OnDutyRequest {
  return {
    id: row.id,
    employee: { id: row.employeeId, name: row.employeeName },
    employeeCode: row.employeeCode,
    fromDate: row.fromDate,
    toDate: row.toDate,
    reason: row.reason,
    siteName: row.siteName,
    status: row.status,
    approvalRequestId: row.approvalRequestId,
    raisedAt: row.raisedAt,
    decidedAt: row.decidedAt,
    decidedBy:
      row.decidedById === null
        ? null
        : { id: row.decidedById, name: row.decidedByName ?? row.decidedById },
    decisionReason: row.decisionReason,
  };
}
