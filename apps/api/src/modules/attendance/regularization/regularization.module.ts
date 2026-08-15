import { Module } from '@nestjs/common';

import { ApprovalModule } from '../approvals/approvals.module.js';
import { DayEngineService } from '../day-engine/day-engine.service.js';
import {
  OnDutyApprovalHandler,
  RegularizationApprovalHandler,
} from './regularization-approval.handler.js';
import { OnDutyController, RegularizationController } from './regularization.controller.js';
import { RegularizationService } from './regularization.service.js';

/**
 * Regularization and on-duty (REQ-F-01 to REQ-F-05).
 *
 * A sub-module of the attendance module rather than a sibling, because
 * technical design §3 keeps every attendance concern behind one boundary. It
 * is its own file so that one slice can be built without touching the file
 * every other slice also needs.
 *
 * `ApprovalModule` is the one import. `DbModule`, `AuditModule`, `RbacModule`
 * and `NotificationsModule` are all `@Global()`.
 *
 * The approvals arrow points one way and must keep doing so: this slice imports
 * the framework to raise a request (REQ-I-01) and to decide one, and the
 * framework reaches back only through `ApprovalSubjectRegistry`, which the two
 * handlers put themselves into on init. `ApprovalModule` importing this module
 * would close a cycle and put the generic framework's compilation behind one of
 * the five slices it serves.
 *
 * `DayEngineService` is listed as a provider rather than imported, for the
 * reason `LeaveModule` and `HolidayModule` both give: `AttendanceModule`
 * imports this module and exports the engine, so importing it back would close
 * a cycle. Providing it here gives this module's injector its own instance,
 * which costs nothing -- the service holds no state. REQ-F-03's recompute is
 * the only reason it is needed at all.
 */
@Module({
  imports: [ApprovalModule],
  controllers: [RegularizationController, OnDutyController],
  providers: [
    RegularizationService,
    DayEngineService,
    RegularizationApprovalHandler,
    OnDutyApprovalHandler,
  ],
  exports: [RegularizationService],
})
export class RegularizationModule {}
