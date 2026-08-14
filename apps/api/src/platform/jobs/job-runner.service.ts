import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ERROR_CODES } from '@vyuha/shared';
import { Job, Queue, Worker, type JobsOptions } from 'bullmq';

import { env } from '../common/env.js';
import { AppError, describeError } from '../common/errors.js';
import { bullConnectionOptions } from './bull-connection.js';
import { JobRegistry, type JobResult } from './job-handler.js';
import {
  DEFAULT_JOB_OPTIONS,
  ENQUEUE_TIMEOUT_MS,
  JOB_QUEUE,
  SCHEDULED_JOBS,
  type JobName,
  type JobPayloads,
  type QueueName,
} from './queue.registry.js';

/**
 * Technical design §11. Producers and consumers in one place, because the
 * thing worth getting right is that they agree about names and payloads.
 *
 * The producer side is always wired: an API instance must be able to enqueue.
 * The consumer side is behind `JOBS_WORKER_ENABLED`, so a deployment can run
 * web and worker processes separately without a second entry point.
 *
 * Queues are created on first use rather than up front. Five idle queues would
 * be five idle Redis connections in every test process and every web instance,
 * for queues whose first job arrives in Phase 3.
 */

/**
 * What a client is told to wait before retrying a refused enqueue. Short: the
 * failure this reports is a cache blip, not a maintenance window, and the
 * offline punch queue drains on its own triggers anyway.
 */
const RETRY_AFTER_SECONDS = 5;

export interface EnqueueOptions {
  /**
   * Deduplicates. BullMQ ignores an `add` whose id already exists, including
   * for a job still retained after completing, so a caller that cannot tell
   * whether it already enqueued something can simply enqueue it again.
   */
  readonly jobId?: string;
  readonly delayMs?: number;
  readonly attempts?: number;
  readonly backoff?: JobsOptions['backoff'];
}

@Injectable()
export class JobRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobRunner.name);
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers = new Map<QueueName, Worker>();

  constructor(private readonly registry: JobRegistry) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.installSchedules();

    if (!env.JOBS_WORKER_ENABLED) {
      this.logger.log({
        msg: 'JOBS_WORKER_ENABLED is false; this process enqueues but does not consume.',
      });
      return;
    }

    this.startWorkers();
  }

  // -------------------------------------------------------------- producer

  queueFor(name: QueueName): Queue {
    const existing = this.queues.get(name);
    if (existing !== undefined) return existing;

    const queue = new Queue(name, {
      connection: bullConnectionOptions(),
      prefix: env.JOBS_QUEUE_PREFIX,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.queues.set(name, queue);
    return queue;
  }

  /**
   * Hands a job to Redis, or gives up.
   *
   * The bound is the point. Every caller of this method is on a request path,
   * and BullMQ's connection retries a command forever by contract
   * (`bull-connection.ts`), so without it a Redis outage does not make an
   * enqueue fail -- it makes the request that asked for it never answer, while
   * holding its connection open. `SERVICE_UNAVAILABLE` rather than a bare
   * `Error` because that is a decision the caller can act on: absorb it and
   * keep an unconditional promise the way `requestPasswordReset` does, or let
   * it reach the client as a retryable 503.
   *
   * The abandoned `add` is not cancellable -- Redis may still accept the job
   * when it comes back -- so the message says the request was not accepted
   * rather than that nothing will happen.
   */
  async enqueue<TName extends JobName>(
    jobName: TName,
    payload: JobPayloads[TName],
    options: EnqueueOptions = {},
  ): Promise<string> {
    const job = await this.withinDeadline(
      this.queueFor(JOB_QUEUE[jobName]).add(jobName, payload, {
        ...(options.jobId === undefined ? {} : { jobId: options.jobId }),
        ...(options.delayMs === undefined ? {} : { delay: options.delayMs }),
        ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
        ...(options.backoff === undefined ? {} : { backoff: options.backoff }),
      }),
      ENQUEUE_TIMEOUT_MS,
      () =>
        new AppError(
          ERROR_CODES.SERVICE_UNAVAILABLE,
          'Background work could not be queued just now. Try again shortly.',
          {
            details: { retryAfterSeconds: RETRY_AFTER_SECONDS, jobName },
          },
        ),
    );

    // BullMQ types `id` as optional because a job added to a flow may not have
    // one yet. A plain `add` always does.
    return job.id ?? '';
  }

  /**
   * Rejects with `onTimeout()` if `work` has not settled in `timeoutMs`.
   *
   * The timer is cleared either way, and the losing promise's rejection is
   * swallowed rather than left to become an unhandled rejection -- an
   * abandoned BullMQ command does eventually reject, minutes later, long after
   * anybody cared.
   */
  private async withinDeadline<T>(
    work: Promise<T>,
    timeoutMs: number,
    onTimeout: () => Error,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(onTimeout());
      }, timeoutMs);
    });

    work.catch(() => undefined);

    try {
      return await Promise.race([work, expiry]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Registers the recurring work from `SCHEDULED_JOBS`. Upsert by id, so
   * restarting does not stack duplicates and editing the pattern updates the
   * existing scheduler instead of leaving the old one firing too.
   */
  private async installSchedules(): Promise<void> {
    for (const scheduled of SCHEDULED_JOBS) {
      if (this.registry.get(scheduled.jobName) === null) {
        // A schedule with no handler would enqueue jobs nothing consumes,
        // which fills the queue and looks like a backlog.
        this.logger.warn({
          msg: `Skipping schedule "${scheduled.schedulerId}": no handler is registered for ${scheduled.jobName}.`,
        });
        continue;
      }

      await this.queueFor(JOB_QUEUE[scheduled.jobName]).upsertJobScheduler(
        scheduled.schedulerId,
        { pattern: scheduled.pattern },
        { name: scheduled.jobName, data: { requestedAt: new Date().toISOString() } },
      );
    }
  }

  // -------------------------------------------------------------- consumer

  /**
   * Public so a test can start the same workers the bootstrap hook starts,
   * rather than building a parallel set that could drift from this one.
   * Idempotent.
   */
  startWorkers(): void {
    const queuesWithHandlers = new Set(
      this.registry.registeredJobNames().map((jobName) => JOB_QUEUE[jobName]),
    );

    for (const queueName of queuesWithHandlers) {
      if (this.workers.has(queueName)) continue;

      // Same prefix as the producer, necessarily: a worker reading a different
      // namespace is a worker that never sees the job and never says so.
      const worker = new Worker(queueName, (job: Job) => this.process(job), {
        connection: bullConnectionOptions(),
        prefix: env.JOBS_QUEUE_PREFIX,
        concurrency: 2,
      });

      worker.on('failed', (job: Job | undefined, error: Error) => {
        const attempts = job?.opts.attempts ?? DEFAULT_JOB_OPTIONS.attempts ?? 1;
        const made = job?.attemptsMade ?? 0;
        const final = made >= attempts;

        // Two levels on purpose. A retryable failure is noise at error level
        // and would train an operator to ignore the channel; the final one is
        // the job giving up, and that is what the monitor surfaces.
        this.logger[final ? 'error' : 'warn']({
          msg: final
            ? 'Job failed permanently and is now in the failed set.'
            : 'Job attempt failed; it will be retried.',
          queue: queueName,
          jobName: job?.name,
          jobId: job?.id,
          attempt: made,
          of: attempts,
          reason: describeError(error),
        });
      });

      worker.on('error', (error: Error) => {
        // Connection-level trouble, not a job failing. Without a listener
        // BullMQ's EventEmitter would make this an unhandled error.
        this.logger.error({
          msg: 'Job worker error.',
          queue: queueName,
          reason: describeError(error),
        });
      });

      this.workers.set(queueName, worker);
      this.logger.log({ msg: `Job worker started for queue "${queueName}".` });
    }
  }

  /**
   * The dispatch a worker performs. Separated so the failure modes are visible
   * in one place: an unknown job name is a deployment mismatch and must not be
   * retried into oblivion, and a handler's own error is rethrown untouched so
   * BullMQ applies the backoff.
   */
  async process(job: Job): Promise<JobResult> {
    const handler = this.registry.get(job.name);

    if (handler === null) {
      // Reachable when an old instance still holds jobs a new deployment no
      // longer knows about, or the reverse. Failing loudly beats discarding.
      throw new Error(
        `No handler is registered for job "${job.name}". ` +
          'A queued job outlived the code that understood it.',
      );
    }

    const started = Date.now();
    // The payload was validated by the type system at the enqueue site and has
    // round-tripped through JSON since. The handler treats it as its declared
    // shape, which is the same contract every BullMQ consumer has.
    const payload = job.data as JobPayloads[JobName];

    const result = await handler.run(payload, {
      jobId: job.id ?? 'unknown',
      attempt: job.attemptsMade + 1,
    });

    this.logger.log({
      msg: 'Job completed',
      jobName: job.name,
      jobId: job.id,
      elapsedMs: Date.now() - started,
      ...result,
    });

    return result;
  }

  // -------------------------------------------------------------- shutdown

  async onApplicationShutdown(): Promise<void> {
    // Workers first: a worker closed after its queue would keep trying to read
    // from a connection that is already going away.
    await Promise.all([...this.workers.values()].map((worker) => worker.close()));
    this.workers.clear();

    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }
}
