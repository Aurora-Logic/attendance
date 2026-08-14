import { Module } from '@nestjs/common';

import { DayEngineService } from '../day-engine/day-engine.service.js';
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
 * Nothing is imported. `DbModule`, `AuditModule`, `RbacModule` and
 * `NotificationsModule` are all `@Global()`.
 *
 * `DayEngineService` is listed as a provider rather than imported, for the
 * reason `LeaveModule` and `HolidayModule` both give: `AttendanceModule`
 * imports this module and exports the engine, so importing it back would close
 * a cycle. Providing it here gives this module's injector its own instance,
 * which costs nothing -- the service holds no state. REQ-F-03's inline
 * recompute is the only reason it is needed at all.
 */
@Module({
  controllers: [RegularizationController, OnDutyController],
  providers: [RegularizationService, DayEngineService],
  exports: [RegularizationService],
})
export class RegularizationModule {}
