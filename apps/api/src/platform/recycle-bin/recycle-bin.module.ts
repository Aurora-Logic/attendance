import { Global, Module } from '@nestjs/common';

import { RecycleBinController } from './recycle-bin.controller.js';
import { RecycleBinService } from './recycle-bin.service.js';
import { SoftDeletableRegistry } from './soft-deletable.js';

/**
 * Global for the same reason `RbacModule` is: the registry has to be injectable
 * into every module that owns a master, and a second local copy would be a
 * second registry with half the masters in it.
 *
 * Nothing here imports a module. Registration goes the other way — each module
 * calls `registry.register(...)` on init — which is what keeps the platform
 * from having to know that `shifts` exists (technical design §1).
 */
@Global()
@Module({
  controllers: [RecycleBinController],
  providers: [SoftDeletableRegistry, RecycleBinService],
  exports: [SoftDeletableRegistry, RecycleBinService],
})
export class RecycleBinModule {}
