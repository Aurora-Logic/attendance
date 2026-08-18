import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PERMISSIONS, createInvoiceSchema, invoiceListQuerySchema, type Paginated, type SalesDocumentSummary, type SalesDocumentView } from '@vyuha/shared';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { InvoiceService } from './invoice.service.js';

class InvoiceListQueryDto extends createZodDto(invoiceListQuerySchema) {}
class CreateInvoiceDto extends createZodDto(createInvoiceSchema) {}

const VIEW = [PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, PERMISSIONS.SALES_DOCUMENT_VIEW_ALL] as const;

/** Vyuha-raised invoices (D-38). */
@Controller('sales')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get('invoices')
  @RequirePermission(...VIEW)
  list(@CurrentUser() principal: Principal, @Query() query: InvoiceListQueryDto): Promise<Paginated<SalesDocumentSummary>> {
    return this.invoices.list(principal, query);
  }

  @Get('invoices/:id')
  @RequirePermission(...VIEW)
  find(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<SalesDocumentView> {
    return this.invoices.find(principal, id);
  }

  @Post('orders/:id/invoices')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateInvoiceDto): Promise<SalesDocumentView> {
    return this.invoices.createFromOrder(principal, id, body);
  }

  @Post('invoices/:id/confirm')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<SalesDocumentView> {
    return this.invoices.confirm(principal, id);
  }

  @Post('invoices/:id/push')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.OK)
  push(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<SalesDocumentView> {
    return this.invoices.push(principal, id);
  }

  @Post('invoices/:id/cancel')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<SalesDocumentView> {
    return this.invoices.cancel(principal, id);
  }
}
