import {
  Body,
  Controller,
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
  type Paginated,
  type RosterAssignment,
  type RosterBulkPreview,
  type ShiftSummary,
  type WeeklyOffPatternSummary,
} from '@vyuha/shared';

import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { RosterService } from './roster.service.js';
import { ShiftService } from './shift.service.js';
import { WeeklyOffPatternService } from './weekly-off-pattern.service.js';
import {
  BulkRosterAssignmentDto,
  CreateRosterAssignmentDto,
  CreateShiftDto,
  CreateWeeklyOffPatternDto,
  RosterListQueryDto,
  ShiftListQueryDto,
  UpdateRosterAssignmentDto,
  UpdateShiftDto,
  UpdateWeeklyOffPatternDto,
  WeeklyOffPatternListQueryDto,
} from './shifts.dto.js';

/**
 * `GET/POST/PATCH /shifts | /weekly-off-patterns | /rosters` plus
 * `POST /rosters/bulk`, exactly as technical design section 6 lists them.
 *
 * PRD section 2.1 names `shift.manage` for this area and nothing else, so
 * writes take that key. Reads take `employee.view`: every one of these lists
 * is a filter or a column on a screen an Operations user already has, and
 * `shift.manage` alone -- a role somebody could build, since roles are
 * user-defined (REQ-B-07) -- would be a role that can create a shift and not
 * see the list it was added to. That is a wart worth recording rather than
 * widening the read key past what was asked for.
 *
 * Three controllers rather than one, because Nest derives the audit
 * interceptor's route name from the controller path: a single controller
 * mounted at `/` would record every roster change under an entity type of
 * `unknown`.
 */

@Controller('shifts')
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Get()
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ShiftListQueryDto,
  ): Promise<Paginated<ShiftSummary>> {
    return this.shifts.list(principal, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShiftSummary> {
    return this.shifts.findOne(principal, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateShiftDto,
  ): Promise<ShiftSummary> {
    return this.shifts.create(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateShiftDto,
  ): Promise<ShiftSummary> {
    return this.shifts.update(principal, id, body);
  }
}

@Controller('weekly-off-patterns')
export class WeeklyOffPatternController {
  constructor(private readonly patterns: WeeklyOffPatternService) {}

  @Get()
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: WeeklyOffPatternListQueryDto,
  ): Promise<Paginated<WeeklyOffPatternSummary>> {
    return this.patterns.list(principal, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WeeklyOffPatternSummary> {
    return this.patterns.findOne(principal, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateWeeklyOffPatternDto,
  ): Promise<WeeklyOffPatternSummary> {
    return this.patterns.create(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWeeklyOffPatternDto,
  ): Promise<WeeklyOffPatternSummary> {
    return this.patterns.update(principal, id, body);
  }
}

@Controller('rosters')
export class RosterController {
  constructor(private readonly rosters: RosterService) {}

  @Get()
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: RosterListQueryDto,
  ): Promise<Paginated<RosterAssignment>> {
    return this.rosters.list(principal, query);
  }

  /**
   * Declared before `:id` on purpose. Nest matches in declaration order, and
   * `GET /rosters/bulk` would otherwise reach `findOne` and be rejected by
   * `ParseUUIDPipe` -- a 400 that reads as a client mistake for a route that
   * exists.
   */
  @Post('bulk')
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  @HttpCode(HttpStatus.OK)
  bulk(
    @CurrentUser() principal: Principal,
    @Body() body: BulkRosterAssignmentDto,
  ): Promise<RosterBulkPreview> {
    // 200 rather than 201 for both halves. The preview creates nothing, and a
    // status that depended on the request body would make the client's
    // handling of it a special case.
    return this.rosters.bulkAssign(principal, body);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.EMPLOYEE_VIEW)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RosterAssignment> {
    return this.rosters.findOne(principal, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateRosterAssignmentDto,
  ): Promise<RosterAssignment> {
    return this.rosters.create(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRosterAssignmentDto,
  ): Promise<RosterAssignment> {
    return this.rosters.update(principal, id, body);
  }
}
