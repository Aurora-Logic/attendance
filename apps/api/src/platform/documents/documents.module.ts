import { Global, Module } from '@nestjs/common';

import { RequirementsService } from '../procurement/requirements.service.js';
import { StockAvailabilityService } from './stock-availability.service.js';

/**
 * What every document module shares: stock availability (REQ-AC-04) and
 * procurement requirements (D-35). `@Global()` so sales and purchase reach
 * both without an import edge between them.
 */
@Global()
@Module({
  providers: [StockAvailabilityService, RequirementsService],
  exports: [StockAvailabilityService, RequirementsService],
})
export class DocumentsModule {}
