import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  allocateReceiptSchema,
  closeRequirementSchema,
  createGrnSchema,
  createPurchaseOrderSchema,
  createRequirementSchema,
  purchaseHistoryQuerySchema,
  purchaseOrderFromRequirementsSchema,
  purchaseOrderListQuerySchema,
  purchaseSettingsSchema,
  type PurchaseSettings,
  putItemSettingsSchema,
  putItemVendorsSchema,
  requirementListQuerySchema,
  shortClosePurchaseOrderSchema,
  updatePurchaseOrderSchema,
  type GrnView,
  type ItemVendorView,
  type Paginated,
  type PurchaseHistoryEntry,
  type PurchaseOrderSummary,
  type PurchaseOrderView,
  type RequirementView,
  type StockAvailability,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { AppError } from '../../../platform/common/errors.js';
import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { StockAvailabilityService } from '../../../platform/documents/stock-availability.service.js';
import { RequirementsService } from '../../../platform/procurement/requirements.service.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { PurchaseOrderService } from './purchase-order.service.js';

class PurchaseSettingsDto extends createZodDto(purchaseSettingsSchema) {}
class RequirementListQueryDto extends createZodDto(requirementListQuerySchema) {}
class CreateRequirementDto extends createZodDto(createRequirementSchema) {}
class CloseRequirementDto extends createZodDto(closeRequirementSchema) {}
class PurchaseOrderListQueryDto extends createZodDto(purchaseOrderListQuerySchema) {}
class CreatePurchaseOrderDto extends createZodDto(createPurchaseOrderSchema) {}
class UpdatePurchaseOrderDto extends createZodDto(updatePurchaseOrderSchema) {}
class FromRequirementsDto extends createZodDto(purchaseOrderFromRequirementsSchema) {}
class CreateGrnDto extends createZodDto(createGrnSchema) {}
class AllocateReceiptDto extends createZodDto(allocateReceiptSchema) {}
class ShortCloseDto extends createZodDto(shortClosePurchaseOrderSchema) {}
class PutItemVendorsDto extends createZodDto(putItemVendorsSchema) {}
class PutItemSettingsDto extends createZodDto(putItemSettingsSchema) {}
class PurchaseHistoryQueryDto extends createZodDto(purchaseHistoryQuerySchema) {}

const VIEW = PERMISSIONS.PURCHASE_DOCUMENT_VIEW;
const CREATE = PERMISSIONS.PURCHASE_DOCUMENT_CREATE;
const APPROVE = PERMISSIONS.PURCHASE_DOCUMENT_APPROVE;

/** `/api/v1/purchase/*` (13): the queue, purchase orders, GRNs, allocation, and the item facts. */
@Controller('purchase')
export class PurchaseController {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly orders: PurchaseOrderService,
    private readonly requirements: RequirementsService,
    private readonly availability: StockAvailabilityService,
  ) {}

  // ----------------------------------------------------------- requirements

  /** REQ-X-12: the purchase team's home — by needed-by, with who waits behind each. */
  /** REQ-X-16 / REQ-AA-15: the thresholds. Read by anyone who may see purchasing; set by an approver. */
  @Get('settings')
  @RequirePermission(VIEW)
  readSettings(@CurrentUser() principal: Principal): Promise<PurchaseSettings> {
    return this.orders.readSettings(principal.orgId);
  }

  @Put('settings')
  @RequirePermission(APPROVE)
  writeSettings(@CurrentUser() principal: Principal, @Body() body: PurchaseSettingsDto): Promise<PurchaseSettings> {
    return this.orders.writeSettings(principal, body);
  }

  @Get('requirements')
  @RequirePermission(VIEW)
  listRequirements(@CurrentUser() principal: Principal, @Query() query: RequirementListQueryDto): Promise<RequirementView[]> {
    return this.requirements.list(principal.orgId, query);
  }

  @Post('requirements')
  @RequirePermission(CREATE)
  @HttpCode(HttpStatus.CREATED)
  async raiseRequirement(@CurrentUser() principal: Principal, @Body() body: CreateRequirementDto): Promise<RequirementView> {
    const inserted = await this.db.execute<{ id: string }>(sql`
      INSERT INTO procurement_requirements (org_id, stock_item_id, quantity, source, needed_by, created_by, updated_by)
      SELECT ${principal.orgId}, s.id, ${body.quantity}, 'manual', ${body.neededBy ?? null}, ${principal.userId}, ${principal.userId}
        FROM stock_items s WHERE s.org_id = ${principal.orgId} AND s.id = ${body.stockItemId}
      RETURNING id
    `);
    const id = inserted.rows[0]?.id;
    if (id === undefined) throw AppError.validation('The stock item was not found.', { stockItemId: body.stockItemId });
    const rows = await this.requirements.list(principal.orgId, {});
    const created = rows.find((r) => r.id === id);
    if (created === undefined) throw new Error('Requirement vanished after insert.');
    return created;
  }

  @Post('requirements/:id/close')
  @RequirePermission(CREATE)
  @HttpCode(HttpStatus.OK)
  async closeRequirement(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CloseRequirementDto): Promise<{ closed: boolean }> {
    const closed = await this.requirements.close(principal.orgId, principal.userId, id, body.reason);
    if (!closed) throw AppError.notFound('Requirement', id);
    return { closed };
  }

  // -------------------------------------------------------- purchase orders

  @Get('orders')
  @RequirePermission(VIEW)
  list(@CurrentUser() principal: Principal, @Query() query: PurchaseOrderListQueryDto): Promise<Paginated<PurchaseOrderSummary>> {
    return this.orders.list(principal, query);
  }

  @Get('orders/:id')
  @RequirePermission(VIEW)
  find(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderView> {
    return this.orders.find(principal, id);
  }

  @Post('orders')
  @RequirePermission(CREATE)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() principal: Principal, @Body() body: CreatePurchaseOrderDto): Promise<PurchaseOrderView> {
    return this.orders.create(principal, body);
  }

  @Post('orders/from-requirements')
  @RequirePermission(CREATE)
  @HttpCode(HttpStatus.CREATED)
  fromRequirements(@CurrentUser() principal: Principal, @Body() body: FromRequirementsDto): Promise<PurchaseOrderView> {
    return this.orders.createFromRequirements(principal, body);
  }

  @Patch('orders/:id')
  @RequirePermission(CREATE)
  update(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePurchaseOrderDto): Promise<PurchaseOrderView> {
    return this.orders.update(principal, id, body);
  }

  @Post('orders/:id/confirm')
  @RequirePermission(CREATE)
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderView> {
    return this.orders.confirm(principal, id);
  }

  @Post('orders/:id/approve')
  @RequirePermission(APPROVE)
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderView> {
    return this.orders.approve(principal, id);
  }

  @Post('orders/:id/push')
  @RequirePermission(CREATE)
  @HttpCode(HttpStatus.OK)
  push(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderView> {
    return this.orders.push(principal, id);
  }

  @Post('orders/:id/short-close')
  @RequirePermission(APPROVE)
  @HttpCode(HttpStatus.OK)
  shortClose(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ShortCloseDto): Promise<PurchaseOrderView> {
    return this.orders.shortClose(principal, id, body.reason);
  }

  @Post('orders/:id/cancel')
  @RequirePermission(CREATE)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderView> {
    return this.orders.cancel(principal, id);
  }

  // ------------------------------------------------------------------ GRNs

  @Get('grns')
  @RequirePermission(VIEW)
  listGrns(@CurrentUser() principal: Principal, @Query('purchaseOrderId') purchaseOrderId?: string): Promise<GrnView[]> {
    return this.orders.listGrns(principal, purchaseOrderId);
  }

  @Get('grns/:id')
  @RequirePermission(VIEW)
  findGrn(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<GrnView> {
    return this.orders.findGrn(principal, id);
  }

  @Post('orders/:id/grns')
  @RequirePermission(CREATE)
  @HttpCode(HttpStatus.CREATED)
  receive(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateGrnDto): Promise<GrnView> {
    return this.orders.receive(principal, id, body);
  }

  @Post('grns/:id/allocate')
  @RequirePermission(APPROVE)
  @HttpCode(HttpStatus.OK)
  allocate(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: AllocateReceiptDto): Promise<GrnView> {
    return this.orders.allocateReceipt(principal, id, body);
  }

  // ------------------------------------------------------------ item facts

  @Get('items/:stockItemId/vendors')
  @RequirePermission(VIEW)
  vendors(@CurrentUser() principal: Principal, @Param('stockItemId', ParseUUIDPipe) stockItemId: string): Promise<ItemVendorView[]> {
    return this.orders.itemVendors(principal.orgId, stockItemId);
  }

  @Put('items/:stockItemId/vendors')
  @RequirePermission(CREATE)
  putVendors(@CurrentUser() principal: Principal, @Param('stockItemId', ParseUUIDPipe) stockItemId: string, @Body() body: PutItemVendorsDto): Promise<ItemVendorView[]> {
    return this.orders.putItemVendors(principal, stockItemId, body);
  }

  @Put('items/:stockItemId/settings')
  @RequirePermission(CREATE)
  async putSettings(@CurrentUser() principal: Principal, @Param('stockItemId', ParseUUIDPipe) stockItemId: string, @Body() body: PutItemSettingsDto): Promise<StockAvailability> {
    await this.orders.putItemSettings(principal, stockItemId, body);
    const availability = await this.availability.forItem(principal.orgId, stockItemId);
    if (availability === null) throw AppError.notFound('Stock item', stockItemId);
    return availability;
  }

  @Get('items/:stockItemId/availability')
  @RequirePermission(VIEW)
  async itemAvailability(@CurrentUser() principal: Principal, @Param('stockItemId', ParseUUIDPipe) stockItemId: string): Promise<StockAvailability> {
    const availability = await this.availability.forItem(principal.orgId, stockItemId);
    if (availability === null) throw AppError.notFound('Stock item', stockItemId);
    return availability;
  }

  @Get('item-history')
  @RequirePermission(VIEW)
  history(@CurrentUser() principal: Principal, @Query() query: PurchaseHistoryQueryDto): Promise<PurchaseHistoryEntry[]> {
    return this.orders.purchaseHistory(principal.orgId, query);
  }

  /** There is no route that writes a stock figure (REQ-AC-07); this one exists to say so. */
  @Delete('items/:stockItemId/stock')
  @RequirePermission(VIEW)
  refuseStockWrite(): never {
    throw AppError.conflict('Vyuha never writes a stock figure (REQ-AC-07). Stock moves only through a Delivery Note or a Receipt Note in Tally.');
  }
}
