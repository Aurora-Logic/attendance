import { Module } from '@nestjs/common';

import { DayEngineService } from '../day-engine/day-engine.service.js';
import { RosterService } from './roster.service.js';
import { RosterRecomputeService } from './roster-recompute.service.js';
import { ShiftService } from './shift.service.js';
import {
  RosterController,
  ShiftController,
  WeeklyOffPatternController,
} from './shifts.controller.js';
import { WeeklyOffPatternService } from './weekly-off-pattern.service.js';

/**
 * Shift masters, weekly-off patterns and rosters (REQ-C-01 to REQ-C-06).
 *
 * A sub-module of the attendance module rather than a sibling of it, because
 * technical design 3 keeps every attendance concern behind one boundary. It is
 * its own file so that one slice can be built without touching the file every
 * other slice also needs.
 *
 * `DayEngineService` is listed as a provider here rather than imported from
 * `AttendanceModule`, which exports it. `AttendanceModule` imports *this*
 * module, so reaching back for its exports would be a cycle, and `forwardRef`
 * would buy nothing: the service holds no state -- it is a factory that builds
 * a `DayEngine` bound to an organisation from the global database and audit
 * providers -- so a second instance in this injector behaves identically to
 * the one next door. Making the cycle real to avoid a stateless duplicate
 * would be the worse trade.
 */
@Module({
  controllers: [ShiftController, WeeklyOffPatternController, RosterController],
  providers: [
    ShiftService,
    WeeklyOffPatternService,
    RosterService,
    RosterRecomputeService,
    DayEngineService,
  ],
  exports: [ShiftService, RosterService],
})
export class ShiftModule {}
