import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  type ApprovalDelegation,
  type ApprovalRequestDetail,
  type ApprovalRequestSummary,
  type BulkApprovalResult,
  type Paginated,
} from '@vyuha/shared';

import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import {
  ApprovalInboxQueryDto,
  ApproveRequestDto,
  BulkApprovalDecisionDto,
  CreateDelegationDto,
  RejectRequestDto,
} from './approval.dto.js';
import { APPROVAL_ACT_KEYS, ApprovalService } from './approval.service.js';

/**
 * `/api/v1/approvals` (technical design §6). REQ-I-01 … REQ-I-05.
 *
 * Controllers validate and delegate. Every rule these routes enforce -- who
 * may act, whether a request is still open, where an approval routes next --
 * is in `ApprovalService` and `approval-policy.ts`, because a rule written in
 * a controller is a rule the bulk endpoint next to it does not get.
 *
 * The read keys are the whole family, deliberately. The guard's job is to keep
 * out an account holding none of them; `ScopeService` and the view decide how
 * much of the inbox the holder actually sees -- including a plain employee,
 * who sees the requests they raised and nothing else.
 */
const APPROVAL_READ_KEYS = [
  PERMISSIONS.LEAVE_APPROVE_TEAM,
  PERMISSIONS.LEAVE_APPROVE_ALL,
  PERMISSIONS.LEAVE_APPLY_SELF,
  PERMISSIONS.REGULARIZATION_RAISE,
] as const;

@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get()
  @RequirePermission(...APPROVAL_READ_KEYS)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: ApprovalInboxQueryDto,
  ): Promise<Paginated<ApprovalRequestSummary>> {
    return this.approvals.list(principal, query);
  }

  /**
   * Declared before `:id`. Express matches in registration order, so the
   * literal segment has to be registered first or `ParseUUIDPipe` answers 400
   * for the word "delegations" -- a routing bug that reads as a validation
   * failure and sends the reader looking at the wrong end of the request.
   */
  @Get('delegations')
  @RequirePermission(...APPROVAL_ACT_KEYS)
  listDelegations(@CurrentUser() principal: Principal): Promise<ApprovalDelegation[]> {
    return this.approvals.listDelegations(principal);
  }

  /** REQ-I-04. An approver delegates their own decisions, never anyone else's. */
  @Post('delegations')
  @RequirePermission(...APPROVAL_ACT_KEYS)
  createDelegation(
    @CurrentUser() principal: Principal,
    @Body() body: CreateDelegationDto,
  ): Promise<ApprovalDelegation> {
    return this.approvals.createDelegation(principal, body);
  }

  @Delete('delegations/:id')
  @RequirePermission(...APPROVAL_ACT_KEYS)
  revokeDelegation(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApprovalDelegation> {
    return this.approvals.revokeDelegation(principal, id);
  }

  /** REQ-I-03 bulk, before `:id` for the same registration-order reason. */
  @Post('bulk')
  @RequirePermission(...APPROVAL_ACT_KEYS)
  bulk(
    @CurrentUser() principal: Principal,
    @Body() body: BulkApprovalDecisionDto,
  ): Promise<BulkApprovalResult> {
    return this.approvals.bulkDecide(principal, body);
  }

  /** REQ-I-02: the request with its full history of actions and reasons. */
  @Get(':id')
  @RequirePermission(...APPROVAL_READ_KEYS)
  detail(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApprovalRequestDetail> {
    return this.approvals.detail(principal, id);
  }

  @Post(':id/approve')
  @RequirePermission(...APPROVAL_ACT_KEYS)
  approve(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApproveRequestDto,
  ): Promise<ApprovalRequestDetail> {
    return this.approvals.decide(principal, id, 'APPROVE', body.reason ?? null);
  }

  /** REQ-F-05: the reason is required by the schema, not by a check in here. */
  @Post(':id/reject')
  @RequirePermission(...APPROVAL_ACT_KEYS)
  reject(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectRequestDto,
  ): Promise<ApprovalRequestDetail> {
    return this.approvals.decide(principal, id, 'REJECT', body.reason);
  }
}
