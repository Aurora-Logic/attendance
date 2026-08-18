import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  createEstimateSchema,
  estimateListQuerySchema,
  estimateStatusSchema,
  itemHistoryQuerySchema,
  updateEstimateSchema,
  type EstimateSummary,
  type EstimateView,
  type ItemHistoryView,
  type Paginated,
} from '@vyuha/shared';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { EstimateService } from './estimate.service.js';

class EstimateListQueryDto extends createZodDto(estimateListQuerySchema) {}
class CreateEstimateDto extends createZodDto(createEstimateSchema) {}
class UpdateEstimateDto extends createZodDto(updateEstimateSchema) {}
class EstimateStatusDto extends createZodDto(estimateStatusSchema) {}
class ItemHistoryQueryDto extends createZodDto(itemHistoryQuerySchema) {}

const VIEW = [PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, PERMISSIONS.SALES_DOCUMENT_VIEW_ALL] as const;

/** `/api/v1/sales/estimates` (REQ-W-01) and the item history behind the line editor (REQ-W-02). */
@Controller('sales')
export class EstimateController {
  constructor(private readonly estimates: EstimateService) {}

  @Get('estimates')
  @RequirePermission(...VIEW)
  list(@CurrentUser() principal: Principal, @Query() query: EstimateListQueryDto): Promise<Paginated<EstimateSummary>> {
    return this.estimates.list(principal, query);
  }

  @Get('item-history')
  @RequirePermission(...VIEW)
  itemHistory(@CurrentUser() principal: Principal, @Query() query: ItemHistoryQueryDto): Promise<ItemHistoryView> {
    return this.estimates.itemHistory(principal, query);
  }

  @Get('estimates/:id')
  @RequirePermission(...VIEW)
  find(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<EstimateView> {
    return this.estimates.find(principal, id);
  }

  @Post('estimates')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() principal: Principal, @Body() body: CreateEstimateDto): Promise<EstimateView> {
    return this.estimates.create(principal, body);
  }

  @Patch('estimates/:id')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateEstimateDto,
  ): Promise<EstimateView> {
    return this.estimates.update(principal, id, body);
  }

  @Post('estimates/:id/status')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  setStatus(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EstimateStatusDto,
  ): Promise<EstimateView> {
    return this.estimates.setStatus(principal, id, body);
  }

  @Delete('estimates/:id')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.estimates.remove(principal, id);
  }
}
