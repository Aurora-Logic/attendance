import { Global, Module } from '@nestjs/common';

import { ObjectStore } from './object-store.js';

/**
 * Global for the same reason `DbModule` is: the punch pipeline, the export
 * worker, and the retention job all need the same client, and a second one
 * would be a second connection pool and a second place to get the endpoint
 * configuration wrong.
 */
@Global()
@Module({
  providers: [ObjectStore],
  exports: [ObjectStore],
})
export class StorageModule {}
