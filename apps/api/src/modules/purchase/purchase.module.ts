import { Module } from '@nestjs/common';

import { ApprovalModule } from '../../platform/approvals/approvals.module.js';
import { NotificationsModule } from '../../platform/notifications/notifications.module.js';
import { PurchaseOrderApprovalHandler } from './orders/purchase-order-approval.handler.js';
import { PurchaseOrderGoToSource } from './orders/purchase-goto.source.js';
import { PurchaseOrderService } from './orders/purchase-order.service.js';
import { PurchaseController } from './orders/purchase.controller.js';
import { ReorderSweepHandler } from './reorder-sweep.handler.js';

/** The purchase module (13). Requirements live in the platform (D-35); this consumes them. */
@Module({
  imports: [NotificationsModule, ApprovalModule],
  controllers: [PurchaseController],
  providers: [PurchaseOrderService, PurchaseOrderApprovalHandler, PurchaseOrderGoToSource, ReorderSweepHandler],
})
export class PurchaseModule {}
