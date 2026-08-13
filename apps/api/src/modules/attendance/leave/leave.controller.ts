import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  type CompOffCredit,
  type LeaveBalance,
  type LeaveCalendar,
  type LeaveLedgerEntry,
  type LeavePreview,
  type LeaveRequest,
  type LeaveRequestDetail,
  type LeaveTypePolicy,
  type Paginated,
} from '@vyuha/shared';

import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import {
  CompOffGrantDto,
  CompOffQueryDto,
  LeaveAdjustmentDto,
  LeaveApplicationDto,
  LeaveBalanceQueryDto,
  LeaveCalendarQueryDto,
  LeaveCancellationDto,
  LeaveDecisionDto,
  LeaveLedgerQueryDto,
  LeavePreviewQueryDto,
  LeaveRejectionDto,
  LeaveRequestQueryDto,
  LeaveTypeInputDto,
  LeaveTypePatchDto,
  LeaveTypeQueryDto,
} from './leave.dto.js';
import { LeaveService } from './leave.service.js';

/**
 * `/api/v1/leave` (technical design §6). REQ-G-01 … REQ-G-12.
 *
 * Controllers validate and delegate; every decision below the decorator is the
 * service's. What lives here is the permission on each route, and it is worth
 * reading as a table:
 *
 *   reading anybody's leave      -- the three-key family, narrowed by scope
 *   applying                     -- `leave.apply.self`
 *   deciding                     -- `leave.approve.team` or `.all`
 *   leave types, balance edits   -- `leave.policy.manage`
 *
 * `RequirePermission` only keeps out an account holding none of the listed
 * keys; `ScopeService` decides how much of the data the holder actually sees,
 * and `LeaveService` re-checks the narrower rules a guard cannot express --
 * that an approver is not deciding their own request (REQ-I-05), and that
 * applying for somebody else needs the org-wide key.
 */
const LEAVE_VIEW_KEYS = [
  PERMISSIONS.LEAVE_APPLY_SELF,
  PERMISSIONS.LEAVE_APPROVE_TEAM,
  PERMISSIONS.LEAVE_APPROVE_ALL,
] as const;

const LEAVE_DECIDE_KEYS = [
  PERMISSIONS.LEAVE_APPROVE_TEAM,
  PERMISSIONS.LEAVE_APPROVE_ALL,
] as const;

@Controller('leave/types')
export class LeaveTypeController {
  constructor(private readonly leave: LeaveService) {}

  /**
   * Readable by anyone who can apply: the application form cannot render its
   * type picker, its notice-period hint or its half-day control without the
   * policy behind them.
   */
  @Get()
  @RequirePermission(...LEAVE_VIEW_KEYS)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: LeaveTypeQueryDto,
  ): Promise<Paginated<LeaveTypePolicy>> {
    return this.leave.listTypes(principal, query);
  }

  @Get(':id')
  @RequirePermission(...LEAVE_VIEW_KEYS)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeaveTypePolicy> {
    return this.leave.findType(principal, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.LEAVE_POLICY_MANAGE)
  create(
    @CurrentUser() principal: Principal,
    @Body() body: LeaveTypeInputDto,
  ): Promise<LeaveTypePolicy> {
    return this.leave.createType(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.LEAVE_POLICY_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LeaveTypePatchDto,
  ): Promise<LeaveTypePolicy> {
    return this.leave.updateType(principal, id, body);
  }
}

@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  // -------------------------------------------------------------- balances

  @Get('balances')
  @RequirePermission(...LEAVE_VIEW_KEYS)
  balances(
    @CurrentUser() principal: Principal,
    @Query() query: LeaveBalanceQueryDto,
  ): Promise<Paginated<LeaveBalance>> {
    return this.leave.listBalances(principal, query);
  }

  /** REQ-G-03: the movements behind a balance, so a disagreement is findable. */
  @Get('ledger')
  @RequirePermission(...LEAVE_VIEW_KEYS)
  ledger(
    @CurrentUser() principal: Principal,
    @Query() query: LeaveLedgerQueryDto,
  ): Promise<Paginated<LeaveLedgerEntry>> {
    return this.leave.listLedger(principal, query);
  }

  /**
   * REQ-G-03's `adjusted` bucket. `leave.policy.manage` rather than an
   * approver key: an adjustment writes days into a balance with no request
   * behind it, which is a policy act and not an approval.
   */
  @Post('balances/adjust')
  @RequirePermission(PERMISSIONS.LEAVE_POLICY_MANAGE)
  adjust(
    @CurrentUser() principal: Principal,
    @Body() body: LeaveAdjustmentDto,
  ): Promise<LeaveBalance> {
    return this.leave.adjustBalance(principal, body);
  }

  // --------------------------------------------------------- applications

  /**
   * REQ-G-06's live preview. A GET, so a retry cannot be mistaken for a
   * submission and the form can call it on every date change without an
   * idempotency key.
   */
  @Get('preview')
  @RequirePermission(...LEAVE_VIEW_KEYS)
  preview(
    @CurrentUser() principal: Principal,
    @Query() query: LeavePreviewQueryDto,
  ): Promise<LeavePreview> {
    return this.leave.preview(principal, query);
  }

  @Get('requests')
  @RequirePermission(...LEAVE_VIEW_KEYS)
  listRequests(
    @CurrentUser() principal: Principal,
    @Query() query: LeaveRequestQueryDto,
  ): Promise<Paginated<LeaveRequest>> {
    return this.leave.listRequests(principal, query);
  }

  @Post('requests')
  @RequirePermission(PERMISSIONS.LEAVE_APPLY_SELF)
  apply(
    @CurrentUser() principal: Principal,
    @Body() body: LeaveApplicationDto,
  ): Promise<LeaveRequestDetail> {
    return this.leave.apply(principal, body);
  }

  @Get('requests/:id')
  @RequirePermission(...LEAVE_VIEW_KEYS)
  findRequest(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeaveRequestDetail> {
    return this.leave.getRequest(principal, id);
  }

  @Post('requests/:id/approve')
  @RequirePermission(...LEAVE_DECIDE_KEYS)
  approve(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LeaveDecisionDto,
  ): Promise<LeaveRequestDetail> {
    return this.leave.approve(principal, id, body.reason);
  }

  /** REQ-F-05: the reason is mandatory, and the employee is told it. */
  @Post('requests/:id/reject')
  @RequirePermission(...LEAVE_DECIDE_KEYS)
  reject(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LeaveRejectionDto,
  ): Promise<LeaveRequestDetail> {
    return this.leave.reject(principal, id, body.reason);
  }

  /**
   * REQ-G-10. The self-service key is enough to reach this route because an
   * employee may cancel their own leave before it starts; the service refuses
   * the cases that need an approver, which a route-level key cannot express.
   */
  @Post('requests/:id/cancel')
  @RequirePermission(...LEAVE_VIEW_KEYS)
  cancel(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LeaveCancellationDto,
  ): Promise<LeaveRequestDetail> {
    return this.leave.cancel(principal, id, body.reason);
  }

  // -------------------------------------------------------------- comp-off

  @Get('comp-off')
  @RequirePermission(...LEAVE_VIEW_KEYS)
  listCompOff(
    @CurrentUser() principal: Principal,
    @Query() query: CompOffQueryDto,
  ): Promise<Paginated<CompOffCredit>> {
    return this.leave.listCompOff(principal, query);
  }

  /** REQ-G-11: "HR or an approver grants comp-off credits". */
  @Post('comp-off')
  @RequirePermission(...LEAVE_DECIDE_KEYS)
  grantCompOff(
    @CurrentUser() principal: Principal,
    @Body() body: CompOffGrantDto,
  ): Promise<CompOffCredit> {
    return this.leave.grantCompOff(principal, body);
  }

  // -------------------------------------------------------------- calendar

  /** REQ-G-12: who is away, and where a department is thin. */
  @Get('calendar')
  @RequirePermission(...LEAVE_VIEW_KEYS)
  calendar(
    @CurrentUser() principal: Principal,
    @Query() query: LeaveCalendarQueryDto,
  ): Promise<LeaveCalendar> {
    return this.leave.calendar(principal, query);
  }
}
