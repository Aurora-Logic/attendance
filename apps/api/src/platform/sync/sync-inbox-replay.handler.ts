import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  JobRegistry,
  type JobContext,
  type JobHandler,
  type JobResult,
} from '../jobs/job-handler.js';
import type { JobPayloads } from '../jobs/queue.registry.js';
import { OpsTallyWebhookService } from './opstally-webhook.service.js';

/** Phase 6c: drains vouchers retained in the inbox before their projection existed. */
@Injectable()
export class SyncInboxReplayHandler implements JobHandler<'replay-sync-inbox'>, OnModuleInit {
  readonly jobName = 'replay-sync-inbox' as const;

  constructor(
    private readonly opsTally: OpsTallyWebhookService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(_payload: JobPayloads['replay-sync-inbox'], _context: JobContext): Promise<JobResult> {
    const outcome = await this.opsTally.replayDeferred();
    return { replayed: outcome.replayed, skipped: outcome.skipped };
  }
}
