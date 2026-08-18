import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  JobRegistry,
  type JobContext,
  type JobHandler,
  type JobResult,
} from '../jobs/job-handler.js';
import type { JobPayloads } from '../jobs/queue.registry.js';
import { SyncSchedulerService } from './sync-scheduler.service.js';

/**
 * REQ-Q-04's timer, registered the way every handler is. The edge detection
 * lives in the service's own UPDATEs, so this can run as often as the cron
 * likes without a second notification existing anywhere to send.
 */
@Injectable()
export class SyncStalenessHandler implements JobHandler<'check-agent-heartbeats'>, OnModuleInit {
  readonly jobName = 'check-agent-heartbeats' as const;

  constructor(
    private readonly scheduler: SyncSchedulerService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(
    _payload: JobPayloads['check-agent-heartbeats'],
    _context: JobContext,
  ): Promise<JobResult> {
    const outcome = await this.scheduler.checkHeartbeatStaleness();
    return { wentStale: outcome.wentStale, recovered: outcome.recovered };
  }
}
