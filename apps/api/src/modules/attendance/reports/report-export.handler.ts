import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  JobRegistry,
  type JobContext,
  type JobHandler,
  type JobResult,
} from '../../../platform/jobs/job-handler.js';
import type { JobPayloads } from '../../../platform/jobs/queue.registry.js';
import { ExportService } from './export.service.js';

/**
 * REQ-J-03's background half.
 *
 * The handler lives in the attendance module rather than beside
 * `PurgeExpiredFilesHandler` in `platform/jobs/handlers/`, and it has to:
 * producing the rows means knowing what a report is, and technical design §1
 * forbids `platform/` from importing `modules/`. Registration is the same
 * either way -- the handler puts itself into the global `JobRegistry` during
 * `onModuleInit`, so `JobsModule` never grows an import for it.
 *
 * The payload carries only the row id. Everything else -- filters, columns,
 * who asked -- is read from `export_jobs` at run time, which is what lets a
 * retry pick up where it left off and what makes the tray and the worker agree
 * about what is being produced.
 */
@Injectable()
export class ReportExportHandler implements JobHandler<'generate-report-export'>, OnModuleInit {
  readonly jobName = 'generate-report-export' as const;

  constructor(
    private readonly exports: ExportService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(
    payload: JobPayloads['generate-report-export'],
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
