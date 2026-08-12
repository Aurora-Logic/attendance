import { Injectable, Logger } from '@nestjs/common';

import type { JobName, JobPayloads } from './queue.registry.js';

/**
 * What a job does, and how it says so.
 *
 * The result is returned rather than logged, and BullMQ stores it on the job.
 * That is what makes "prove the second run was a no-op" answerable from the
 * outside: the counts are on the job record, not in a log line somebody has to
 * go and find.
 */

export type JobResult = Record<string, number | string | boolean | null>;

export interface JobContext {
  readonly jobId: string;
  /** 1 on the first try. A handler can log differently on a retry. */
  readonly attempt: number;
}

export interface JobHandler<TName extends JobName = JobName> {
  readonly jobName: TName;
  run(payload: JobPayloads[TName], context: JobContext): Promise<JobResult>;
}

/**
 * Handlers register themselves here during `onModuleInit`; `JobRunner` reads
 * the registry during `onApplicationBootstrap`, which Nest runs afterwards.
 *
 * The indirection buys a one-way dependency. If `JobsModule` imported each
 * handler's module instead, then the notification module -- which both
 * provides a handler and needs `JobRunner` to enqueue -- would form a cycle,
 * and the usual fix for that (`forwardRef`) hides the cycle rather than
 * removing it. Here the arrow only ever points at `JobsModule`.
 */
@Injectable()
export class JobRegistry {
  private readonly logger = new Logger(JobRegistry.name);
  private readonly handlers = new Map<JobName, JobHandler>();

  register<TName extends JobName>(handler: JobHandler<TName>): void {
    if (this.handlers.has(handler.jobName)) {
      // Two handlers for one job name means one of them silently never runs,
      // and which one would depend on module initialisation order.
      throw new Error(`Job "${handler.jobName}" already has a handler registered.`);
    }
    this.handlers.set(handler.jobName, handler);
    this.logger.log({ msg: `Job handler registered: ${handler.jobName}` });
  }

  get(jobName: string): JobHandler | null {
    return this.handlers.get(jobName as JobName) ?? null;
  }

  registeredJobNames(): readonly JobName[] {
    return [...this.handlers.keys()];
  }
}
