import { Module } from '@nestjs/common';

import { DayEngineService } from '../day-engine/day-engine.service.js';
import {
  HolidayCalendarController,
  HolidayController,
  RestrictedHolidayController,
} from './holiday.controller.js';
import { HolidayService } from './holiday.service.js';

/**
 * Holiday calendars and restricted holidays (REQ-H-01 to REQ-H-04).
 *
 * A sub-module of the attendance module rather than a sibling of it, because
 * technical design 3 keeps every attendance concern behind one boundary. It is
 * its own file so that one slice can be built without touching the file every
 * other slice also needs.
 *
 * `DayEngineService` is listed as a provider rather than imported.
 * `AttendanceModule` imports this module and exports the engine, so importing
 * it back would close a cycle that only `forwardRef` on both sides could open
 * -- and the other side is a file five slices share. Providing it here gives
 * this module's injector its own instance, which costs nothing: the service
 * holds no state, and everything it needs (`DbModule`, `AuditModule`) is
 * `@Global()`. REQ-H-04's recompute is the only reason it is needed at all.
 */
@Module({
  controllers: [HolidayCalendarController, HolidayController, RestrictedHolidayController],
  providers: [HolidayService, DayEngineService],
  exports: [HolidayService],
})
export class HolidayModule {}
