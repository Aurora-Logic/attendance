import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../../platform/db/db.provider.js';
import { JobRegistry, type JobContext, type JobHandler, type JobResult } from '../../platform/jobs/job-handler.js';
import type { JobPayloads } from '../../platform/jobs/queue.registry.js';
import { RequirementsService } from '../../platform/procurement/requirements.service.js';

/** REQ-X-09: nightly, one requirement per item at or below its reorder level, skipping what an open PO covers. */
@Injectable()
export class ReorderSweepHandler implements JobHandler<'raise-reorder-requirements'>, OnModuleInit {
  readonly jobName = 'raise-reorder-requirements' as const;

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly registry: JobRegistry,
    private readonly requirements: RequirementsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(_payload: JobPayloads['raise-reorder-requirements'], _context: JobContext): Promise<JobResult> {
    const orgs = await this.db.execute<{ id: string }>(sql`SELECT id FROM organizations WHERE deleted_at IS NULL`);
    let raised = 0;
    for (const org of orgs.rows) raised += await this.requirements.raiseReorderBreaches(org.id);
    return { raised };
  }
}
