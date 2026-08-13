import { Injectable } from '@nestjs/common';
import {
  DEFAULT_LEAVE_YEAR_START_MONTH,
  ERROR_CODES,
  PERMISSIONS,
  leaveTypeInputSchema,
  leaveYearOf,
  pageSlice,
  paginated,
  roundLeaveDays,
  type CompOffCredit,
  type CompOffGrant,
  type CompOffQuery,
  type EmploymentType,
  type LeaveAdjustment,
  type LeaveApplication,
  type LeaveBalance,
  type LeaveBalanceQuery,
  type LeaveCalendar,
  type LeaveCalendarQuery,
  type LeaveCalendarWarning,
  type LeaveLedgerEntry,
  type LeaveLedgerQuery,
  type LeavePreview,
  type LeavePreviewBlocker,
  type LeaveRequest,
  type LeaveRequestDetail,
  type LeaveRequestQuery,
  type LeaveTypeInput,
  type LeaveTypePatch,
  type LeaveTypePolicy,
  type LeaveTypeQuery,
  type LeaveTypeRef,
  type Paginated,
} from '@vyuha/shared';
import { sql, type SQL } from 'drizzle-orm';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { NOTIFICATION_EVENTS } from '../../../platform/notifications/notification-events.js';
import { NotificationDispatcher } from '../../../platform/notifications/notification.dispatcher.js';
import { hasAnyPermission, orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService, type ScopeGrants } from '../../../platform/rbac/scope.service.js';
import { addDays, localDateIn } from '../day-engine/calendar-date.js';
import { matchesWeeklyOff } from '../day-engine/weekly-off.js';
import { leaveRequests as leaveRequestsTable } from '../schema/index.js';
import { negativeLimitShortfall, projectLedger, type ProjectedBalance } from './leave-balance.js';
import { expandLeaveDays, type LeaveDayExpansion } from './leave-days.js';
import {
  LEAVE_SETTING_KEYS,
  LeaveRepository,
  type CompOffCreditRow,
  type EmployeeLeaveContext,
  type LeaveRequestRow,
  type LeaveTypeRow,
} from './leave.repository.js';

/**
 * Leave types, balances, the ledger and applications (REQ-G-01 … REQ-G-12).
 *
 * Two rules shape this file.
 *
 * **The ledger is the truth and the balance is a cache.** Nothing here edits a
 * balance directly. Every path appends to `leave_ledger` and then recomputes
 * the affected balance from the whole year's movements, which is why a
 * cancellation "reverses the ledger entries" (REQ-G-10) rather than subtracting
 * a number, and why an interrupted operation leaves a balance that can be
 * rebuilt rather than one that is quietly wrong.
 *
 * **The preview and the application share one code path.** REQ-G-06 promises
 * the employee sees the days consumed and the balance after before they
 * submit. A second implementation of that arithmetic for the form is a second
 * implementation that can disagree, so `evaluate()` is called by both and the
 * only difference is that one of them writes.
 */

/** Who may see whose leave. `self` is the key that also grants applying. */
export const LEAVE_SCOPE_GRANTS: ScopeGrants = {
  self: PERMISSIONS.LEAVE_APPLY_SELF,
  team: PERMISSIONS.LEAVE_APPROVE_TEAM,
  all: PERMISSIONS.LEAVE_APPROVE_ALL,
};

const APPROVER_KEYS = [PERMISSIONS.LEAVE_APPROVE_TEAM, PERMISSIONS.LEAVE_APPROVE_ALL] as const;

/** REQ-G-11's default, until OPEN-QUESTIONS item 4 answers otherwise. */
export const DEFAULT_COMP_OFF_EXPIRY_DAYS = 30;

/** REQ-G-12. Zero -- the default -- means no threshold is configured. */
const DEFAULT_CONCURRENT_ABSENCE_THRESHOLD = 0;

/** `leave_ledger.reference_type` values this slice writes. */
const REFERENCE_LEAVE_REQUEST = 'leave_request';
const REFERENCE_COMP_OFF = 'comp_off_credit';
const REFERENCE_ADJUSTMENT = 'manual_adjustment';

interface LeaveEvaluation {
  readonly employee: EmployeeLeaveContext;
  readonly type: LeaveTypeRow;
  readonly expansion: LeaveDayExpansion;
  readonly leaveYear: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly blockers: LeavePreviewBlocker[];
}

@Injectable()
export class LeaveService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly scopes: ScopeService,
    private readonly auditContext: AuditContext,
    private readonly notifications: NotificationDispatcher,
  ) {}

  // ----------------------------------------------------------- leave types

  async listTypes(principal: Principal, query: LeaveTypeQuery): Promise<Paginated<LeaveTypePolicy>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).listLeaveTypes({
      active: query.active,
      limit,
      offset,
    });
    return paginated(rows.map(toLeaveTypePolicy), query, total);
  }

  async findType(principal: Principal, id: string): Promise<LeaveTypePolicy> {
    const row = await this.repository(principal).findLeaveType(id);
    if (row === null) throw AppError.notFound('Leave type', id);
    return toLeaveTypePolicy(row);
  }

  /** REQ-G-01. The code is unique per organisation among the living types. */
  async createType(principal: Principal, input: LeaveTypeInput): Promise<LeaveTypePolicy> {
    const repository = this.repository(principal);

    const clash = await repository.findLeaveTypeByCode(input.code);
    if (clash !== null) {
      throw AppError.conflict(`A leave type with the code ${input.code} already exists.`, {
        code: input.code,
        existingId: clash.id,
      });
    }

    const row = await repository.insertLeaveType({
      orgId: principal.orgId,
      name: input.name,
      code: input.code,
      isPaid: input.isPaid,
      accrualMethod: input.accrualMethod,
      annualEntitlement: input.annualEntitlement,
      carryForwardAllowed: input.carryForwardAllowed,
      carryForwardCap: input.carryForwardCap,
      negativeBalanceLimit: input.negativeBalanceLimit,
      isEncashable: input.isEncashable,
      allowsHalfDay: input.allowsHalfDay,
      minDays: input.minDays,
      maxDays: input.maxDays,
      noticeDays: input.noticeDays,
      attachmentRequiredAfterDays: input.attachmentRequiredAfterDays,
      countsSandwichDays: input.countsSandwichDays,
      requiresTwoStepApproval: input.requiresTwoStepApproval,
      applicableEmploymentTypes: [...input.applicableEmploymentTypes],
      isActive: input.isActive,
    });

    const policy = toLeaveTypePolicy(row);
    this.auditContext.record({
      action: 'leave_type.created',
      entityType: 'leave_type',
      entityId: policy.id,
      before: null,
      after: policy,
    });
    return policy;
  }

  /**
   * REQ-G-01. The code is deliberately absent from the patch schema: the
   * ledger, every report and every export cite it, so a rename would silently
   * re-label history that was written under the old one.
   */
  async updateType(
    principal: Principal,
    id: string,
    patch: LeaveTypePatch,
  ): Promise<LeaveTypePolicy> {
    const repository = this.repository(principal);
    const existing = await repository.findLeaveType(id);
    if (existing === null) throw AppError.notFound('Leave type', id);

    const before = toLeaveTypePolicy(existing);

    // The cross-field rules -- min against max, a cap on a type that cannot
    // carry forward -- can only be checked on the merged row. A patch that
    // clears `carryForwardAllowed` while leaving a cap standing is exactly the
    // case a partial schema cannot see.
    //
    // `id` is dropped rather than passed through: the input schema is
    // `.strict()`, and a policy object that silently accepted an unknown key
    // would be the wrong trade in the other direction.
    const { id: _id, ...current } = before;
    const merged = leaveTypeInputSchema.safeParse({
      ...current,
      applicableEmploymentTypes: [...before.applicableEmploymentTypes],
      ...patch,
    });
    if (!merged.success) {
      throw AppError.validation('That change would leave the leave type inconsistent.', {
        fields: merged.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const updated = await repository.updateLeaveType(id, {
      name: merged.data.name,
      isPaid: merged.data.isPaid,
      accrualMethod: merged.data.accrualMethod,
      annualEntitlement: merged.data.annualEntitlement,
      carryForwardAllowed: merged.data.carryForwardAllowed,
      carryForwardCap: merged.data.carryForwardCap,
      negativeBalanceLimit: merged.data.negativeBalanceLimit,
      isEncashable: merged.data.isEncashable,
      allowsHalfDay: merged.data.allowsHalfDay,
      minDays: merged.data.minDays,
      maxDays: merged.data.maxDays,
      noticeDays: merged.data.noticeDays,
      attachmentRequiredAfterDays: merged.data.attachmentRequiredAfterDays,
      countsSandwichDays: merged.data.countsSandwichDays,
      requiresTwoStepApproval: merged.data.requiresTwoStepApproval,
      applicableEmploymentTypes: [...merged.data.applicableEmploymentTypes],
      isActive: merged.data.isActive,
    });
    if (updated === null) throw AppError.notFound('Leave type', id);

    const after = toLeaveTypePolicy(updated);
    this.auditContext.record({
      action: 'leave_type.updated',
      entityType: 'leave_type',
      entityId: id,
      before,
      after,
    });
    return after;
  }

  // -------------------------------------------------------------- balances

  /**
   * REQ-G-03. Every active type is listed, including the ones with no
   * movements: a balance screen that hides a type at zero is a screen the
   * employee reads as "I do not have that leave".
   */
  async listBalances(
    principal: Principal,
    query: LeaveBalanceQuery,
  ): Promise<Paginated<LeaveBalance>> {
    const repository = this.repository(principal);
    const employeeId = await this.resolveViewableEmployee(principal, query.employeeId);

    const [stored, types] = await Promise.all([
      repository.readBalances(employeeId, query.year),
      repository.listLeaveTypes({ active: true, limit: 200, offset: 0 }),
    ]);

    const byType = new Map(stored.map((row) => [row.leaveTypeId, row]));
    const balances: LeaveBalance[] = types.rows.map((type) => {
      const row = byType.get(type.id);
      return {
        leaveType: { id: type.id, name: type.name, code: type.code },
        leaveYear: query.year,
        ...(row?.balance ?? {
          opening: 0,
          accrued: 0,
          availed: 0,
          adjusted: 0,
          carriedForward: 0,
          closing: 0,
        }),
      };
    });

    // A retired type with a standing balance still has to be visible: it is
    // the balance somebody is owed, and hiding it is how it gets lost.
    for (const row of stored) {
      if (byType.has(row.leaveTypeId) && types.rows.some((type) => type.id === row.leaveTypeId)) {
        continue;
      }
      balances.push({
        leaveType: { id: row.leaveTypeId, name: row.leaveTypeName, code: row.leaveTypeCode },
        leaveYear: query.year,
        ...row.balance,
      });
    }

    return {
      data: balances,
      meta: { page: 1, pageSize: balances.length, total: balances.length },
    };
  }

  async listLedger(
    principal: Principal,
    query: LeaveLedgerQuery,
  ): Promise<Paginated<LeaveLedgerEntry>> {
    const repository = this.repository(principal);
    const employeeId = await this.resolveViewableEmployee(principal, query.employeeId);
    const { limit, offset } = pageSlice(query);

    const rows = await repository.readLedger(employeeId, query.year, query.leaveTypeId);
    const filtered =
      query.movementType === undefined
        ? rows
        : rows.filter((row) => row.movementType === query.movementType);

    const types = await repository.listLeaveTypes({ limit: 200, offset: 0 });
    const typeById = new Map(types.rows.map((type) => [type.id, type]));

    const page = filtered.slice(offset, offset + limit).map((row): LeaveLedgerEntry => {
      const type = typeById.get(row.leaveTypeId);
      return {
        id: row.id,
        leaveType: {
          id: row.leaveTypeId,
          name: type?.name ?? 'Unknown',
          code: type?.code ?? '',
        },
        leaveYear: row.leaveYear,
        movementType: row.movementType,
        days: row.days,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      };
    });

    return paginated(page, query, filtered.length);
  }

  /** REQ-G-03's `adjusted` bucket. HR only; the controller carries the key. */
  async adjustBalance(principal: Principal, input: LeaveAdjustment): Promise<LeaveBalance> {
    const repository = this.repository(principal);

    const [employee, type] = await Promise.all([
      repository.findEmployee(input.employeeId),
      repository.findLeaveType(input.leaveTypeId),
    ]);
    if (employee === null) throw AppError.notFound('Employee', input.employeeId);
    if (type === null) throw AppError.notFound('Leave type', input.leaveTypeId);

    const balance = await repository.transaction(async (tx) => {
      await tx.appendLedger([
        {
          employeeId: employee.id,
          leaveTypeId: type.id,
          leaveYear: input.year,
          movementType: 'ADJUSTMENT',
          days: input.days,
          referenceType: REFERENCE_ADJUSTMENT,
          note: input.reason,
        },
      ]);
      return this.recomputeBalance(tx, employee.id, type.id, input.year);
    });

    this.auditContext.record({
      action: 'leave_balance.adjusted',
      entityType: 'leave_balance',
      entityId: employee.id,
      after: {
        employeeId: employee.id,
        leaveTypeId: type.id,
        leaveYear: input.year,
        days: input.days,
        reason: input.reason,
        closing: balance.closing,
      },
    });

    return {
      leaveType: { id: type.id, name: type.name, code: type.code },
      leaveYear: input.year,
      ...balance,
    };
  }

  // --------------------------------------------------------------- preview

  /** REQ-G-06. The same arithmetic `apply` runs, minus the writing. */
  async preview(
    principal: Principal,
    query: {
      leaveTypeId: string;
      fromDate: string;
      toDate: string;
      fromPortion: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';
      toPortion: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';
      employeeId?: string;
    },
  ): Promise<LeavePreview> {
    const repository = this.repository(principal);
    const employeeId = await this.resolveViewableEmployee(principal, query.employeeId);
    const evaluation = await this.evaluate(repository, employeeId, query, null);

    return {
      leaveType: {
        id: evaluation.type.id,
        name: evaluation.type.name,
        code: evaluation.type.code,
      },
      fromDate: query.fromDate,
      toDate: query.toDate,
      days: evaluation.expansion.days.map((day) => ({
        date: day.date,
        portion: day.portion,
        isCounted: day.isCounted,
      })),
      calendarDays: evaluation.expansion.calendarDays,
      workingDays: evaluation.expansion.workingDays,
      holidaysSkipped: evaluation.expansion.holidaysSkipped,
      weeklyOffsSkipped: evaluation.expansion.weeklyOffsSkipped,
      sandwichDaysCounted: evaluation.expansion.sandwichDaysCounted,
      halfDays: evaluation.expansion.halfDays,
      totalDays: evaluation.expansion.totalDays,
      leaveYear: evaluation.leaveYear,
      balanceBefore: evaluation.balanceBefore,
      balanceAfter: evaluation.balanceAfter,
      negativeBalanceLimit: evaluation.type.negativeBalanceLimit,
      blockers: evaluation.blockers,
    };
  }

  // ----------------------------------------------------------- application

  /** REQ-G-06, validated by REQ-G-07 and REQ-G-08. */
  async apply(principal: Principal, input: LeaveApplication): Promise<LeaveRequestDetail> {
    const repository = this.repository(principal);
    const employeeId = this.resolveApplicant(principal, input.employeeId);
    const evaluation = await this.evaluate(repository, employeeId, input, input.attachmentFileId);

    const blocker = evaluation.blockers[0];
    if (blocker !== undefined) throw blockerToError(blocker, evaluation);

    const requestId = await repository.insertRequest(
      {
        employeeId,
        leaveTypeId: evaluation.type.id,
        fromDate: input.fromDate,
        toDate: input.toDate,
        totalDays: evaluation.expansion.totalDays,
        reason: input.reason,
        attachmentFileId: input.attachmentFileId,
      },
      evaluation.expansion.days,
    );

    this.auditContext.record({
      action: 'leave_request.applied',
      entityType: 'leave_request',
      entityId: requestId,
      before: null,
      after: {
        employeeId,
        leaveTypeId: evaluation.type.id,
        fromDate: input.fromDate,
        toDate: input.toDate,
        totalDays: evaluation.expansion.totalDays,
        balanceBefore: evaluation.balanceBefore,
      },
    });

    // REQ-G-09 routes this to the reporting manager. `permission` rather than
    // a resolved manager id because the generic approval framework owns
    // routing (REQ-I-01) and will replace this call when it lands -- see the
    // note on `approve` about where the join is made.
    await this.notifications.emit({
      orgId: principal.orgId,
      type: NOTIFICATION_EVENTS.LEAVE_APPLIED,
      audience: { kind: 'permission', key: PERMISSIONS.LEAVE_APPROVE_TEAM },
      payload: {
        employeeName: evaluation.employee.name,
        leaveType: evaluation.type.name,
        fromDate: input.fromDate,
        toDate: input.toDate,
        leaveRequestId: requestId,
      },
    });

    return this.getRequest(principal, requestId);
  }

  async listRequests(
    principal: Principal,
    query: LeaveRequestQuery,
  ): Promise<Paginated<LeaveRequest>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).listRequests({
      scope: this.scopeFor(principal),
      status: query.pendingForMe === true ? 'PENDING' : query.status,
      employeeId: query.employeeId,
      from: query.from,
      to: query.to,
      limit,
      offset,
    });
    return paginated(rows.map(toLeaveRequest), query, total);
  }

  async getRequest(principal: Principal, id: string): Promise<LeaveRequestDetail> {
    const repository = this.repository(principal);
    const row = await repository.findRequest(id, this.scopeFor(principal));
    // Out of scope and non-existent answer the same, as everywhere else: a 403
    // would confirm that the id names a real request.
    if (row === null) throw AppError.notFound('Leave request', id);

    const days = await repository.findRequestDays(id);
    return { ...toLeaveRequest(row), days };
  }

  /**
   * REQ-G-09.
   *
   * **Where the generic approval framework joins.** REQ-I-01 says one
   * mechanism serves leave, regularization, on-duty, flagged punches and
   * device rebinding, and that slice is being built in parallel. Until it
   * publishes a contract, this method is the decision point: it checks the
   * approver permission, refuses self-approval (REQ-I-05), writes the ledger
   * and moves the status.
   *
   * When the framework lands, the change is that `apply` also creates an
   * `approval_requests` row -- `leave_requests.approval_request_id` is already
   * the foreign key for it, from migration 0004 -- and this method becomes the
   * handler the framework calls on its final step rather than an endpoint of
   * its own. Nothing about the ledger writing below changes, which is why it
   * is deliberately kept out of the permission check above it.
   */
  async approve(principal: Principal, id: string, reason: string | null): Promise<LeaveRequestDetail> {
    const repository = this.repository(principal);
    const request = await this.loadForDecision(repository, principal, id);

    if (request.status !== 'PENDING' && request.status !== 'ESCALATED') {
      throw new AppError(
        ERROR_CODES.APPROVAL_ALREADY_ACTIONED,
        `This leave request is already ${request.status.toLowerCase()}.`,
        { details: { status: request.status } },
      );
    }

    const leaveYear = await this.leaveYearFor(repository, request.fromDate);

    // One transaction, because `leave_ledger` is append-only: a deduction
    // written by a step whose status update then failed cannot be taken back,
    // and the retry would deduct the days a second time.
    await repository.transaction(async (tx) => {
      // REQ-G-03: the deduction happens on approval, not on application. A
      // pending request holds no balance -- it is checked against the balance,
      // and the check runs again here because the balance can have moved since.
      await tx.appendLedger([
        {
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          leaveYear,
          movementType: 'AVAILED',
          days: -request.totalDays,
          referenceType: REFERENCE_LEAVE_REQUEST,
          referenceId: request.id,
          note: reason,
        },
      ]);
      await this.recomputeBalance(tx, request.employeeId, request.leaveTypeId, leaveYear);

      const updated = await tx.updateRequest(id, {
        status: 'APPROVED',
        decidedAt: new Date(),
        decidedBy: principal.userId,
        decisionReason: reason,
      });
      if (updated === null) throw AppError.notFound('Leave request', id);
    });

    this.auditContext.record({
      action: 'leave_request.approved',
      entityType: 'leave_request',
      entityId: id,
      before: { status: request.status },
      after: { status: 'APPROVED', totalDays: request.totalDays, reason },
    });

    await this.notifications.emit({
      orgId: principal.orgId,
      type: NOTIFICATION_EVENTS.LEAVE_APPROVED,
      audience: { kind: 'employees', employeeIds: [request.employeeId] },
      payload: {
        leaveType: request.leaveTypeName,
        fromDate: request.fromDate,
        toDate: request.toDate,
        approverName: principal.email,
        leaveRequestId: id,
      },
    });

    return this.getRequest(principal, id);
  }

  /** REQ-F-05: "rejection requires a reason. The employee is notified with it." */
  async reject(principal: Principal, id: string, reason: string): Promise<LeaveRequestDetail> {
    const repository = this.repository(principal);
    const request = await this.loadForDecision(repository, principal, id);

    if (request.status !== 'PENDING' && request.status !== 'ESCALATED') {
      throw new AppError(
        ERROR_CODES.APPROVAL_ALREADY_ACTIONED,
        `This leave request is already ${request.status.toLowerCase()}.`,
        { details: { status: request.status } },
      );
    }

    // No ledger movement: a rejected request never consumed anything, so
    // there is nothing to reverse. This is why the deduction happens on
    // approval rather than on application.
    const updated = await repository.updateRequest(id, {
      status: 'REJECTED',
      decidedAt: new Date(),
      decidedBy: principal.userId,
      decisionReason: reason,
    });
    if (updated === null) throw AppError.notFound('Leave request', id);

    this.auditContext.record({
      action: 'leave_request.rejected',
      entityType: 'leave_request',
      entityId: id,
      before: { status: request.status },
      after: { status: 'REJECTED', reason },
    });

    await this.notifications.emit({
      orgId: principal.orgId,
      type: NOTIFICATION_EVENTS.LEAVE_REJECTED,
      audience: { kind: 'employees', employeeIds: [request.employeeId] },
      payload: {
        leaveType: request.leaveTypeName,
        fromDate: request.fromDate,
        toDate: request.toDate,
        reason,
        leaveRequestId: id,
      },
    });

    return this.getRequest(principal, id);
  }

  /**
   * REQ-G-10: "before the start date by the employee directly; on or after the
   * start date via approval."
   *
   * Read literally, and with no parallel approval mechanism invented for it:
   * before the start date the owner may cancel their own request, and from the
   * start date onwards only somebody holding an approver key can. That is what
   * "via approval" reduces to while REQ-I-01's framework is being built
   * elsewhere; when it lands, the second branch becomes an approval request of
   * type LEAVE with a cancellation subject, and this method stays the handler.
   */
  async cancel(principal: Principal, id: string, reason: string | null): Promise<LeaveRequestDetail> {
    const repository = this.repository(principal);
    const request = await repository.findRequest(id, this.scopeFor(principal));
    if (request === null) throw AppError.notFound('Leave request', id);

    if (request.status === 'CANCELLED' || request.status === 'REJECTED') {
      throw new AppError(
        ERROR_CODES.APPROVAL_ALREADY_ACTIONED,
        `This leave request is already ${request.status.toLowerCase()}.`,
        { details: { status: request.status } },
      );
    }

    const today = await this.today(request.employeeId);
    const isOwner = principal.employeeId !== null && principal.employeeId === request.employeeId;
    const isApprover = hasAnyPermission(principal, APPROVER_KEYS);

    if (request.fromDate <= today && !isApprover) {
      throw AppError.forbidden(
        'Leave that has already started can only be cancelled by an approver.',
      );
    }
    if (!isOwner && !isApprover) {
      throw AppError.forbidden('Only the employee or an approver can cancel this leave.');
    }

    const now = new Date();
    const leaveYear = await this.leaveYearFor(repository, request.fromDate);

    // REQ-G-10: "cancellation reverses the ledger entries". Reversed, never
    // deleted -- the ledger refuses a delete, and the pair of rows is the
    // record that the leave happened and then did not.
    await repository.transaction(async (tx) => {
      if (request.status === 'APPROVED') {
        await tx.appendLedger([
          {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            leaveYear,
            movementType: 'REVERSAL',
            days: request.totalDays,
            referenceType: REFERENCE_LEAVE_REQUEST,
            referenceId: request.id,
            note: reason ?? 'Cancelled',
          },
        ]);
        await this.recomputeBalance(tx, request.employeeId, request.leaveTypeId, leaveYear);
      }

      const updated = await tx.updateRequest(id, {
        status: 'CANCELLED',
        cancelledAt: now,
        cancellationReason: reason,
      });
      if (updated === null) throw AppError.notFound('Leave request', id);
    });

    this.auditContext.record({
      action: 'leave_request.cancelled',
      entityType: 'leave_request',
      entityId: id,
      before: { status: request.status },
      after: { status: 'CANCELLED', reason, reversedDays: request.status === 'APPROVED' ? request.totalDays : 0 },
    });

    await this.notifications.emit({
      orgId: principal.orgId,
      type: NOTIFICATION_EVENTS.LEAVE_CANCELLED,
      audience: { kind: 'employees', employeeIds: [request.employeeId] },
      payload: {
        leaveType: request.leaveTypeName,
        fromDate: request.fromDate,
        toDate: request.toDate,
        leaveRequestId: id,
      },
    });

    // The affected days are recomputed by the day engine on its next pass.
    // Calling it from here would make a cancellation as slow as a month of
    // recomputation and would couple this slice to the engine's write path;
    // `leave_request_days` is what the engine reads, and it is already right.
    return this.getRequest(principal, id);
  }

  // -------------------------------------------------------------- comp-off

  /** REQ-G-11. Granted against a specific worked holiday or weekly off. */
  async grantCompOff(principal: Principal, input: CompOffGrant): Promise<CompOffCredit> {
    const repository = this.repository(principal);

    const employee = await repository.findEmployee(input.employeeId);
    if (employee === null) throw AppError.notFound('Employee', input.employeeId);

    const type = await this.requireCompOffType(repository);

    const expiryDays = await repository.readIntSetting(
      LEAVE_SETTING_KEYS.compOffExpiryDays,
      DEFAULT_COMP_OFF_EXPIRY_DAYS,
      1,
      3_650,
    );
    const expiresOn = input.expiresOn ?? addDays(input.earnedForDate, expiryDays);

    const existing = await repository.listCompOff({
      scope: sql`true`,
      employeeId: employee.id,
      limit: 200,
      offset: 0,
    });
    if (existing.rows.some((row) => row.earnedForDate === input.earnedForDate)) {
      throw AppError.conflict('A comp-off credit already exists for that date.', {
        employeeId: employee.id,
        earnedForDate: input.earnedForDate,
      });
    }

    const leaveYear = await this.leaveYearFor(repository, input.earnedForDate);

    // The credit and the days it grants are one fact. Split across two
    // commits, a failure between them leaves either a credit that granted
    // nothing or days nobody can trace to a worked date.
    const creditId = await repository.transaction(async (tx) => {
      const id = await tx.insertCompOff({
        employeeId: employee.id,
        leaveTypeId: type.id,
        earnedForDate: input.earnedForDate,
        days: input.days,
        expiresOn,
      });

      await tx.appendLedger([
        {
          employeeId: employee.id,
          leaveTypeId: type.id,
          leaveYear,
          movementType: 'ACCRUAL',
          days: input.days,
          referenceType: REFERENCE_COMP_OFF,
          referenceId: id,
          note: input.note ?? `Worked ${input.earnedForDate}`,
        },
      ]);
      await this.recomputeBalance(tx, employee.id, type.id, leaveYear);
      return id;
    });

    this.auditContext.record({
      action: 'comp_off.granted',
      entityType: 'comp_off_credit',
      entityId: creditId,
      before: null,
      after: {
        employeeId: employee.id,
        earnedForDate: input.earnedForDate,
        days: input.days,
        expiresOn,
      },
    });

    const listed = await repository.listCompOff({
      scope: sql`true`,
      employeeId: employee.id,
      limit: 200,
      offset: 0,
    });
    const row = listed.rows.find((candidate) => candidate.id === creditId);
    if (row === undefined) throw new Error('Comp-off credit vanished immediately after insert.');
    return toCompOffCredit(row);
  }

  async listCompOff(principal: Principal, query: CompOffQuery): Promise<Paginated<CompOffCredit>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).listCompOff({
      scope: this.scopeFor(principal, 'compOff'),
      employeeId: query.employeeId,
      state: query.state,
      limit,
      offset,
    });
    return paginated(rows.map(toCompOffCredit), query, total);
  }

  // -------------------------------------------------------------- calendar

  /** REQ-G-12. */
  async calendar(principal: Principal, query: LeaveCalendarQuery): Promise<LeaveCalendar> {
    const repository = this.repository(principal);
    const [entries, threshold] = await Promise.all([
      repository.listCalendarEntries({
        scope: this.scopeFor(principal),
        from: query.from,
        to: query.to,
        departmentId: query.departmentId,
      }),
      repository.readIntSetting(
        LEAVE_SETTING_KEYS.concurrentAbsenceThreshold,
        DEFAULT_CONCURRENT_ABSENCE_THRESHOLD,
        0,
        10_000,
      ),
    ]);

    const warnings: LeaveCalendarWarning[] = [];
    if (threshold > 0) {
      const counts = new Map<string, { count: number; date: string; department: { id: string; name: string } | null }>();
      for (const entry of entries) {
        const key = `${entry.date}|${entry.departmentId ?? ''}`;
        const seen = counts.get(key);
        if (seen === undefined) {
          counts.set(key, {
            count: 1,
            date: entry.date,
            department:
              entry.departmentId === null || entry.departmentName === null
                ? null
                : { id: entry.departmentId, name: entry.departmentName },
          });
        } else {
          seen.count += 1;
        }
      }
      for (const value of counts.values()) {
        if (value.count >= threshold) {
          warnings.push({
            date: value.date,
            department: value.department,
            awayCount: value.count,
            threshold,
          });
        }
      }
      warnings.sort((a, b) => a.date.localeCompare(b.date));
    }

    return {
      from: query.from,
      to: query.to,
      entries: entries.map((entry) => ({
        employee: { id: entry.employeeId, name: entry.employeeName },
        department:
          entry.departmentId === null || entry.departmentName === null
            ? null
            : { id: entry.departmentId, name: entry.departmentName },
        leaveType: {
          id: entry.leaveTypeId,
          name: entry.leaveTypeName,
          code: entry.leaveTypeCode,
        },
        date: entry.date,
        portion: entry.portion,
        leaveRequestId: entry.leaveRequestId,
      })),
      warnings,
      threshold,
    };
  }

  // ------------------------------------------------------------- internals

  repositoryFor(orgId: string, actorUserId: string | null): LeaveRepository {
    return new LeaveRepository(this.db, { orgId, actorUserId });
  }

  private repository(principal: Principal): LeaveRepository {
    return new LeaveRepository(this.db, orgContextOf(principal));
  }

  private scopeFor(principal: Principal, table: 'requests' | 'compOff' = 'requests'): SQL {
    const column =
      table === 'compOff'
        ? sql.raw('"comp_off_credits"."employee_id"')
        : leaveRequestsTable.employeeId;
    return this.scopes.resolve(principal, LEAVE_SCOPE_GRANTS, column).where;
  }

  /**
   * Which employee's records this caller is asking about.
   *
   * Defaults to their own. An explicit id is allowed and then filtered by the
   * scope predicate at the query, so asking for a colleague's balance returns
   * an empty balance rather than theirs -- the same answer a non-existent id
   * gets.
   */
  private async resolveViewableEmployee(
    principal: Principal,
    requested: string | undefined,
  ): Promise<string> {
    if (requested === undefined) {
      if (principal.employeeId === null) {
        throw AppError.validation(
          'This account has no employee record, so it has no leave of its own. Name an employee.',
        );
      }
      return principal.employeeId;
    }

    if (requested === principal.employeeId) return requested;
    if (!hasAnyPermission(principal, APPROVER_KEYS)) {
      throw AppError.forbidden("You cannot view another employee's leave.");
    }

    // Confirms the id is inside the caller's scope before any read runs on it.
    const inScope = await this.db.execute<{ ok: boolean }>(sql`
      SELECT true AS ok FROM employees
       WHERE org_id = ${principal.orgId} AND id = ${requested}::uuid AND deleted_at IS NULL
         AND ${this.scopes.resolve(principal, LEAVE_SCOPE_GRANTS, sql.raw('"employees"."id"')).where}
       LIMIT 1
    `);
    if (inScope.rows.length === 0) throw AppError.notFound('Employee', requested);
    return requested;
  }

  /** REQ-G-06: applying for somebody else needs the org-wide approver key. */
  private resolveApplicant(principal: Principal, requested: string | undefined): string {
    if (requested === undefined || requested === principal.employeeId) {
      if (principal.employeeId === null) {
        throw AppError.validation('This account has no employee record, so it cannot take leave.');
      }
      return principal.employeeId;
    }
    if (!hasAnyPermission(principal, [PERMISSIONS.LEAVE_APPROVE_ALL])) {
      throw AppError.forbidden('You cannot apply for leave on behalf of another employee.');
    }
    return requested;
  }

  private async loadForDecision(
    repository: LeaveRepository,
    principal: Principal,
    id: string,
  ): Promise<LeaveRequestRow> {
    if (!hasAnyPermission(principal, APPROVER_KEYS)) {
      throw AppError.forbidden('You do not have permission to decide leave requests.');
    }

    const request = await repository.findRequest(id, this.scopeFor(principal));
    if (request === null) throw AppError.notFound('Leave request', id);

    // REQ-I-05: "an approver cannot approve their own request". Enforced here
    // rather than left to the framework, because this endpoint exists now and
    // an approver who is also an employee would otherwise self-approve today.
    if (principal.employeeId !== null && principal.employeeId === request.employeeId) {
      throw new AppError(
        ERROR_CODES.APPROVER_IS_REQUESTER,
        'You cannot decide your own leave request.',
      );
    }

    return request;
  }

  /**
   * The one place the day count, the calendar and the balance meet.
   *
   * Called by `preview` and by `apply`, so the number the form shows is the
   * number that is written. Returns blockers rather than throwing, because the
   * form needs all of them at once and the application needs the first.
   */
  private async evaluate(
    repository: LeaveRepository,
    employeeId: string,
    input: {
      leaveTypeId: string;
      fromDate: string;
      toDate: string;
      fromPortion: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';
      toPortion: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';
    },
    attachmentFileId: string | null,
  ): Promise<LeaveEvaluation> {
    if (input.toDate < input.fromDate) {
      throw AppError.validation('The leave cannot end before it starts.', {
        fields: [{ path: 'toDate', message: 'must not be before the start date' }],
      });
    }

    const [employee, type] = await Promise.all([
      repository.findEmployee(employeeId),
      repository.findLeaveType(input.leaveTypeId),
    ]);
    if (employee === null) throw AppError.notFound('Employee', employeeId);
    if (type === null) throw AppError.notFound('Leave type', input.leaveTypeId);

    const [holidayDates, weeklyOffConfig, lockedMonths, startMonth] = await Promise.all([
      repository.findHolidayDates(employee, input.fromDate, input.toDate),
      repository.findWeeklyOffConfig(employee),
      repository.findLockedMonths(employee.locationId, input.fromDate, input.toDate),
      this.leaveYearStartMonth(repository),
    ]);

    const expansion = expandLeaveDays({
      fromDate: input.fromDate,
      toDate: input.toDate,
      fromPortion: input.fromPortion,
      toPortion: input.toPortion,
      isHoliday: (date) => holidayDates.has(date),
      isWeeklyOff: (date) =>
        weeklyOffConfig !== null && matchesWeeklyOff(weeklyOffConfig, date),
      countsSandwichDays: type.countsSandwichDays,
    });

    const leaveYear = leaveYearOf(input.fromDate, startMonth);
    const ledger = await repository.readLedger(employeeId, leaveYear, type.id);
    const balanceBefore = projectLedger(ledger).closing;
    const balanceAfter = roundLeaveDays(balanceBefore - expansion.totalDays);

    const blockers: LeavePreviewBlocker[] = [];

    if (!type.isActive) blockers.push('TYPE_INACTIVE');

    if (
      type.applicableEmploymentTypes.length > 0 &&
      !type.applicableEmploymentTypes.includes(employee.employmentType)
    ) {
      blockers.push('EMPLOYMENT_TYPE_NOT_ALLOWED');
    }

    if (expansion.totalDays <= 0) blockers.push('NO_WORKING_DAYS');

    if (!type.allowsHalfDay && expansion.halfDays > 0) blockers.push('HALF_DAY_NOT_ALLOWED');

    if (type.minDays !== null && expansion.totalDays > 0 && expansion.totalDays < type.minDays) {
      blockers.push('BELOW_MINIMUM_DAYS');
    }
    if (type.maxDays !== null && expansion.totalDays > type.maxDays) {
      blockers.push('ABOVE_MAXIMUM_DAYS');
    }

    // REQ-G-08. A limit of 0 means the balance may not go below zero at all,
    // which is the ordinary case; a limit of 5 means it may reach -5.
    const shortfall = negativeLimitShortfall({
      closingBefore: balanceBefore,
      daysRequested: expansion.totalDays,
      negativeBalanceLimit: type.negativeBalanceLimit,
    });
    if (shortfall > 0) {
      blockers.push(
        type.negativeBalanceLimit > 0 ? 'NEGATIVE_LIMIT_EXCEEDED' : 'INSUFFICIENT_BALANCE',
      );
    }

    const countedDates = expansion.days.filter((day) => day.isCounted).map((day) => day.date);
    const overlaps = await repository.findOverlappingDates(employeeId, countedDates);
    if (overlaps.length > 0) blockers.push('OVERLAPS_EXISTING');

    // REQ-G-07's notice period, measured from today to the first day off.
    if (type.noticeDays > 0) {
      const today = await this.today(employeeId);
      if (input.fromDate < addDays(today, type.noticeDays)) blockers.push('NOTICE_PERIOD');
    }

    if (
      type.attachmentRequiredAfterDays !== null &&
      expansion.totalDays > type.attachmentRequiredAfterDays &&
      attachmentFileId === null
    ) {
      blockers.push('ATTACHMENT_REQUIRED');
    }

    if (lockedMonths.size > 0) {
      const touched = expansion.days.some((day) => lockedMonths.has(day.date.slice(0, 7)));
      if (touched) blockers.push('PERIOD_LOCKED');
    }

    return { employee, type, expansion, leaveYear, balanceBefore, balanceAfter, blockers };
  }

  /**
   * Rebuilds one balance from its whole year of movements and stores it.
   *
   * Whole year, not a delta. A delta is faster and is the reason balances
   * drift: it is correct only if every previous delta was, and there is no
   * point at which anybody notices that one was not. This is a handful of rows
   * behind an index built for exactly this query (technical design §4.3).
   */
  async recomputeBalance(
    repository: LeaveRepository,
    employeeId: string,
    leaveTypeId: string,
    leaveYear: number,
  ): Promise<ProjectedBalance> {
    const ledger = await repository.readLedger(employeeId, leaveYear, leaveTypeId);
    const balance = projectLedger(ledger);
    await repository.upsertBalance(employeeId, leaveTypeId, leaveYear, balance);
    return balance;
  }

  async leaveYearStartMonth(repository: LeaveRepository): Promise<number> {
    return repository.readIntSetting(
      LEAVE_SETTING_KEYS.yearStartMonth,
      DEFAULT_LEAVE_YEAR_START_MONTH,
      1,
      12,
    );
  }

  private async leaveYearFor(repository: LeaveRepository, date: string): Promise<number> {
    return leaveYearOf(date, await this.leaveYearStartMonth(repository));
  }

  /**
   * Today, where the employee is standing (NFR-05).
   *
   * The server's own date is not the answer: an employee in a location an hour
   * ahead applying at 00:30 would have their notice period measured from
   * yesterday.
   */
  private async today(employeeId: string): Promise<string> {
    const rows = await this.db.execute<{ zone: string }>(sql`
      SELECT coalesce(l.timezone, o.timezone) AS zone
        FROM employees e
        JOIN organizations o ON o.id = e.org_id
        LEFT JOIN locations l ON l.id = e.location_id AND l.deleted_at IS NULL
       WHERE e.id = ${employeeId}::uuid AND e.deleted_at IS NULL
       LIMIT 1
    `);
    const zone = rows.rows[0]?.zone;
    if (typeof zone !== 'string' || zone.length === 0) {
      throw new Error(`No timezone resolved for employee ${employeeId}.`);
    }
    return localDateIn(new Date(), zone);
  }

  /**
   * REQ-G-11 needs a leave type to credit, and REQ-G-02 seeds one called
   * Compensatory Off with the code CO.
   *
   * Looked up by code rather than by a flag column, because the five seed
   * types are "all editable" and an organisation that renames the type must
   * not break comp-off. Refused loudly when it is missing: minting a credit
   * against an invented type would put days into a balance nobody can find.
   */
  private async requireCompOffType(repository: LeaveRepository): Promise<LeaveTypeRow> {
    const type = await repository.findLeaveTypeByCode(COMP_OFF_TYPE_CODE);
    if (type === null) {
      throw AppError.validation(
        `No leave type with the code ${COMP_OFF_TYPE_CODE} exists, so a comp-off credit has nothing to credit. Create it first.`,
      );
    }
    return type;
  }
}

/** REQ-G-02's Compensatory Off. The seed creates it; HR may rename it. */
export const COMP_OFF_TYPE_CODE = 'CO';

function toLeaveTypePolicy(row: LeaveTypeRow): LeaveTypePolicy {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    isPaid: row.isPaid,
    accrualMethod: row.accrualMethod,
    annualEntitlement: row.annualEntitlement,
    carryForwardAllowed: row.carryForwardAllowed,
    carryForwardCap: row.carryForwardCap,
    negativeBalanceLimit: row.negativeBalanceLimit,
    isEncashable: row.isEncashable,
    allowsHalfDay: row.allowsHalfDay,
    minDays: row.minDays,
    maxDays: row.maxDays,
    noticeDays: row.noticeDays,
    attachmentRequiredAfterDays: row.attachmentRequiredAfterDays,
    countsSandwichDays: row.countsSandwichDays,
    requiresTwoStepApproval: row.requiresTwoStepApproval,
    // Stored as `text[]`, so the contract's enum is asserted on the way out
    // rather than assumed: a value written before an enum member was removed
    // must not silently widen the type the client sees.
    applicableEmploymentTypes: row.applicableEmploymentTypes.filter(isEmploymentType),
    isActive: row.isActive,
  };
}

const EMPLOYMENT_TYPE_VALUES: ReadonlySet<string> = new Set([
  'PERMANENT',
  'CONTRACT',
  'PROBATION',
  'INTERN',
]);

function isEmploymentType(value: string): value is EmploymentType {
  return EMPLOYMENT_TYPE_VALUES.has(value);
}

function typeRefOf(row: {
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeCode: string;
}): LeaveTypeRef {
  return { id: row.leaveTypeId, name: row.leaveTypeName, code: row.leaveTypeCode };
}

function toLeaveRequest(row: LeaveRequestRow): LeaveRequest {
  return {
    id: row.id,
    employee: { id: row.employeeId, name: row.employeeName },
    leaveType: typeRefOf(row),
    fromDate: row.fromDate,
    toDate: row.toDate,
    totalDays: row.totalDays,
    reason: row.reason,
    status: row.status,
    attachmentFileId: row.attachmentFileId,
    approvalRequestId: row.approvalRequestId,
    appliedAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    decidedBy:
      row.decidedBy === null
        ? null
        : { id: row.decidedBy, name: row.decidedByName ?? 'Unknown' },
    cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
  };
}

function toCompOffCredit(row: CompOffCreditRow): CompOffCredit {
  return {
    id: row.id,
    employee: { id: row.employeeId, name: row.employeeName },
    leaveType: typeRefOf(row),
    earnedForDate: row.earnedForDate,
    days: row.days,
    expiresOn: row.expiresOn,
    consumedByLeaveRequestId: row.consumedByLeaveRequestId,
    lapsedAt: row.lapsedAt === null ? null : row.lapsedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * One error code per blocker, so the web client can key off the code rather
 * than string-match the message (technical design §6).
 */
function blockerToError(blocker: LeavePreviewBlocker, evaluation: LeaveEvaluation): AppError {
  const details = {
    leaveTypeId: evaluation.type.id,
    totalDays: evaluation.expansion.totalDays,
    balanceBefore: evaluation.balanceBefore,
    balanceAfter: evaluation.balanceAfter,
    blockers: evaluation.blockers,
  };

  switch (blocker) {
    case 'INSUFFICIENT_BALANCE':
      return new AppError(
        ERROR_CODES.LEAVE_INSUFFICIENT_BALANCE,
        'There is not enough balance for these dates.',
        { details },
      );
    case 'NEGATIVE_LIMIT_EXCEEDED':
      return new AppError(
        ERROR_CODES.LEAVE_NEGATIVE_LIMIT_EXCEEDED,
        'This would take the balance past the negative limit for this leave type.',
        { details: { ...details, negativeBalanceLimit: evaluation.type.negativeBalanceLimit } },
      );
    case 'OVERLAPS_EXISTING':
      return new AppError(
        ERROR_CODES.LEAVE_OVERLAPS_EXISTING,
        'These dates overlap leave that has already been applied for.',
        { details },
      );
    case 'NOTICE_PERIOD':
      return new AppError(
        ERROR_CODES.LEAVE_NOTICE_PERIOD,
        `This leave type needs ${String(evaluation.type.noticeDays)} day(s) of notice.`,
        { details: { ...details, noticeDays: evaluation.type.noticeDays } },
      );
    case 'ATTACHMENT_REQUIRED':
      return new AppError(
        ERROR_CODES.LEAVE_ATTACHMENT_REQUIRED,
        'A supporting document is required for a leave this long.',
        {
          details: {
            ...details,
            attachmentRequiredAfterDays: evaluation.type.attachmentRequiredAfterDays,
          },
        },
      );
    case 'PERIOD_LOCKED':
      return new AppError(
        ERROR_CODES.PERIOD_LOCKED,
        'These dates fall in a period that has been locked.',
        { details },
      );
    default:
      // The remaining blockers are shape problems with the application rather
      // than policy refusals, so they answer 400 with the field named.
      return AppError.validation(BLOCKER_MESSAGES[blocker], { ...details, blocker });
  }
}

const BLOCKER_MESSAGES: Record<LeavePreviewBlocker, string> = {
  INSUFFICIENT_BALANCE: 'There is not enough balance for these dates.',
  NEGATIVE_LIMIT_EXCEEDED: 'This would take the balance past the negative limit.',
  OVERLAPS_EXISTING: 'These dates overlap leave that has already been applied for.',
  NOTICE_PERIOD: 'This leave type needs more notice than these dates give.',
  ATTACHMENT_REQUIRED: 'A supporting document is required for a leave this long.',
  BELOW_MINIMUM_DAYS: 'This is shorter than the minimum this leave type allows.',
  ABOVE_MAXIMUM_DAYS: 'This is longer than the maximum this leave type allows.',
  NO_WORKING_DAYS: 'Every day in this range is a holiday or a weekly off, so nothing is consumed.',
  PERIOD_LOCKED: 'These dates fall in a period that has been locked.',
  HALF_DAY_NOT_ALLOWED: 'This leave type cannot be taken as a half day.',
  EMPLOYMENT_TYPE_NOT_ALLOWED: 'This leave type is not available for this employment type.',
  TYPE_INACTIVE: 'This leave type is no longer in use.',
};
