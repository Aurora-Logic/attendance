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
 * REQ-R-07's timer: every fifteen minutes, make pull work exist for every
 * connection that could claim it. Registered like every other handler — it
 * puts itself into the global `JobRegistry` on init, so `JobsModule` never
 * grows an import for it.
 *
 * Deliberately does nothing but enqueue. The pull itself happens when the
 * agent polls, claims, and posts results; a sweep that reached into Tally
 * would be the inbound connection the whole design exists to avoid (09 §1).
 */
@Injectable()
export class SyncPullSweepHandler implements JobHandler<'enqueue-sync-pulls'>, OnModuleInit {
  readonly jobName = 'enqueue-sync-pulls' as const;

  constructor(
    private readonly scheduler: SyncSchedulerService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(_payload: JobPayloads['enqueue-sync-pulls'], _context: JobContext): Promise<JobResult> {
    const outcome = await this.scheduler.enqueueDuePulls();
    return { enqueued: outcome.enqueued };
  }
}
