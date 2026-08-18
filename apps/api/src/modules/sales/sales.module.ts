import { Module } from '@nestjs/common';

import { EstimateGoToSource } from './estimates/estimate-goto.source.js';
import { EstimateController } from './estimates/estimate.controller.js';
import { EstimateService } from './estimates/estimate.service.js';
import { SalesOrderController } from './orders/sales-order.controller.js';
import { SalesOrderService } from './orders/sales-order.service.js';

/**
 * The sales module (08 Areas W and Y). Opens with the estimate (Phase 8a);
 * sales orders, challans and the push path join as their slices land.
 * Nothing imported: the platform modules it leans on are `@Global()`, and
 * ESLint keeps it from reaching into `modules/crm` or `modules/purchase`.
 */
@Module({
  controllers: [EstimateController, SalesOrderController],
  providers: [EstimateService, EstimateGoToSource, SalesOrderService],
})
export class SalesModule {}
