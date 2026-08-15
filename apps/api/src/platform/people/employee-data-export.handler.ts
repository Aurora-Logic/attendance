import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  JobRegistry,
  type JobContext,
  type JobHandler,
  type JobResult,
} from '../jobs/job-handler.js';
import type { JobPayloads } from '../jobs/queue.registry.js';
import { EmployeeDataExportService } from './employee-data-export.service.js';

/**
 * REQ-M-05's background half.
 *
 * It lives beside the service rather than in `platform/jobs/handlers/` for the
 * same reason the report export handler lives in its own slice: the handler is
 * the job's entry point, and keeping it with the thing it drives means adding a
 * job never touches the queue module. `JobsModule` is `@Global()` and this
 * registers itself, so nothing in `platform/jobs` learns that people exist.
 */
@Injectable()
export class EmployeeDataExportHandler implements JobHandler<'export-employee-data'>, OnModuleInit {
  readonly jobName = 'export-employee-data' as const;

  constructor(
    private readonly exports: EmployeeDataExportService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(
    payload: JobPayloads['export-employee-data'],
    context: JobContext,
  ): Promise<JobResult> {
    const result = await this.exports.run(payload.orgId, payload.exportJobId, context.attempt);
    return {
      exportJobId: payload.exportJobId,
      outcome: result.outcome,
      rows: result.rows,
      reason: result.reason,
    };
  }
}
