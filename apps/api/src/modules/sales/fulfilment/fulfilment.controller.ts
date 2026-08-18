import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  PERMISSIONS,
  createPackRecordSchema,
  linkInvoiceSchema,
  shortCloseSchema,
  type AwaitingInvoiceEntry,
  type PackRecordView,
  type PickQueueEntry,
  type SalesDocumentView,
  type UnlinkedInvoice,
} from '@vyuha/shared';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { FulfilmentService } from './fulfilment.service.js';

class CreatePackRecordDto extends createZodDto(createPackRecordSchema) {}
class LinkInvoiceDto extends createZodDto(linkInvoiceSchema) {}
class ShortCloseDto extends createZodDto(shortCloseSchema) {}

const VIEW = [PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, PERMISSIONS.SALES_DOCUMENT_VIEW_ALL] as const;

/** Pick queue, packing, and the billing handshake (12 §3.2, §3.3). */
@Controller('sales')
export class FulfilmentController {
  constructor(private readonly fulfilment: FulfilmentService) {}

  @Get('pick-queue')
  @RequirePermission(...VIEW)
  pickQueue(@CurrentUser() principal: Principal): Promise<PickQueueEntry[]> {
    return this.fulfilment.pickQueue(principal);
  }

  @Get('awaiting-invoice')
  @RequirePermission(...VIEW)
  awaitingInvoice(@CurrentUser() principal: Principal): Promise<AwaitingInvoiceEntry[]> {
    return this.fulfilment.awaitingInvoice(principal);
  }

  @Get('invoices/unlinked')
  @RequirePermission(...VIEW)
  unlinked(@CurrentUser() principal: Principal): Promise<UnlinkedInvoice[]> {
    return this.fulfilment.unlinkedInvoices(principal);
  }

  @Get('orders/:id/packs')
  @RequirePermission(...VIEW)
  packs(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<PackRecordView[]> {
    return this.fulfilment.listPacks(principal, id);
  }

  @Post('orders/:id/packs')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  pack(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreatePackRecordDto): Promise<PackRecordView> {
    return this.fulfilment.pack(principal, id, body);
  }

  @Post('orders/:id/link-invoice')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_CREATE)
  @HttpCode(HttpStatus.OK)
  linkInvoice(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: LinkInvoiceDto): Promise<SalesDocumentView> {
    return this.fulfilment.linkInvoice(principal, id, body.voucherId);
  }

  @Post('orders/:id/short-close')
  @RequirePermission(PERMISSIONS.SALES_DOCUMENT_ALTER)
  @HttpCode(HttpStatus.OK)
  shortClose(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ShortCloseDto): Promise<SalesDocumentView> {
    return this.fulfilment.shortClose(principal, id, body.reason);
  }
}
