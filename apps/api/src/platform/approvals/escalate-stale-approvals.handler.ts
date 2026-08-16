import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  JobRegistry,
  type JobContext,
  type JobHandler,
  type JobResult,
} from '../jobs/job-handler.js';
import type { JobPayloads } from '../jobs/queue.registry.js';
import { ApprovalService } from './approval.service.js';

/**
 * REQ-G-09's escalation sweep, on the schedule declared in `queue.registry.ts`.
 *
 * Registered the way `PurgeExpiredFilesHandler` is -- the handler puts itself
 * into the global `JobRegistry` during `onModuleInit`, and `JobsModule` never
 * imports it. That indirection is what keeps the arrow pointing one way:
 * `JobsModule` is `@Global()` and the attendance module needs it, so a
 * `JobsModule` that imported this handler's module would close the cycle. It
 * also means this handler can live inside `modules/attendance/`, which
 * technical design §1 requires -- the service it drives is attendance's, and
 * `platform/` may never reach into a module.
 *
 * The idempotency this job needs is a property of the operation, not of the
 * handler: escalating a request sets `current_step_started_at` to now, so a
 * second run finds nothing stale and a run interrupted halfway leaves exactly
 * the unescalated requests selectable. No lock, no high-water mark, no "has
 * this run today" flag -- all of which are ways of making a non-idempotent
 * operation look idempotent.
 *
 * The payload carries only `requestedAt`, and the handler ignores it. A job
 * that sat in the queue through a retry must escalate what is stale *now*.
 */
@Injectable()
export class EscalateStaleApprovalsHandler
  implements JobHandler<'escalate-stale-approvals'>, OnModuleInit
{
  readonly jobName = 'escalate-stale-approvals' as const;

  constructor(
    private readonly approvals: ApprovalService,
    private readonly registry: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(
    _payload: JobPayloads['escalate-stale-approvals'],
    _context: JobContext,
  ): Promise<JobResult> {
    const outcome = await this.approvals.escalateStale(new Date());
    return {
      scanned: outcome.scanned,
      escalated: outcome.escalated,
      // Stale but with nobody above the current approver. Surfaced as a count
      // rather than logged and forgotten: a number that stays above zero means
      // somebody's reporting line has no top, and the request is stuck.
      exhausted: outcome.exhausted,
    };
  }
}
