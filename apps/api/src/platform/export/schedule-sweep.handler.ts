import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  JobRegistry,
  type JobContext,
  type JobHandler,
  type JobResult,
} from '../jobs/job-handler.js';
import type { JobPayloads } from '../jobs/queue.registry.js';
import { ScheduleService } from './schedule.service.js';

/**
 * REQ-J-05's timer.
 *
 * Runs every fifteen minutes and enqueues an ordinary export for each schedule
 * that has come due. It deliberately produces nothing itself: an export is
 * already a job with progress, retries, a tray row and a signed download, and
 * doing the work here would be a second implementation of all of that which
 * the Downloads tray could not see.
 *
 * Fifteen minutes is the resolution, so a schedule set for 06:00 runs somewhere
 * in 06:00-06:14. That is deliberate rather than a limitation: a per-schedule
 * cron entry would mean BullMQ schedulers created and destroyed as people add
 * and remove schedules, and a sweep that reads a table cannot drift out of step
 * with the rows it reads.
 *
 * Beside the export framework rather than in `platform/jobs/handlers/`, for
 * the reason `ReportExportHandler` gives: it drives this framework, and the
 * framework no longer needs to know what a report is (REQ-P-02).
 */
@Injectable()
export class ScheduleSweepHandler implements JobHandler<'run-report-schedules'>, OnModuleInit {
  readonly jobName = 'run-report-schedules' as const;

  constructor(
    private readonly schedules: ScheduleService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(
    payload: JobPayloads['run-report-schedules'],
    _context: JobContext,
  ): Promise<JobResult> {
    /*
     * The instant comes from the payload when the caller supplied one, and from
     * the clock otherwise. The scheduler does not set it; a test does, which is
     * what makes "is this schedule due at 06:05 in Asia/Kolkata" answerable
     * without waiting until 06:05 in Asia/Kolkata.
     */
    const now = payload.now === undefined ? new Date() : new Date(payload.now);
    const outcome = await this.schedules.runDue(now);
    return {
      considered: outcome.considered,
      started: outcome.started,
      skipped: outcome.skipped,
    };
  }
}
