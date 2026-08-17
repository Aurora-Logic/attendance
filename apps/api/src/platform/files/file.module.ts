import { Global, Module } from '@nestjs/common';

import { FileService } from './file.service.js';
import { RawFilesController } from './raw-files.controller.js';

/**
 * Global because the punch pipeline (Phase 1), the export worker (Phase 3),
 * and the retention job all store or read files, and a second instance would
 * be a second place the storage-key convention could drift.
 */
@Global()
@Module({
  controllers: [RawFilesController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
