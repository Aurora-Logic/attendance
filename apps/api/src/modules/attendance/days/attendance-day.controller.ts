import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  type AttendanceDayDetail,
  type AttendanceDaySummary,
  type Paginated,
} from '@vyuha/shared';
import { z } from 'zod';

import { AppError } from '../../../platform/common/errors.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { AttendanceDayQueryDto } from '../punch/punch.dto.js';
import { AttendanceDayService } from './attendance-day.service.js';

/**
 * `/api/v1/attendance/days` (technical design §6). REQ-E-01 … REQ-E-05.
 *
 * Read only. The override (REQ-E-08) and the period lock (REQ-E-09) that §6
 * also lists under this resource are separate slices with separate
 * permissions, and adding a write here without them would be the wrong half.
 *
 * The three view keys are named together because they are one family: the
 * guard's job is to keep out an account holding none of them, and
 * `ScopeService` decides how much of the muster the holder actually sees.
 */
const ATTENDANCE_VIEW_KEYS = [
  PERMISSIONS.ATTENDANCE_VIEW_SELF,
  PERMISSIONS.ATTENDANCE_VIEW_TEAM,
  PERMISSIONS.ATTENDANCE_VIEW_ALL,
] as const;

/** NFR-05: a calendar date, not an instant, and calendar-checked. */
const dateParamSchema = z.iso.date();

function requireDate(raw: string): string {
  const parsed = dateParamSchema.safeParse(raw);
  if (!parsed.success) {
    // Parsed here rather than left to Postgres: an unparseable date literal
    // surfaces as a 500 from inside the driver, which reads as a server fault
    // for what is a malformed request.
    throw AppError.validation('That date is not a valid YYYY-MM-DD calendar date.', {
      fields: [{ path: 'date', message: 'must be YYYY-MM-DD', value: raw }],
    });
  }
  return parsed.data;
}

@Controller('attendance/days')
export class AttendanceDayController {
  constructor(private readonly days: AttendanceDayService) {}

  @Get()
  @RequirePermission(...ATTENDANCE_VIEW_KEYS)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: AttendanceDayQueryDto,
  ): Promise<Paginated<AttendanceDaySummary>> {
    return this.days.list(principal, query);
  }

  @Get(':employeeId/:date')
  @RequirePermission(...ATTENDANCE_VIEW_KEYS)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('date') date: string,
  ): Promise<AttendanceDayDetail> {
    return this.days.findDay(principal, employeeId, requireDate(date));
  }
}
