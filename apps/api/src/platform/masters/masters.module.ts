import { Module } from '@nestjs/common';

import { MastersController } from './masters.controller.js';
import { LifecycleAnalyticsService } from './lifecycle-analytics.service.js';
import { LifecycleService } from './lifecycle.service.js';
import { MastersService } from './masters.service.js';
import { PartyGoToSource } from './party-goto.source.js';
import { AnalyticsReportSource } from './analytics-report.source.js';
import { ExceptionSweepHandler } from './exception-sweep.handler.js';
import { TallyReportSource } from './tally-report.source.js';
import { VoucherGoToSource } from './voucher-goto.source.js';

/**
 * The Tally masters projection's read surface (09 §5). Nothing is imported
 * and nothing writes: the projection's one writer lives in `platform/sync`,
 * and this module is what lets every other consumer say "I only read".
 */
@Module({
  controllers: [MastersController],
  providers: [MastersService, LifecycleService, LifecycleAnalyticsService, PartyGoToSource, VoucherGoToSource, TallyReportSource, AnalyticsReportSource, ExceptionSweepHandler],
  exports: [MastersService],
})
export class MastersModule {}
