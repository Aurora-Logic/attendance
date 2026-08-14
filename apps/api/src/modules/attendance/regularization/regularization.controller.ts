import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  type OnDutyRequest,
  type Paginated,
  type RegularizationPolicyView,
  type RegularizationRequest,
} from '@vyuha/shared';

import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import {
  OnDutyInputDto,
  OnDutyQueryDto,
  RegularizationDecisionDto,
  RegularizationInputDto,
  RegularizationPolicyQueryDto,
  RegularizationQueryDto,
  RegularizationRejectionDto,
} from './regularization.dto.js';
import { RegularizationService } from './regularization.service.js';

/**
 * `/api/v1/regularizations` and `/api/v1/on-duty-requests` (technical design
 * §6, which lists `POST` for both). REQ-F-01 … REQ-F-05.
 *
 * Controllers validate and delegate; every decision below the decorator is the
 * service's. The permissions read as a table:
 *
 *   reading           -- either key, narrowed to self or team by `ScopeService`
 *   raising           -- `regularization.raise`, which every Employee holds
 *   deciding          -- `regularization.approve`
 *
 * `RequirePermission` only keeps out an account holding neither key. Whose
 * requests the holder actually sees is `ScopeService`'s answer, and the two
 * rules a guard cannot express -- that an approver is not deciding their own
 * request (REQ-I-05), and that raising for somebody else needs the approver
 * key -- are re-checked in the service.
 */
const VIEW_KEYS = [PERMISSIONS.REGULARIZATION_RAISE, PERMISSIONS.REGULARIZATION_APPROVE] as const;

@Controller('regularizations')
export class RegularizationController {
  constructor(private readonly regularization: RegularizationService) {}

  /**
   * REQ-F-02's limits, so the form can bound its own calendar.
   *
   * A GET rather than numbers baked into the client: both are org settings,
   * and a form printing 7 and 3 from a constant would go on printing them
   * after an administrator moved the setting.
   */
  @Get('policy')
  @RequirePermission(...VIEW_KEYS)
  policy(
    @CurrentUser() principal: Principal,
    @Query() query: RegularizationPolicyQueryDto,
  ): Promise<RegularizationPolicyView> {
    return this.regularization.policy(principal, query.employeeId);
  }

  @Get()
  @RequirePermission(...VIEW_KEYS)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: RegularizationQueryDto,
  ): Promise<Paginated<RegularizationRequest>> {
    return this.regularization.list(principal, query);
  }

  /** REQ-F-01. */
  @Post()
  @RequirePermission(PERMISSIONS.REGULARIZATION_RAISE)
  raise(
    @CurrentUser() principal: Principal,
    @Body() body: RegularizationInputDto,
  ): Promise<RegularizationRequest> {
    return this.regularization.raise(principal, body);
  }

  @Get(':id')
  @RequirePermission(...VIEW_KEYS)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RegularizationRequest> {
    return this.regularization.get(principal, id);
  }

  /** REQ-F-03: writes the adjustment and recomputes the day. */
  @Post(':id/approve')
  @RequirePermission(PERMISSIONS.REGULARIZATION_APPROVE)
  approve(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RegularizationDecisionDto,
  ): Promise<RegularizationRequest> {
    return this.regularization.approve(principal, id, body.reason);
  }

  /** REQ-F-05: the reason is required by the schema, not by a check in here. */
  @Post(':id/reject')
  @RequirePermission(PERMISSIONS.REGULARIZATION_APPROVE)
  reject(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RegularizationRejectionDto,
  ): Promise<RegularizationRequest> {
    return this.regularization.reject(principal, id, body.reason);
  }
}

@Controller('on-duty-requests')
export class OnDutyController {
  constructor(private readonly regularization: RegularizationService) {}

  @Get()
  @RequirePermission(...VIEW_KEYS)
  list(
    @CurrentUser() principal: Principal,
    @Query() query: OnDutyQueryDto,
  ): Promise<Paginated<OnDutyRequest>> {
    return this.regularization.listOnDuty(principal, query);
  }

  /** REQ-F-04. */
  @Post()
  @RequirePermission(PERMISSIONS.REGULARIZATION_RAISE)
  raise(
    @CurrentUser() principal: Principal,
    @Body() body: OnDutyInputDto,
  ): Promise<OnDutyRequest> {
    return this.regularization.raiseOnDuty(principal, body);
  }

  @Get(':id')
  @RequirePermission(...VIEW_KEYS)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OnDutyRequest> {
    return this.regularization.getOnDuty(principal, id);
  }

  /** REQ-F-04: "those days become ON_DUTY and count as present". */
  @Post(':id/approve')
  @RequirePermission(PERMISSIONS.REGULARIZATION_APPROVE)
  approve(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RegularizationDecisionDto,
  ): Promise<OnDutyRequest> {
    return this.regularization.approveOnDuty(principal, id, body.reason);
  }

  @Post(':id/reject')
  @RequirePermission(PERMISSIONS.REGULARIZATION_APPROVE)
  reject(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RegularizationRejectionDto,
  ): Promise<OnDutyRequest> {
    return this.regularization.rejectOnDuty(principal, id, body.reason);
  }
}
