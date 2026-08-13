import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  PERMISSIONS,
  type HolidayCalendarRecord,
  type HolidayImportReport,
  type HolidayRecord,
  type Paginated,
  type RestrictedHolidayPool,
  type RestrictedHolidayResult,
} from '@vyuha/shared';

import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import {
  CreateHolidayCalendarDto,
  CreateHolidayDto,
  ElectRestrictedHolidayDto,
  HolidayCalendarListQueryDto,
  HolidayImportDto,
  RestrictedHolidayQueryDto,
  UpdateHolidayCalendarDto,
  UpdateHolidayDto,
  WithdrawRestrictedHolidayQueryDto,
} from './holiday.dto.js';
import { HolidayService } from './holiday.service.js';

/**
 * REQ-H-01, H-02 and H-04 at `/api/v1/holiday-calendars` and `/api/v1/holidays`
 * (technical design §6: plural nouns, resource-oriented).
 *
 * CLAUDE.md §6: "Controllers validate and delegate." Validation is the DTO on
 * each parameter; everything else is one call into `HolidayService`.
 *
 * Reads are `employee.view` and writes are `holiday.manage`, the key PRD §2.1
 * names for this area. The split is deliberate: the leave form reads holidays
 * to skip them (REQ-G-07) and the muster reads them to explain a HOLIDAY row,
 * so anyone who can see people can see the calendar, while only HR and Admin
 * can move a date.
 *
 * There is no DELETE for a calendar. Nothing in §6 lists one, REQ-M-04 forbids
 * a hard delete, and a calendar with employees pointed at it cannot be
 * withdrawn without deciding what happens to their days -- which is a question,
 * not a route.
 */
@Controller('holiday-calendars')
export class HolidayCalendarController {
  constructor(private readonly holidays: HolidayService) {}

  @Get()
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: HolidayCalendarListQueryDto,
  ): Promise<Paginated<HolidayCalendarRecord>> {
    return this.holidays.listCalendars(principal, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.HOLIDAY_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateHolidayCalendarDto,
  ): Promise<HolidayCalendarRecord> {
    return this.holidays.createCalendar(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.HOLIDAY_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateHolidayCalendarDto,
  ): Promise<HolidayCalendarRecord> {
    return this.holidays.updateCalendar(principal, id, body);
  }

  @Post(':id/holidays')
  @RequirePermission(PERMISSIONS.HOLIDAY_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  addHoliday(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateHolidayDto,
  ): Promise<HolidayRecord> {
    return this.holidays.addHoliday(principal, id, body);
  }

  /**
   * REQ-H-04, split the way technical design §6 splits the employee import:
   * `/validate` says what the sheet would do and writes nothing, `/commit`
   * does it. Both run the same planner, so the preview is the plan.
   *
   * 200 rather than 201 on validate: nothing was created, and a 201 would be a
   * lie a client could reasonably act on.
   */
  @Post(':id/holidays/import/validate')
  @RequirePermission(PERMISSIONS.HOLIDAY_MANAGE)
  @HttpCode(HttpStatus.OK)
  validateImport(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HolidayImportDto,
  ): Promise<HolidayImportReport> {
    return this.holidays.validateImport(principal, id, body);
  }

  @Post(':id/holidays/import/commit')
  @RequirePermission(PERMISSIONS.HOLIDAY_MANAGE)
  @HttpCode(HttpStatus.OK)
  commitImport(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HolidayImportDto,
  ): Promise<HolidayImportReport> {
    return this.holidays.commitImport(principal, id, body);
  }
}

/**
 * A holiday is edited by its own id rather than through its calendar: the row
 * already knows which calendar it belongs to, and a nested path would invite a
 * caller to name a different one and expect it to move.
 */
@Controller('holidays')
export class HolidayController {
  constructor(private readonly holidays: HolidayService) {}

  @Patch(':id')
  @RequirePermission(PERMISSIONS.HOLIDAY_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateHolidayDto,
  ): Promise<HolidayRecord> {
    return this.holidays.updateHoliday(principal, id, body);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.HOLIDAY_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.holidays.removeHoliday(principal, id);
  }
}

/**
 * REQ-H-03, where the employee is the actor.
 *
 * The policy is two keys wide on purpose. "Employee chooses up to N per year"
 * means a plain Employee -- who holds none of `employee.view`,
 * `holiday.manage` or anything else in PRD §2.1's management column -- must be
 * able to elect their own. `attendance.view.self` is the key every employee has
 * that means "your own attendance record", and an elected restricted holiday is
 * exactly that. The guard's job here is only to keep out someone with neither
 * key; `HolidayService.resolveEmployee` decides whose record is in reach, and
 * naming somebody else needs `holiday.manage`.
 */
@Controller('restricted-holidays')
export class RestrictedHolidayController {
  constructor(private readonly holidays: HolidayService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ATTENDANCE_VIEW_SELF, PERMISSIONS.HOLIDAY_MANAGE)
  pool(
    @CurrentUser() principal: Principal,
    @Query() query: RestrictedHolidayQueryDto,
  ): Promise<RestrictedHolidayPool> {
    return this.holidays.restrictedPool(principal, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ATTENDANCE_VIEW_SELF, PERMISSIONS.HOLIDAY_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  elect(
    @CurrentUser() principal: Principal,
    @Body() body: ElectRestrictedHolidayDto,
  ): Promise<RestrictedHolidayResult> {
    return this.holidays.elect(principal, body);
  }

  @Delete(':holidayId')
  @RequirePermission(PERMISSIONS.ATTENDANCE_VIEW_SELF, PERMISSIONS.HOLIDAY_MANAGE)
  withdraw(
    @CurrentUser() principal: Principal,
    @Param('holidayId', ParseUUIDPipe) holidayId: string,
    @Query() query: WithdrawRestrictedHolidayQueryDto,
  ): Promise<RestrictedHolidayResult> {
    return this.holidays.withdraw(principal, holidayId, query.employeeId);
  }
}
