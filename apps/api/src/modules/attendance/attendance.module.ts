import { Module } from '@nestjs/common';

import { ApprovalModule } from './approvals/approvals.module.js';
import { HolidayModule } from './holidays/holidays.module.js';
import { LeaveModule } from './leave/leave.module.js';
import { ReportModule } from './reports/reports.module.js';
import { ShiftModule } from './shifts/shifts.module.js';

import { DayEngineService } from './day-engine/day-engine.service.js';
import { AttendanceDayController } from './days/attendance-day.controller.js';
import { AttendanceDayService } from './days/attendance-day.service.js';
import { PunchContextController, PunchController } from './punch/punch.controller.js';
import { PunchService } from './punch/punch.service.js';

/**
 * The attendance module (technical design §3). Phase 1 puts the day engine and
 * the punch slice in it; roster, leave, holiday, regularization, approval and
 * report services join it as their slices land.
 *
 * `DbModule`, `AuditModule`, `FileModule`, `RbacModule`, `JobsModule` and
 * `NotificationsModule` are all `@Global()`, so nothing is imported here -- the
 * boundary this module has to respect is the other direction, and ESLint
 * enforces it: `modules/attendance` may reach into `platform/`, and `platform/`
 * may never reach back.
 */
@Module({
  // One import line per slice, added up front so five parallel builds
  // never contend for this file.
  imports: [ShiftModule, HolidayModule, ApprovalModule, LeaveModule, ReportModule],
  controllers: [PunchController, PunchContextController, AttendanceDayController],
  providers: [DayEngineService, PunchService, AttendanceDayService],
  exports: [DayEngineService],
})
export class AttendanceModule {}
