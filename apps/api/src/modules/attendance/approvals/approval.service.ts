import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_APPROVAL_ESCALATION_DAYS,
  ERROR_CODES,
  MAX_APPROVAL_ESCALATION_DAYS,
  MAX_APPROVAL_SUBJECT_CHARS,
  PERMISSIONS,
  pageSlice,
  paginated,
  type ApprovalDecision,
  type ApprovalDelegation,
  type ApprovalInboxQuery,
  type ApprovalRequestDetail,
  type ApprovalRequestSummary,
  type ApprovalType,
  type BulkApprovalDecisionInput,
  type BulkApprovalResult,
  type BulkApprovalSkip,
  type CreateDelegationInput,
  type Paginated,
} from '@vyuha/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { AppError, describeError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import { hasPermission, orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService, type ScopeGrants } from '../../../platform/rbac/scope.service.js';
import { users } from '../../../platform/db/schema/index.js';
import { approvalDelegations, delegationLiveOn } from '../schema/approval.schema.js';
import { ApprovalRoutingService } from './approval-routing.service.js';
import {
  evaluateDecision,
  isStale,
  nextEscalationTarget,
  planRoute,
  type DecisionRefusal,
} from './approval-policy.js';
import {
  ApprovalDelegationRepository,
  ApprovalRepository,
  ApprovalStepRepository,
  ApprovalSweepRepository,
  toDelegation,
  type ApprovalListFilters,
} from './approval.repository.js';

/**
 * The approval framework (REQ-I-01 … REQ-I-05).
 *
 * Two audiences. Over HTTP it is the inbox: list, decide, delegate. In process
 * it is the seam every other slice attaches to -- `raise`, `findForSubject`,
 * `cancelForSubject` -- and that seam is the part that has to stay still,
 * because the leave slice is written against it while this file is being
 * finished. Nothing in here knows what a leave request is.
 *
 * The rules themselves are not here. They are pure functions in
 * `approval-policy.ts`, so REQ-I-05 can be exercised exhaustively without a
 * database; this file supplies the facts those functions decide on and turns
 * their verdicts into `AppError`s.
 */

/**
 * The permission family for approvals, widest first.
 *
 * `self` is `leave.apply.self` rather than an approval key of its own: PRD §5
 * gives a requester the right to see their own request, and every account that
 * can raise one holds that key. The two `approve` keys are what widen the view
 * beyond the caller's own row.
 */
export const APPROVAL_SCOPE_GRANTS: ScopeGrants = {
  self: PERMISSIONS.LEAVE_APPLY_SELF,
  team: PERMISSIONS.LEAVE_APPROVE_TEAM,
  all: PERMISSIONS.LEAVE_APPROVE_ALL,
};

/** Holding either is what the guard checks before any decision endpoint. */
export const APPROVAL_ACT_KEYS = [
  PERMISSIONS.LEAVE_APPROVE_TEAM,
  PERMISSIONS.LEAVE_APPROVE_ALL,
] as const;

/** `exclusion_violation`, Postgres error class 23. */
const EXCLUSION_VIOLATION = '23P01';

/**
 * Drizzle wraps a driver failure in an error whose message is the SQL and puts
 * the real one in `cause`, so the code is never on the error that was thrown.
 * `pg-error.ts` does the same walk for unique violations; this is the one code
 * it does not cover, and it lives here rather than in the platform file
 * because the overlapping-delegation constraint is the only thing that raises
 * it today.
 */
function isExclusionViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ('code' in current && current.code === EXCLUSION_VIOLATION) return true;
    if (!(current instanceof Error)) return false;
    current = current.cause;
  }
  return false;
}

/**
 * What a slice hands the framework to put something up for approval.
 *
 * `subject` is the sentence the inbox renders, and it is required for the
 * reason REQ-I-01 gives: the alternative is the inbox joining five subject
 * tables and branching on type, which is four inboxes wearing one URL.
 */
export interface RaiseApprovalInput {
  readonly type: ApprovalType;
  /** `snake_case`; see `APPROVAL_SUBJECT_TYPES` in the shared contract. */
  readonly subjectType: string;
  readonly subjectId: string;
  readonly subject: string;
  readonly requesterUserId: string;
  /**
   * The route, nearest approver first. Omit it and the framework builds the
   * REQ-G-09 default: the reporting line, then everyone who can approve for
   * the whole organisation.
   */
  readonly approverUserIds?: readonly string[];
  /** REQ-G-09's N. 0 disables escalation for this request. */
  readonly escalateAfterDays?: number;
}

/** How many stale requests one sweep will move. */
const ESCALATION_BATCH = 500;

export interface EscalationOutcome {
  readonly scanned: number;
  readonly escalated: number;
  /** Stale, but the reporting line above them is exhausted. */
  readonly exhausted: number;
}

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly scopes: ScopeService,
    private readonly auditContext: AuditContext,
    private readonly audit: AuditService,
    private readonly routing: ApprovalRoutingService,
  ) {}

  // ------------------------------------------------------- the in-process seam

  /**
   * Puts a subject up for approval (REQ-I-01, REQ-I-02).
   *
   * The whole route is written as steps up front rather than one step at a
   * time. That makes "is there a level above this one" a lookup instead of a
   * re-derivation, which matters because the escalation job asks it hours
   * later, when the reporting line may have changed -- re-deriving would move
   * a request to somebody the requester never routed it to.
   */
  async raise(ctx: OrgContext, input: RaiseApprovalInput): Promise<ApprovalRequestDetail> {
    // Checked here rather than left to the contract's constants to be honoured
    // by convention: `raise` is called in process by other slices, so there is
    // no Zod pipe between them and this, and an exported limit nothing enforces
    // is worse than no limit at all.
    const subject = input.subject.trim();
    if (subject.length === 0 || subject.length > MAX_APPROVAL_SUBJECT_CHARS) {
      throw AppError.validation(
        `An approval needs a subject line of 1 to ${String(MAX_APPROVAL_SUBJECT_CHARS)} characters.`,
        { fields: [{ path: 'subject', message: 'must be a short, readable line' }] },
      );
    }

    const escalateAfterDays = input.escalateAfterDays ?? DEFAULT_APPROVAL_ESCALATION_DAYS;
    if (escalateAfterDays < 0 || escalateAfterDays > MAX_APPROVAL_ESCALATION_DAYS) {
      throw AppError.validation(
        `Escalation must be between 0 and ${String(MAX_APPROVAL_ESCALATION_DAYS)} days; 0 disables it.`,
        { fields: [{ path: 'escalateAfterDays', message: 'out of range' }] },
      );
    }

    const candidates =
      input.approverUserIds ?? (await this.routing.defaultRoute(ctx.orgId, input.requesterUserId));

    // REQ-I-05, applied before the request exists: a route whose first level is
    // the requester would sit in its author's own inbox until the escalation
    // job rescued it.
    const route = planRoute(input.requesterUserId, candidates);

    if (route.length === 0) {
      throw AppError.conflict(
        'This request has nobody to approve it. Set a reporting manager, or give someone leave.approve.all.',
        { subjectType: input.subjectType, subjectId: input.subjectId },
      );
    }

    const requests = new ApprovalRepository(this.db, ctx);
    const steps = new ApprovalStepRepository(this.db, ctx);

    const request = await requests.insert({
      type: input.type,
      requesterUserId: input.requesterUserId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectSummary: subject,
      currentStep: 1,
      status: 'PENDING',
      currentStepStartedAt: new Date(),
      escalateAfterDays,
    });

    await steps.insertMany(
      route.map((approverUserId, index) => ({
        approvalRequestId: request.id,
        stepNo: index + 1,
        approverUserId,
      })),
    );

    this.auditContext.record({
      action: 'approval.raised',
      entityType: 'approval_request',
      entityId: request.id,
      orgId: ctx.orgId,
      after: {
        type: input.type,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        route,
      },
    });

    return this.buildDetail(ctx, request.id);
  }

  /** The current approval for a subject, if it has one. */
  async findForSubject(
    ctx: OrgContext,
    subjectType: string,
    subjectId: string,
  ): Promise<ApprovalRequestDetail | null> {
    const row = await new ApprovalRepository(this.db, ctx).findBySubject(subjectType, subjectId);
    return row === null ? null : this.buildDetail(ctx, row.id);
  }

  /**
   * Withdraws an open request (REQ-G-10: an employee cancels their own leave
   * before it starts). Returns null when there was nothing open to cancel,
   * which is not an error -- the caller's subject is being cancelled either
   * way, and a request already decided is a fact, not a failure.
   */
  async cancelForSubject(
    ctx: OrgContext,
    subjectType: string,
    subjectId: string,
    reason: string,
  ): Promise<ApprovalRequestDetail | null> {
    const requests = new ApprovalRepository(this.db, ctx);
    const row = await requests.findBySubject(subjectType, subjectId);
    if (row === null || (row.status !== 'PENDING' && row.status !== 'ESCALATED')) return null;

    // The open step is deliberately left unanswered. Writing `REJECT` onto it
    // would put "rejected by the requester" in the REQ-I-02 history for
    // something nobody decided -- a withdrawal is the absence of a decision,
    // and the reason for it belongs in the trail, which the audit row carries.
    const now = new Date();
    const updated = await requests.advance(row.id, row.currentStep, row.currentStep, 'CANCELLED', now);
    if (updated === null) return null;

    this.auditContext.record({
      action: 'approval.cancelled',
      entityType: 'approval_request',
      entityId: row.id,
      orgId: ctx.orgId,
      before: { status: row.status },
      after: { status: 'CANCELLED', reason },
    });

    return this.buildDetail(ctx, row.id);
  }

  // ------------------------------------------------------------------ reading

  async list(
    principal: Principal,
    query: ApprovalInboxQuery,
  ): Promise<Paginated<ApprovalRequestSummary>> {
    const { limit, offset } = pageSlice(query);
    const ctx = orgContextOf(principal);

    const { rows, total } = await new ApprovalRepository(this.db, ctx).list({
      ...this.filtersFor(principal, query),
      limit,
      offset,
    });

    return paginated(rows, query, total);
  }

  async detail(principal: Principal, id: string): Promise<ApprovalRequestDetail> {
    const ctx = orgContextOf(principal);
    const requests = new ApprovalRepository(this.db, ctx);

    // Visibility is checked as its own predicate rather than by fetching and
    // comparing: out of scope and non-existent must answer identically, or a
    // 403 confirms that the id names a real request in somebody else's team.
    const visible = await requests.isVisible(id, {
      ...this.filtersFor(principal, { view: 'all', page: 1, pageSize: 1 }),
      limit: 1,
      offset: 0,
    });
    if (!visible) throw AppError.notFound('Approval request', id);

    return this.buildDetail(ctx, id);
  }

  // ----------------------------------------------------------------- deciding

  async decide(
    principal: Principal,
    id: string,
    action: ApprovalDecision,
    reason: string | null,
  ): Promise<ApprovalRequestDetail> {
    const ctx = orgContextOf(principal);
    const outcome = await this.applyDecision(principal, ctx, id, action, reason);
    if (!outcome.ok) throw this.toError(outcome.refusal);
    return this.buildDetail(ctx, id);
  }

  /**
   * REQ-I-03's bulk action.
   *
   * Each request is decided on its own terms and a refusal skips that request
   * rather than the batch. Refusing everything because one row was decided by
   * a colleague thirty seconds ago would make the button unusable on exactly
   * the inbox it exists for; dropping that row silently would make the count a
   * lie. The skip list is how the client says which and why.
   */
  async bulkDecide(
    principal: Principal,
    input: BulkApprovalDecisionInput,
  ): Promise<BulkApprovalResult> {
    const ctx = orgContextOf(principal);
    const applied: string[] = [];
    const skipped: BulkApprovalSkip[] = [];

    // Deduplicated: the same id twice would be decided once and counted twice.
    for (const id of [...new Set(input.ids)]) {
      const outcome = await this.applyDecision(
        principal,
        ctx,
        id,
        input.action,
        input.reason ?? null,
      );
      if (outcome.ok) applied.push(id);
      else skipped.push({ id, code: outcome.refusal.code, message: outcome.refusal.message });
    }

    return { applied, skipped };
  }

  // -------------------------------------------------------------- delegation

  /** REQ-I-04. The caller delegates their own decisions; never anyone else's. */
  async createDelegation(
    principal: Principal,
    input: CreateDelegationInput,
  ): Promise<ApprovalDelegation> {
    if (input.toUserId === principal.userId) {
      throw AppError.validation('You cannot delegate your approvals to yourself.', {
        fields: [{ path: 'toUserId', message: 'must be another user' }],
      });
    }

    const delegate = await this.delegateOf(principal.orgId, input.toUserId);
    if (delegate === null) {
      throw AppError.notFound('User', input.toUserId);
    }
    if (!delegate.canApprove) {
      // Refused rather than allowed to stand: a delegate with no approval key
      // is refused by the route guard when they try to act, and the approver
      // who delegated would have no way to discover that their cover does not
      // work until a request went unanswered.
      throw AppError.conflict(
        'That user cannot approve anything, so a delegation to them would do nothing. Give them leave.approve.team first.',
        { toUserId: input.toUserId },
      );
    }

    const ctx = orgContextOf(principal);
    const repository = new ApprovalDelegationRepository(this.db, ctx);

    let created;
    try {
      created = await repository.insert({
        fromUserId: principal.userId,
        toUserId: input.toUserId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason ?? null,
      });
    } catch (error: unknown) {
      if (isExclusionViolation(error)) {
        throw AppError.conflict(
          'You already have a live delegation to that user covering some of those dates.',
          { toUserId: input.toUserId, fromDate: input.fromDate, toDate: input.toDate },
        );
      }
      throw error;
    }

    const row = await repository.findJoined(created.id);
    if (row === null) {
      throw new Error('Delegation was written but could not be read back.');
    }

    this.auditContext.record({
      action: 'approval.delegated',
      entityType: 'approval_delegation',
      entityId: created.id,
      orgId: principal.orgId,
      after: {
        toUserId: input.toUserId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason ?? null,
      },
    });

    return toDelegation(row);
  }

  /** Both directions: what the caller granted, and what was granted to them. */
  async listDelegations(principal: Principal): Promise<ApprovalDelegation[]> {
    const rows = await new ApprovalDelegationRepository(
      this.db,
      orgContextOf(principal),
    ).involving(principal.userId);
    return rows.map(toDelegation);
  }

  async revokeDelegation(principal: Principal, id: string): Promise<ApprovalDelegation> {
    const ctx = orgContextOf(principal);
    const repository = new ApprovalDelegationRepository(this.db, ctx);

    const row = await repository.findJoined(id);
    // Out of scope and non-existent answer identically, as everywhere else.
    if (row === null) throw AppError.notFound('Delegation', id);

    // The owner, or someone who can approve for the whole organisation and so
    // has to be able to undo a delegation made by an approver who has left.
    const isOwner = row.fromUserId === principal.userId;
    if (!isOwner && !hasPermission(principal, PERMISSIONS.LEAVE_APPROVE_ALL)) {
      throw AppError.forbidden('Only the approver who made a delegation can withdraw it.');
    }

    const revoked = await repository.revoke(id, new Date());
    if (!revoked) throw AppError.conflict('That delegation has already been withdrawn.');

    this.auditContext.record({
      action: 'approval.delegation_revoked',
      entityType: 'approval_delegation',
      entityId: id,
      orgId: principal.orgId,
      before: { revokedAt: null },
      after: { revokedAt: new Date().toISOString() },
    });

    const after = await repository.findJoined(id);
    if (after === null) throw new Error('Delegation was revoked but could not be read back.');
    return toDelegation(after);
  }

  // -------------------------------------------------------------- escalation

  /**
   * REQ-G-09: "Auto-escalate to HR if untouched for N days (default 3)."
   *
   * Idempotent by construction rather than by a flag: moving a request sets
   * `current_step_started_at` to now, so a second sweep in the same minute
   * finds nothing stale. A run interrupted halfway leaves exactly the
   * unescalated requests selectable.
   *
   * Not org-scoped, because the job is not a person -- see
   * `ApprovalSweepRepository`. Every write below goes through a scoped
   * repository built with the org id the sweep returned.
   */
  async escalateStale(now: Date): Promise<EscalationOutcome> {
    const candidates = await new ApprovalSweepRepository(this.db).stale(now, ESCALATION_BATCH);

    let escalated = 0;
    let exhausted = 0;

    for (const candidate of candidates) {
      // The SQL already applied the threshold; re-asking in the domain
      // function is what keeps the two definitions of "stale" from drifting,
      // and costs nothing per row.
      if (
        !isStale({
          now,
          currentStepStartedAt: candidate.currentStepStartedAt,
          escalateAfterDays: candidate.escalateAfterDays,
        })
      ) {
        continue;
      }

      // Null actor: `columns.ts` says the audit trail is authoritative for
      // who, and a job has no user to name.
      const ctx: OrgContext = { orgId: candidate.orgId, actorUserId: null };

      try {
        if (await this.escalateOne(ctx, candidate.id)) escalated += 1;
        else exhausted += 1;
      } catch (error: unknown) {
        // One bad request must not stop the sweep, and a swallowed failure
        // must not look like a clean run -- so it is counted as untouched and
        // logged with its id.
        exhausted += 1;
        this.logger.error({
          msg: 'Escalating one approval request failed; the sweep continued.',
          approvalRequestId: candidate.id,
          orgId: candidate.orgId,
          reason: describeError(error),
        });
      }
    }

    return { scanned: candidates.length, escalated, exhausted };
  }

  // ---------------------------------------------------------------- internals

  private filtersFor(
    principal: Principal,
    query: Pick<ApprovalInboxQuery, 'view'> & Partial<ApprovalInboxQuery>,
  ): Omit<ApprovalListFilters, 'limit' | 'offset'> {
    return {
      view: query.view,
      scope: this.scopeFor(principal),
      actorUserId: principal.userId,
      type: query.type,
      status: query.status,
      subjectType: query.subjectType,
    };
  }

  /**
   * Technical design §10: the fragment comes from `ScopeService`, never from
   * here. Written against the *requester's* employee id, which is the column
   * naming the person an approval request is about.
   */
  private scopeFor(principal: Principal): SQL {
    return this.scopes.resolve(
      principal,
      APPROVAL_SCOPE_GRANTS,
      sql`"requester_user"."employee_id"`,
    ).where;
  }

  /**
   * One decision, end to end, returning a refusal rather than throwing.
   *
   * Shared by the single and bulk paths so there is exactly one place REQ-I-05
   * is enforced. A bulk path with its own copy of these checks is how the rule
   * ends up true for one endpoint and not the other.
   */
  private async applyDecision(
    principal: Principal,
    ctx: OrgContext,
    id: string,
    action: ApprovalDecision,
    reason: string | null,
  ): Promise<{ ok: true } | { ok: false; refusal: DecisionRefusal }> {
    const requests = new ApprovalRepository(this.db, ctx);
    const steps = new ApprovalStepRepository(this.db, ctx);

    const request = await requests.findRow(id);
    if (request === null) {
      // Inside a bulk body this is a skip, not a 404 for the whole batch.
      return {
        ok: false,
        refusal: { code: 'FORBIDDEN', message: 'That request does not exist.' },
      };
    }

    const current = await steps.at(id, request.currentStep);

    const eligibility = evaluateDecision({
      actorUserId: principal.userId,
      requesterUserId: request.requesterUserId,
      status: request.status,
      currentApproverUserId: current?.approverUserId ?? null,
      delegatedFromUserIds: await this.liveDelegatorsTo(principal),
      hasApproveAll: hasPermission(principal, PERMISSIONS.LEAVE_APPROVE_ALL),
    });

    if (!eligibility.ok) return { ok: false, refusal: eligibility.refusal };

    if (current === null) {
      // Open, but its route ran out -- an escalation with nowhere to go left
      // it here. Nobody can act until the route is extended.
      return {
        ok: false,
        refusal: {
          code: 'APPROVAL_ALREADY_ACTIONED',
          message: 'This request has no approver at its current step.',
        },
      };
    }

    const now = new Date();

    const recorded = await steps.recordAction({
      stepId: current.id,
      action,
      actedByUserId: principal.userId,
      delegatedFromUserId: eligibility.delegatedFromUserId,
      reason,
      at: now,
    });
    if (!recorded) {
      return {
        ok: false,
        refusal: {
          code: 'APPROVAL_ALREADY_ACTIONED',
          message: 'Somebody decided this step first.',
        },
      };
    }

    const next = action === 'APPROVE' ? await steps.at(id, request.currentStep + 1) : null;
    const updated =
      action === 'REJECT'
        ? await requests.advance(id, request.currentStep, request.currentStep, 'REJECTED', now)
        : next === null
          ? await requests.advance(id, request.currentStep, request.currentStep, 'APPROVED', now)
          : await requests.advance(id, request.currentStep, next.stepNo, 'PENDING', now);

    if (updated === null) {
      return {
        ok: false,
        refusal: {
          code: 'APPROVAL_ALREADY_ACTIONED',
          message: 'Somebody decided this request first.',
        },
      };
    }

    this.auditContext.record({
      action: action === 'APPROVE' ? 'approval.approved' : 'approval.rejected',
      entityType: 'approval_request',
      entityId: id,
      orgId: ctx.orgId,
      actorUserId: principal.userId,
      before: { status: request.status, currentStep: request.currentStep },
      after: {
        status: updated.status,
        currentStep: updated.currentStep,
        reason,
        // REQ-I-04: the trail names both identities, not just the clicker.
        delegatedFromUserId: eligibility.delegatedFromUserId,
      },
    });

    return { ok: true };
  }

  /** Approvers with a live delegation to this caller today (REQ-I-04). */
  private async liveDelegatorsTo(principal: Principal): Promise<string[]> {
    const rows = await this.db
      .select({ fromUserId: approvalDelegations.fromUserId })
      .from(approvalDelegations)
      .where(
        and(
          eq(approvalDelegations.orgId, principal.orgId),
          eq(approvalDelegations.toUserId, principal.userId),
          isNull(approvalDelegations.deletedAt),
          delegationLiveOn(this.orgTodaySql(principal.orgId)),
        ),
      );
    return rows.map((row) => row.fromUserId);
  }

  private orgTodaySql(orgId: string): SQL {
    return sql`(now() AT TIME ZONE (SELECT timezone FROM organizations WHERE id = ${orgId}))::date`;
  }

  private async delegateOf(
    orgId: string,
    userId: string,
  ): Promise<{ canApprove: boolean } | null> {
    const rows = await this.db.execute<{ can_approve: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
          FROM user_roles ur
          JOIN role_permissions rp ON rp.role_id = ur.role_id
          JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = u.id
           AND p.key IN (${PERMISSIONS.LEAVE_APPROVE_TEAM}, ${PERMISSIONS.LEAVE_APPROVE_ALL})
      ) AS can_approve
      FROM ${users} u
      WHERE u.id = ${userId}
        AND u.org_id = ${orgId}
        AND u.deleted_at IS NULL
        AND u.status = 'ACTIVE'
    `);

    const row = rows.rows[0];
    return row === undefined ? null : { canApprove: row.can_approve };
  }

  /** Moves one request up a level. False when the route above it is exhausted. */
  private async escalateOne(ctx: OrgContext, id: string): Promise<boolean> {
    const requests = new ApprovalRepository(this.db, ctx);
    const steps = new ApprovalStepRepository(this.db, ctx);

    const request = await requests.findRow(id);
    if (request === null || (request.status !== 'PENDING' && request.status !== 'ESCALATED')) {
      return false;
    }

    const route = await steps.forRequest(id);
    const current = route.find((step) => step.stepNo === request.currentStep) ?? null;
    let next = route.find((step) => step.stepNo === request.currentStep + 1) ?? null;

    if (next === null) {
      // The route was written in full at raise time, so reaching here means
      // the request is at its last level. The reporting line is re-derived
      // only now, and only to find somebody above whoever has already had it.
      const target = nextEscalationTarget({
        chain: await this.routing.defaultRoute(ctx.orgId, request.requesterUserId),
        currentApproverUserId: current?.approverUserId ?? null,
        requesterUserId: request.requesterUserId,
        alreadyRoutedUserIds: route.map((step) => step.approverUserId),
      });
      if (target === null) return false;

      const created = await steps.insert({
        approvalRequestId: id,
        stepNo: request.currentStep + 1,
        approverUserId: target,
      });
      next = { id: created.id, stepNo: created.stepNo, approverUserId: target, action: null };
    }

    const now = new Date();

    if (current !== null && current.action === null) {
      // The timer took the step away from its approver, and the history should
      // say so rather than showing an unanswered step that silently moved on.
      await steps.recordAction({
        stepId: current.id,
        action: 'ESCALATE',
        actedByUserId: null,
        delegatedFromUserId: null,
        reason: `No decision within ${String(request.escalateAfterDays)} days.`,
        at: now,
      });
    }

    const updated = await requests.advance(id, request.currentStep, next.stepNo, 'ESCALATED', now);
    if (updated === null) return false;

    // Written straight to the trail: a job has no request for the audit
    // interceptor to hang an entry on, and `AuditContext.record` is a no-op
    // outside one.
    await this.audit.write({
      orgId: ctx.orgId,
      actorUserId: null,
      action: 'approval.escalated',
      entityType: 'approval_request',
      entityId: id,
      before: { currentStep: request.currentStep, status: request.status },
      after: {
        currentStep: next.stepNo,
        status: 'ESCALATED',
        approverUserId: next.approverUserId,
        afterDays: request.escalateAfterDays,
      },
    });

    return true;
  }

  private async buildDetail(ctx: OrgContext, id: string): Promise<ApprovalRequestDetail> {
    const requests = new ApprovalRepository(this.db, ctx);
    const steps = new ApprovalStepRepository(this.db, ctx);

    const [summary, row, history] = await Promise.all([
      requests.summary(id),
      requests.findRow(id),
      steps.history(id),
    ]);

    if (summary === null || row === null) throw AppError.notFound('Approval request', id);

    const open = row.status === 'PENDING' || row.status === 'ESCALATED';
    const currentStep = history.find((step) => step.stepNo === row.currentStep) ?? null;

    return {
      ...summary,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      awaiting: open ? (currentStep?.approver ?? null) : null,
      escalatedAt: row.escalatedAt?.toISOString() ?? null,
      currentStepStartedAt: row.currentStepStartedAt.toISOString(),
      escalateAfterDays: row.escalateAfterDays,
      steps: history,
    };
  }

  private toError(refusal: DecisionRefusal): AppError {
    const code =
      refusal.code === 'APPROVER_IS_REQUESTER'
        ? ERROR_CODES.APPROVER_IS_REQUESTER
        : refusal.code === 'APPROVAL_ALREADY_ACTIONED'
          ? ERROR_CODES.APPROVAL_ALREADY_ACTIONED
          : ERROR_CODES.FORBIDDEN;
    return new AppError(code, refusal.message);
  }
}
