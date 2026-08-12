import type { JobsOptions } from 'bullmq';

/**
 * The queue and job catalogue from technical design §11.
 *
 * Every queue in that table is declared here, including the ones whose jobs
 * arrive in later phases. Declaring them now costs nothing -- a queue is
 * created lazily on first use -- and means a Phase 1 job is a handler plus a
 * line in `JOB_QUEUE`, never a decision about which queue to invent.
 *
 * `JobPayloads` is what makes the runner typed end to end: `enqueue` accepts
 * exactly the payload its job declares, and a handler receives exactly that
 * type. There is no `Record<string, unknown>` crossing the boundary, which is
 * the usual way a queue turns into an untyped RPC channel.
 */

export const QUEUES = {
  ATTENDANCE: 'attendance',
  LEAVE: 'leave',
  EXPORT: 'export',
  NOTIFICATION: 'notification',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: readonly QueueName[] = Object.values(QUEUES);

/**
 * Payloads are plain JSON. They cross a process boundary and are stored in
 * Redis, so a `Date` would arrive as a string and a class instance as a bare
 * object -- ISO strings and ids only, and the handler reloads what it needs.
 */
export interface JobPayloads {
  /**
   * REQ-L-03. Subsumes §11's `purge-expired-photos` and `purge-expired-exports`:
   * both are rows in `files` with an `expires_at`, and two jobs running the
   * same query against the same table is two places for the retention rule to
   * drift.
   */
  'purge-expired-files': {
    /** Only for the trail. The handler always works from the current clock. */
    readonly requestedAt: string;
  };

  /** REQ-K-02: one queued envelope per domain event, fanned out by channel. */
  'send-notification': {
    readonly orgId: string;
    readonly eventType: string;
    readonly audience: unknown;
    readonly payload: Record<string, unknown>;
  };
}

export type JobName = keyof JobPayloads;

export const JOB_QUEUE: Record<JobName, QueueName> = {
  'purge-expired-files': QUEUES.MAINTENANCE,
  'send-notification': QUEUES.NOTIFICATION,
};

/**
 * "Failed jobs retry with backoff" (§11).
 *
 * Five attempts over roughly a minute: long enough to ride out a Redis
 * failover or a restarted MinIO, short enough that a genuinely broken job
 * reaches the failed set while whoever deployed it is still watching.
 *
 * Completed and failed jobs are retained by count rather than removed. The
 * admin job monitor reads the failed set directly, so removing failures would
 * delete the only durable record of them.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { count: 200, age: 7 * 24 * 60 * 60 },
  removeOnFail: { count: 500, age: 30 * 24 * 60 * 60 },
};

/**
 * Recurring work, as job schedulers. §11 puts the maintenance sweep on a
 * weekly cron; 03:00 on Sunday is chosen so a large purge runs when nobody is
 * punching.
 *
 * A scheduler is upserted by id, so restarting or redeploying does not create
 * a second one and changing the pattern here updates the existing entry.
 */
export interface ScheduledJob {
  readonly schedulerId: string;
  readonly jobName: JobName;
  /** Standard five-field cron, interpreted in the server's timezone. */
  readonly pattern: string;
}

export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  { schedulerId: 'maintenance:purge-expired-files', jobName: 'purge-expired-files', pattern: '0 3 * * 0' },
];
