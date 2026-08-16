import { Injectable, Logger } from '@nestjs/common';
import type { PermissionKey } from '@vyuha/shared';

import type { Database } from '../db/db.provider.js';
import type { OrgContext } from '../db/scoped-repository.js';

/**
 * How a slice attaches its own records to the approval framework (REQ-I-01).
 *
 * The framework must not import leave, regularization, or anything else it
 * decides for -- those slices already import it, and an arrow that points both
 * ways is a cycle `forwardRef` would hide rather than remove. So the shape is
 * the one `JobRegistry` uses: a map from a key to a handler, each slice putting
 * itself in during `onModuleInit`, and the framework looking a handler up by
 * key when it has something to say. Nothing in `approvals/` knows what a leave
 * request is; it knows that `leave_request` has an owner.
 *
 * **A subject type with no handler cannot be raised or decided.** That is the
 * whole safety property. Without it, a slice that raises a request and forgets
 * to register would produce an inbox that says "approved" while the record it
 * was about never moved -- no error anywhere, and an append-only ledger that
 * silently disagrees with the decision. `ApprovalService` therefore asks this
 * registry at both ends: at `raise`, so a request that can never be completed
 * is never created, and at the decision, so a row raised before its handler
 * existed is refused rather than half-applied.
 */

/**
 * The statuses a handler is told about.
 *
 * `APPROVED` and `REJECTED` are terminal. `ESCALATED` is not -- REQ-G-09 moves
 * an untouched request up a level and it stays decidable -- but the subject has
 * to hear about it, because a leave request sitting at "pending" while its
 * approval says "escalated" is two records disagreeing about the same fact.
 *
 * `CANCELLED` is deliberately absent: the framework only ever cancels through
 * `cancelForSubject`, which the owning slice calls while it is cancelling the
 * subject itself. Telling it what it just told us would be a second write.
 */
export type ApprovalSubjectStatus = 'APPROVED' | 'REJECTED' | 'ESCALATED';

export interface ApprovalSubjectDecision {
  readonly approvalRequestId: string;
  /** The subject's own id -- the leave request, the regularization, and so on. */
  readonly subjectId: string;
  readonly status: ApprovalSubjectStatus;
  readonly reason: string | null;
  /** Null when the escalation job moved it; a job has no user to name. */
  readonly decidedByUserId: string | null;
  /** When the decision was recorded, so subject and approval agree to the ms. */
  readonly at: Date;
}

/**
 * Work the handler wants done once the decision has actually committed.
 *
 * Returned rather than performed, because the two halves have opposite failure
 * rules. The ledger write and the status change must roll back together with
 * the approval -- an approved request whose ledger recorded nothing is the
 * exact failure this whole design exists to prevent. Recomputing the muster and
 * sending the employee an email must not: they read the committed row, and a
 * transaction still open cannot be read by the day engine's own connection.
 */
export type ApprovalSubjectSettlement = () => Promise<void>;

export interface ApprovalSubjectHandler {
  /** `snake_case`; see `APPROVAL_SUBJECT_TYPES` in the shared contract. */
  readonly subjectType: string;

  /**
   * The permission keys that let a holder decide *this kind* of request.
   *
   * Declared by the slice rather than fixed in the framework, and that is the
   * whole reason it exists. One inbox decides several kinds of request, and
   * the keys that authorise them are not the same: leave is
   * `leave.approve.team` / `leave.approve.all`, a correction is
   * `regularization.approve`. Without this, routing a second subject type into
   * the inbox would silently make the leave keys grant it -- PRD §2.1 gives
   * `regularization.approve` its own existence precisely so that they are
   * separable -- and a manager routed a leave request because they are the
   * reporting manager, holding only `regularization.approve`, would be able to
   * approve it. The route guard on `/approvals/:id/approve` can only ask
   * whether the caller approves *something*; this is what narrows it to the
   * request in front of them.
   *
   * Checked in `ApprovalService.decideWithin` and nowhere else, so the single
   * and bulk paths cannot disagree.
   */
  readonly actPermissions: readonly PermissionKey[];

  /**
   * The keys that additionally let a holder act on a step never routed to them.
   *
   * REQ-G-09 escalates to HR, so an org-wide approver has to be able to answer
   * a step somebody else was named on. Evaluated *after* REQ-I-05's
   * self-approval refusal, never before -- see `evaluateDecision`, where the
   * order is the requirement.
   */
  readonly overridePermissions: readonly PermissionKey[];

  /**
   * Applies the decision to the subject, inside the framework's transaction.
   *
   * **The approver is not re-checked here.** The framework has already decided
   * that this actor may act on this request, at this step, under this
   * delegation (REQ-I-05 included), and a second opinion in the handler is a
   * second place the rule can be wrong. What the handler owns is what the
   * decision *means* for its own records.
   */
  applyDecision(
    ctx: OrgContext,
    decision: ApprovalSubjectDecision,
    tx: Database,
  ): Promise<ApprovalSubjectSettlement | null>;
}

@Injectable()
export class ApprovalSubjectRegistry {
  private readonly logger = new Logger(ApprovalSubjectRegistry.name);
  private readonly handlers = new Map<string, ApprovalSubjectHandler>();

  register(handler: ApprovalSubjectHandler): void {
    if (this.handlers.has(handler.subjectType)) {
      // Two handlers for one subject type means one of them silently never
      // runs, and which one would depend on module initialisation order.
      throw new Error(
        `Approval subject "${handler.subjectType}" already has a handler registered.`,
      );
    }
    this.handlers.set(handler.subjectType, handler);
    this.logger.log({ msg: `Approval subject handler registered: ${handler.subjectType}` });
  }

  get(subjectType: string): ApprovalSubjectHandler | null {
    return this.handlers.get(subjectType) ?? null;
  }

  registeredSubjectTypes(): readonly string[] {
    return [...this.handlers.keys()];
  }
}
