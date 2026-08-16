import { Module } from '@nestjs/common';

import { MastersController } from './masters.controller.js';
import { MastersService } from './masters.service.js';
import { PartyGoToSource } from './party-goto.source.js';

/**
 * The Tally masters projection's read surface (09 §5). Nothing is imported
 * and nothing writes: the projection's one writer lives in `platform/sync`,
 * and this module is what lets every other consumer say "I only read".
 */
@Module({
  controllers: [MastersController],
  providers: [MastersService, PartyGoToSource],
  exports: [MastersService],
})
export class MastersModule {}
