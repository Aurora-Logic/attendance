import { Module } from '@nestjs/common';

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
 * Nothing is imported. `DbModule`, `AuditModule`, `RbacModule`, `JobsModule`
 * and `NotificationsModule` are all `@Global()`, and the three job handlers
 * register themselves with `JobRegistry` on init rather than being imported by
 * `JobsModule` -- which is what keeps the dependency arrow pointing one way
 * (see `job-handler.ts`).
 *
 * `LeaveService` is exported because the handlers in this module need it and
 * the reports slice will: a negative-balance report (REQ-G-08) and a lapsed
 * comp-off report (REQ-G-11) both read leave, and neither should reach past
 * the service into the repository to do it.
 */
@Module({
  controllers: [LeaveTypeController, LeaveController],
  providers: [
    LeaveService,
    AccrueLeaveHandler,
    CarryForwardLeaveHandler,
    ExpireCompOffHandler,
  ],
  exports: [LeaveService],
})
export class LeaveModule {}
