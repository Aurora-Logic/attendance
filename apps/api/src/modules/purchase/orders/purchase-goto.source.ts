import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS, PURCHASE_ORDER_STATUS_LABELS, SYNC_STATE_LABELS, type GoToRecord } from '@vyuha/shared';

import type { Principal } from '../../../platform/rbac/principal.js';
import { GoToSourceRegistry, type GoToSource } from '../../../platform/search/go-to-source.registry.js';
import { PurchaseOrderService } from './purchase-order.service.js';

/** REQ-O-05: typing a purchase order number opens it. */
@Injectable()
export class PurchaseOrderGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'purchase_order';
  readonly permissions = [PERMISSIONS.PURCHASE_DOCUMENT_VIEW] as const;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly orders: PurchaseOrderService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.orders.list(principal, { page: 1, pageSize: limit, q: term });
    return data.map((po) => ({
      type: this.recordType,
      id: po.id,
      title: `Purchase order ${po.number}`,
      subtitle: [po.vendorName, PURCHASE_ORDER_STATUS_LABELS[po.status], SYNC_STATE_LABELS[po.syncState], po.grandTotal].join(' · '),
      code: po.number,
    }));
  }
}
