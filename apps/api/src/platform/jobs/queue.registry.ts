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

  /**
   * REQ-J-03: "Exports run as background jobs and land in a Downloads tray."
   *
   * Only the id of the `export_jobs` row travels. The filters, the column
   * selection and the requester are all on that row already, and a payload
   * that repeated them would be a second copy able to disagree with the row
   * the tray is showing.
   */
  'generate-report-export': {
    readonly orgId: string;
    readonly exportJobId: string;
    /** Only for the trail; the handler works from the row and the current clock. */
    readonly requestedAt: string;
  };

  /**
   * REQ-G-09 / REQ-I-05: approvals nobody has touched for N days move up a
   * level. §11 lists it on the notification queue, next to `punch-reminders`.
   */
  'escalate-stale-approvals': {
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

  /**
   * REQ-G-05. Posts the accrual for one calendar month across every
   * organisation.
   *
   * `month` is optional and exists for a backfill: the scheduler never sets
   * it, so the routine run always accrues the month that has just finished --
   * a job retried three days late must still post March, not June.
   */
  'accrue-leave': {
    readonly requestedAt: string;
    /** `YYYY-MM`. Omitted means the month before `requestedAt`. */
    readonly month?: string;
  };

  /**
   * REQ-G-01's carry forward, at the leave year boundary. Runs daily and does
   * nothing on the days that are not one: the start month is per-organisation
   * (REQ-G-04), so no cron expression can name the date for everybody.
   */
  'carry-forward-leave': {
    readonly requestedAt: string;
  };

  /** REQ-G-11: lapse expired comp-off credits, and warn before they lapse. */
  'expire-comp-off': {
    readonly requestedAt: string;
  };
}

export type JobName = keyof JobPayloads;

export const JOB_QUEUE: Record<JobName, QueueName> = {
  'purge-expired-files': QUEUES.MAINTENANCE,
  'generate-report-export': QUEUES.EXPORT,
  'escalate-stale-approvals': QUEUES.NOTIFICATION,
  'send-notification': QUEUES.NOTIFICATION,
  'accrue-leave': QUEUES.LEAVE,
  'carry-forward-leave': QUEUES.LEAVE,
  'expire-comp-off': QUEUES.LEAVE,
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
  // Daily rather than weekly: REQ-G-09's threshold is measured in days, and a
  // weekly sweep would turn "escalate after 3 days" into "escalate after
  // somewhere between 3 and 10". 02:00 keeps it clear of the working day.
  { schedulerId: 'notification:escalate-stale-approvals', jobName: 'escalate-stale-approvals', pattern: '0 2 * * *' },
  // REQ-G-05. On the 1st, for the month that has just finished. Accruing on
  // the last day of a month instead would need a cron that can say "last day",
  // and would pro-rate a leaver's final month before their last day had ended.
  { schedulerId: 'leave:accrue', jobName: 'accrue-leave', pattern: '30 1 1 * *' },
  // REQ-G-01/G-04. Daily, because the leave year start month is per
  // organisation and the handler is the only thing that can know whose year
  // opened today. A day that is nobody's boundary costs one settings read.
  { schedulerId: 'leave:carry-forward', jobName: 'carry-forward-leave', pattern: '0 2 * * *' },
  // REQ-G-11. Daily, because the warnings are at 7 and 2 days and a weekly
  // sweep would miss the 2-day one entirely.
  { schedulerId: 'leave:expire-comp-off', jobName: 'expire-comp-off', pattern: '30 3 * * *' },
];
