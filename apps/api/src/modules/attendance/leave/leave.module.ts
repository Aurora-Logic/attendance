import { Module } from '@nestjs/common';

import { ApprovalModule } from '../../../platform/approvals/approvals.module.js';
import { DayEngineService } from '../day-engine/day-engine.service.js';
import { LeaveApprovalHandler } from './leave-approval.handler.js';
import {
  AccrueLeaveHandler,
  CarryForwardLeaveHandler,
  ExpireCompOffHandler,
} from './leave-jobs.handler.js';
import { LeaveController, LeaveTypeController } from './leave.controller.js';
import { LeaveService } from './leave.service.js';

/**
 * Leave types, balances, the ledger and applications (REQ-G-01 to REQ-G-12).
 *
 * A sub-module of the attendance module rather than a sibling of it, because
 * technical design 3 keeps every attendance concern behind one boundary. It is
 * its own file so that one slice can be built without touching the file every
 * other slice also needs.
 *
 * `ApprovalModule` is the one import. `DbModule`, `AuditModule`, `RbacModule`,
 * `JobsModule` and `NotificationsModule` are all `@Global()`, and the three job
 * handlers register themselves with `JobRegistry` on init rather than being
 * imported by `JobsModule` -- which is what keeps the dependency arrow pointing
 * one way (see `job-handler.ts`).
 *
 * The approvals arrow points the same way and must keep doing so: leave
 * imports the framework to raise a request (REQ-I-01) and to decide one, and
 * the framework reaches back only through `ApprovalSubjectRegistry`, which
 * `LeaveApprovalHandler` puts itself into on init. `ApprovalModule` importing
 * this module would close a cycle and put the generic framework's compilation
 * behind one of the five slices it serves.
 *
 * `LeaveService` is exported because the handlers in this module need it and
 * the reports slice will: a negative-balance report (REQ-G-08) and a lapsed
 * comp-off report (REQ-G-11) both read leave, and neither should reach past
 * the service into the repository to do it.
 *
 * `DayEngineService` is listed as a provider rather than imported, for the
 * reason `HolidayModule` gives: `AttendanceModule` imports this module and
 * exports the engine, so importing it back would close a cycle. Providing it
 * here gives this module's injector its own instance, which costs nothing --
 * the service holds no state. The approve/cancel recompute (launch plan WS-B)
 * is the only reason it is needed at all.
 */
@Module({
  imports: [ApprovalModule],
  controllers: [LeaveTypeController, LeaveController],
  providers: [
    LeaveService,
    DayEngineService,
    LeaveApprovalHandler,
    AccrueLeaveHandler,
    CarryForwardLeaveHandler,
    ExpireCompOffHandler,
  ],
  exports: [LeaveService],
})
export class LeaveModule {}
