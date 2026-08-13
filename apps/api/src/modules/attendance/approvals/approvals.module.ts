import { Module } from '@nestjs/common';

import { ApprovalRoutingService } from './approval-routing.service.js';
import { ApprovalController } from './approval.controller.js';
import { ApprovalService } from './approval.service.js';
import { EscalateStaleApprovalsHandler } from './escalate-stale-approvals.handler.js';

/**
 * The generic approval framework (REQ-I-01 to REQ-I-05).
 *
 * A sub-module of the attendance module rather than a sibling of it, because
 * technical design 3 keeps every attendance concern behind one boundary. It is
 * its own file so that one slice can be built without touching the file every
 * other slice also needs.
 *
 * `ApprovalService` is exported because it is the seam every approvable slice
 * attaches to (REQ-I-01: "do not build four separate ones"). A sibling module
 * inside `modules/attendance/` imports this module and calls `raise`; it never
 * writes `approval_requests` itself.
 *
 * The escalation handler is provided here and imported by nothing. It puts
 * itself into the global `JobRegistry` during `onModuleInit`, which is what
 * keeps `JobsModule` from having to import a module that also enqueues.
 */
@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService, ApprovalRoutingService, EscalateStaleApprovalsHandler],
  exports: [ApprovalService],
})
export class ApprovalModule {}
