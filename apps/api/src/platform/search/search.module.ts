import { Global, Module } from '@nestjs/common';

import { GoToController } from './go-to.controller.js';
import { GoToSourceRegistry } from './go-to-source.registry.js';
import { GoToService } from './go-to.service.js';

/**
 * The Go To record index (REQ-O-05).
 *
 * `@Global()` for the same reason `JobsModule` is: sources register themselves
 * from whichever module owns the records, during their own `onModuleInit`, and
 * a registry every module must be able to reach without an import edge is what
 * keeps the arrow pointing one way — modules know about the index, the index
 * knows about none of them.
 */
@Global()
@Module({
  controllers: [GoToController],
  providers: [GoToSourceRegistry, GoToService],
  exports: [GoToSourceRegistry],
})
export class SearchModule {}
