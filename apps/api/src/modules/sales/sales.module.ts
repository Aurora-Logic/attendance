import { Module } from '@nestjs/common';

import { EstimateGoToSource } from './estimates/estimate-goto.source.js';
import { EstimateController } from './estimates/estimate.controller.js';
import { EstimateService } from './estimates/estimate.service.js';
import { SalesOrderController } from './orders/sales-order.controller.js';
import { SalesOrderService } from './orders/sales-order.service.js';
import { FulfilmentController } from './fulfilment/fulfilment.controller.js';
import { FulfilmentService } from './fulfilment/fulfilment.service.js';
import { DispatchController } from './dispatch/dispatch.controller.js';
import { DispatchService } from './dispatch/dispatch.service.js';
import { SalesReportSource } from './reports/sales-report.source.js';
import { InvoiceController } from './invoices/invoice.controller.js';
import { InvoiceService } from './invoices/invoice.service.js';

/**
 * The sales module (08 Areas W and Y). Opens with the estimate (Phase 8a);
 * sales orders, challans and the push path join as their slices land.
 * Nothing imported: the platform modules it leans on are `@Global()`, and
 * ESLint keeps it from reaching into `modules/crm` or `modules/purchase`.
 */
@Module({
  controllers: [EstimateController, SalesOrderController, FulfilmentController, DispatchController, InvoiceController],
  providers: [EstimateService, EstimateGoToSource, SalesOrderService, FulfilmentService, DispatchService, SalesReportSource, InvoiceService],
})
export class SalesModule {}
