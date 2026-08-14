import { Injectable, type OnModuleInit } from '@nestjs/common';

import type { Database } from '../../../platform/db/db.provider.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import {
  ApprovalSubjectRegistry,
  type ApprovalSubjectDecision,
  type ApprovalSubjectHandler,
  type ApprovalSubjectSettlement,
} from '../approvals/approval-subject.registry.js';
import { LEAVE_REQUEST_SUBJECT_TYPE, LeaveService } from './leave.service.js';

/**
 * What the approval framework calls when a leave request is decided
 * (REQ-I-01, REQ-G-09).
 *
 * Registered the way the job handlers are -- it puts itself into the registry
 * during `onModuleInit`, and `ApprovalModule` never imports this file. That
 * indirection is the point rather than a detail: leave already imports the
 * framework, so a framework that imported leave back would close a cycle, and
 * the usual fix for one (`forwardRef`) hides it rather than removing it. Here
 * the arrow only ever points at `ApprovalModule`.
 *
 * Deliberately thin. Everything a decision *means* is `LeaveService`'s, which
 * is where the ledger and the balance already live; splitting that across two
 * files would give the AVAILED row two possible authors, and the whole reason
 * this join was written by hand is that a wrong row in an append-only ledger
 * cannot be taken back.
 */
@Injectable()
export class LeaveApprovalHandler implements ApprovalSubjectHandler, OnModuleInit {
  readonly subjectType = LEAVE_REQUEST_SUBJECT_TYPE;

  constructor(
    private readonly leave: LeaveService,
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
    return this.leave.applyApprovalDecision(ctx, decision, tx);
  }
}
