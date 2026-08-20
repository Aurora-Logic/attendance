import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DISPATCH_MODE_LABELS, PERMISSIONS, SALES_DOCUMENT_STATUS_LABELS, SYNC_STATE_LABELS, type GoToRecord } from '@vyuha/shared';

import type { Principal } from '../../../platform/rbac/principal.js';
import { GoToSourceRegistry, type GoToSource } from '../../../platform/search/go-to-source.registry.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { InvoiceService } from '../invoices/invoice.service.js';
import { SalesOrderService } from './sales-order.service.js';

/**
 * REQ-O-05: typing a sales order, invoice or dispatch number opens it. Three
 * sources in one file because they share a permission and a shape; each
 * registers under its own record type so the palette groups them apart.
 */
const VIEW = [PERMISSIONS.SALES_DOCUMENT_VIEW_SELF, PERMISSIONS.SALES_DOCUMENT_VIEW_ALL] as const;

@Injectable()
export class SalesOrderGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'sales_order';
  readonly permissions = VIEW;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly orders: SalesOrderService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.orders.list(principal, { page: 1, pageSize: limit, q: term });
    return data.map((order) => ({
      type: this.recordType,
      id: order.id,
      title: `Sales order ${order.number}`,
      subtitle: [order.customerName, SALES_DOCUMENT_STATUS_LABELS[order.status], SYNC_STATE_LABELS[order.syncState], order.grandTotal].join(' · '),
      code: order.number,
    }));
  }
}

@Injectable()
export class InvoiceGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'invoice';
  readonly permissions = VIEW;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly invoices: InvoiceService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.invoices.list(principal, { page: 1, pageSize: limit, q: term });
    return data.map((invoice) => ({
      type: this.recordType,
      id: invoice.id,
      title: `Invoice ${invoice.number}`,
      subtitle: [invoice.customerName, SALES_DOCUMENT_STATUS_LABELS[invoice.status], SYNC_STATE_LABELS[invoice.syncState], invoice.grandTotal].join(' · '),
      code: invoice.number,
    }));
  }
}

@Injectable()
export class DispatchGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'dispatch';
  readonly permissions = VIEW;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly dispatches: DispatchService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.dispatches.list(principal, { page: 1, pageSize: limit, q: term });
    return data.map((dispatch) => ({
      type: this.recordType,
      id: dispatch.id,
      title: `Dispatch ${dispatch.number}`,
      subtitle: [dispatch.customerName, dispatch.orderNumber, DISPATCH_MODE_LABELS[dispatch.mode], dispatch.lrNumber].filter((p): p is string => p !== null).join(' · '),
      code: dispatch.number,
    }));
  }
}
