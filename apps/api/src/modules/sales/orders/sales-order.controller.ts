import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  confirmSalesOrderSchema,
  convertEstimateSchema,
  createSalesOrderSchema,
  salesOrderListQuerySchema,
  salesSettingsSchema,
  type SalesSettings,
  updateSalesOrderSchema,
  type Paginated,
  type SalesDocumentSummary,
  type SalesDocumentView,
  type CreditPosition,
} from '@vyuha/shared';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { SalesOrderService } from './sales-order.service.js';

class SalesOrderListQueryDto extends createZodDto(salesOrderListQuerySchema) {}
class CreateSalesOrderDto extends createZodDto(createSalesOrderSchema) {}
class UpdateSalesOrderDto extends createZodDto(updateSalesOrderSchema) {}
class ConvertEstimateDto extends createZodDto(convertEstimateSchema) {}
class ConfirmSalesOrderDto extends createZodDto(confirmSalesOrderSchema) {}
class SalesSettingsDto extends createZodDto(salesSettingsSchema) {}

const VIEW = [PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, PERMISSIONS.SALES_DOCUMENT_VIEW_ALL] as const;

/** `/api/v1/sales/orders` (REQ-W-03, W-06, W-07) and the estimate → order conversion. */
@Controller('sales')
export class SalesOrderController {
  constructor(private readonly orders: SalesOrderService) {}

  @Get('orders')
  @RequirePermission(...VIEW)
  list(@CurrentUser() principal: Principal, @Query() query: SalesOrderListQueryDto): Promise<Paginated<SalesDocumentSummary>> {
    return this.orders.list(principal, query);
  }

  @Get('orders/:id')
  @RequirePermission(...VIEW)
  find(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<SalesDocumentView> {
    return this.orders.find(principal, id);
  }

  @Post('orders')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() principal: Principal, @Body() body: CreateSalesOrderDto): Promise<SalesDocumentView> {
    return this.orders.create(principal, body);
  }

  @Post('estimates/:id/convert')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  convert(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConvertEstimateDto,
  ): Promise<SalesDocumentView> {
    return this.orders.convertFromEstimate(principal, id, body);
  }

  @Patch('orders/:id')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSalesOrderDto,
  ): Promise<SalesDocumentView> {
    return this.orders.update(principal, id, body);
  }

  @Post('orders/:id/confirm')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConfirmSalesOrderDto): Promise<SalesDocumentView> {
    return this.orders.confirm(principal, id, body);
  }

  /** REQ-W-08: the button on the order decides the same inbox request. */
  @Post('orders/:id/approve')
  @RequirePermission(PERMISSIONS.SALES_DISCOUNT_APPROVE)
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<SalesDocumentView> {
    return this.orders.approve(principal, id);
  }

  /** REQ-W-08: the discount threshold; read by anyone who may see orders, set by a discount approver. */
  @Get('settings')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, PERMISSIONS.SALES_DOCUMENT_VIEW_ALL)
  readSettings(@CurrentUser() principal: Principal): Promise<SalesSettings> {
    return this.orders.readSettings(principal.orgId);
  }

  @Put('settings')
  @RequirePermission(PERMISSIONS.SALES_DISCOUNT_APPROVE)
  writeSettings(@CurrentUser() principal: Principal, @Body() body: SalesSettingsDto): Promise<SalesSettings> {
    return this.orders.writeSettings(principal, body);
  }

  /** REQ-W-09 / REQ-Y-03: the party's credit position, as the block would state it. */
  @Get('orders/:id/credit-position')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, PERMISSIONS.SALES_DOCUMENT_VIEW_ALL)
  creditPosition(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<CreditPosition | null> {
    return this.orders.creditPositionOf(principal, id);
  }

  @Post('orders/:id/push')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.OK)
  push(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<SalesDocumentView> {
    return this.orders.push(principal, id);
  }

  /** REQ-W-07. The service checks `sales.document.alter`; the guard only keeps strangers out. */
  @Post('orders/:id/alter')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_ALTER)
  @HttpCode(HttpStatus.OK)
  alter(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSalesOrderDto,
  ): Promise<SalesDocumentView> {
    return this.orders.alter(principal, id, body);
  }

  @Post('orders/:id/cancel')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<SalesDocumentView> {
    return this.orders.cancel(principal, id);
  }
}
