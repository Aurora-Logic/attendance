import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@vyuha/shared';

import type { Database } from '../../../platform/db/db.provider.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import {
  ApprovalSubjectRegistry,
  type ApprovalSubjectDecision,
  type ApprovalSubjectHandler,
  type ApprovalSubjectSettlement,
} from '../approvals/approval-subject.registry.js';
import {
  ON_DUTY_SUBJECT_TYPE,
  REGULARIZATION_SUBJECT_TYPE,
  RegularizationService,
} from './regularization.service.js';

/**
 * What the approval framework calls when a correction or an on-duty request is
 * decided (REQ-I-01, REQ-F-03, REQ-F-04, REQ-G-09).
 *
 * Registered the way the job handlers are -- each puts itself into the registry
 * during `onModuleInit`, and `ApprovalModule` never imports this file. That
 * indirection is the point rather than a detail: this slice already imports the
 * framework, so a framework that imported it back would close a cycle, and the
 * usual fix for one (`forwardRef`) hides it rather than removing it. Here the
 * arrow only ever points at `ApprovalModule`.
 *
 * Two classes rather than one with a branch on subject type. A registry entry
 * is a subject type and its handler; a single object claiming two types would
 * have to be registered twice under a `subjectType` that can only hold one
 * value, and the branch inside it would be the framework's `switch` moved one
 * file to the left.
 *
 * Both are deliberately thin. Everything a decision *means* is
 * `RegularizationService`'s, which is where the adjustment row and the day
 * recompute already live.
 */

/**
 * PRD §2.1's correction key, and nothing else.
 *
 * Not `leave.approve.*`: those two keys approve leave. Before the framework
 * asked the handler which key applies, routing a correction into the shared
 * inbox would have made a leave approver an approver of corrections and left
 * `regularization.approve` deciding nothing -- a silent trade in both
 * directions. See `ApprovalSubjectHandler.actPermissions`.
 */
const REGULARIZATION_ACT_PERMISSIONS = [PERMISSIONS.REGULARIZATION_APPROVE] as const;

/**
 * REQ-G-09 escalates an untouched request up the reporting line and, at the
 * top, to the org-wide approvers -- who are resolved by `leave.approve.all`
 * because that is the only organisation-wide approval key PRD §2.1 defines.
 * Without this an escalated correction would land on somebody the route never
 * named and who therefore could not answer it.
 *
 * It widens nothing on its own: `actPermissions` is checked first, so a holder
 * of `leave.approve.all` who does not also hold `regularization.approve` still
 * cannot decide a correction.
 */
const REGULARIZATION_OVERRIDE_PERMISSIONS = [PERMISSIONS.LEAVE_APPROVE_ALL] as const;

@Injectable()
export class RegularizationApprovalHandler implements ApprovalSubjectHandler, OnModuleInit {
  readonly subjectType = REGULARIZATION_SUBJECT_TYPE;
  readonly actPermissions = REGULARIZATION_ACT_PERMISSIONS;
  readonly overridePermissions = REGULARIZATION_OVERRIDE_PERMISSIONS;

  constructor(
    private readonly regularization: RegularizationService,
    private readonly registry: ApprovalSubjectRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  applyDecision(
    ctx: OrgContext,
    decision: ApprovalSubjectDecision,
    tx: Database,
  ): Promise<ApprovalSubjectSettlement | null> {
    return this.regularization.applyApprovalDecision(ctx, decision, tx);
  }
}

@Injectable()
export class OnDutyApprovalHandler implements ApprovalSubjectHandler, OnModuleInit {
  readonly subjectType = ON_DUTY_SUBJECT_TYPE;
  /** The same key. REQ-F-04 is raised and decided by the same people. */
  readonly actPermissions = REGULARIZATION_ACT_PERMISSIONS;
  readonly overridePermissions = REGULARIZATION_OVERRIDE_PERMISSIONS;

  constructor(
    private readonly regularization: RegularizationService,
    private readonly registry: ApprovalSubjectRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  applyDecision(
    ctx: OrgContext,
    decision: ApprovalSubjectDecision,
    tx: Database,
  ): Promise<ApprovalSubjectSettlement | null> {
    return this.regularization.applyOnDutyDecision(ctx, decision, tx);
  }
}
