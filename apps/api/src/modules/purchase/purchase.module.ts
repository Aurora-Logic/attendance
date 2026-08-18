import { Module } from '@nestjs/common';

import { NotificationsModule } from '../../platform/notifications/notifications.module.js';
import { PurchaseOrderService } from './orders/purchase-order.service.js';
import { PurchaseController } from './orders/purchase.controller.js';
import { ReorderSweepHandler } from './reorder-sweep.handler.js';

/** The purchase module (13). Requirements live in the platform (D-35); this consumes them. */
@Module({
  imports: [NotificationsModule],
  controllers: [PurchaseController],
  providers: [PurchaseOrderService, ReorderSweepHandler],
})
export class PurchaseModule {}
