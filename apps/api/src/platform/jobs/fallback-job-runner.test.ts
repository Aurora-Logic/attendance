import { uuidv7 } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { env } from '../common/env.js';
import { FallbackJobRunner } from './fallback-job-runner.service.js';
import { JobRegistry, type JobContext, type JobHandler, type JobResult } from './job-handler.js';
import { SCHEDULED_JOBS, type JobPayloads } from './queue.registry.js';

/**
 * The Postgres fallback job queue, exercised directly against a real
 * database (no Redis involved at all — this is the path a deployment with
 * no Redis at all uses for every recurring and enqueued job).
 *
 * Uses `purge-expired-files` as the stand-in job name throughout, matching
 * `job-resilience.test.ts`'s own convention — the point under test is the
 * queue mechanics, not any one handler's business logic, so a stub handler
 * for a real job name is enough.
 */

const pool = new Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool);

const insertedJobIds: string[] = [];

class StubHandler implements JobHandler<'purge-expired-files'> {
  readonly jobName = 'purge-expired-files';
  runCount = 0;
  shouldFail = false;

  run(_payload: JobPayloads['purge-expired-files'], _context: JobContext): Promise<JobResult> {
    this.runCount += 1;
    if (this.shouldFail) throw new Error('stub handler failure');
    return Promise.resolve({ ran: true });
  }
}

function newFallback(): { fallback: FallbackJobRunner; stub: StubHandler } {
  const registry = new JobRegistry();
  const stub = new StubHandler();
  registry.register(stub);
  return { fallback: new FallbackJobRunner(db, registry), stub };
}

async function rowFor(id: string): Promise<{ state: string; attempts: number; last_error: string | null } | undefined> {
  const rows = await db.execute<{ state: string; attempts: number; last_error: string | null }>(
    sql`SELECT state, attempts, last_error FROM fallback_jobs WHERE id = ${id}`,
  );
  return rows.rows[0];
}

afterEach(async () => {
  for (const id of insertedJobIds) {
    await db.execute(sql`DELETE FROM fallback_jobs WHERE id = ${id}`);
  }
  insertedJobIds.length = 0;
});

afterAll(async () => {
  await pool.end();
});

describe('FallbackJobRunner.enqueue + workerTick', () => {
  it('runs a job through the real JobRegistry seam and marks it done', async () => {
    const { fallback, stub } = newFallback();
    const id = await fallback.enqueue('purge-expired-files', { requestedAt: new Date().toISOString() });
    insertedJobIds.push(id);

    await fallback.workerTick();

    expect(stub.runCount).toBe(1);
    const row = await rowFor(id);
    expect(row?.state).toBe('DONE');
    expect(row?.attempts).toBe(1);
  });

  it('dedups by jobId the way BullMQ ignores a repeated add', async () => {
    const { fallback } = newFallback();
    const jobId = `test-${uuidv7()}`;

    const first = await fallback.enqueue('purge-expired-files', { requestedAt: new Date().toISOString() }, { jobId });
    const second = await fallback.enqueue('purge-expired-files', { requestedAt: new Date().toISOString() }, { jobId });
    insertedJobIds.push(first);

    expect(second).toBe(first);
    const rows = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM fallback_jobs WHERE external_job_id = ${jobId}`,
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it('requeues a failed attempt under the cap, with a future run_after', async () => {
    const { fallback, stub } = newFallback();
    stub.shouldFail = true;
    const id = await fallback.enqueue('purge-expired-files', { requestedAt: new Date().toISOString() });
    insertedJobIds.push(id);

    const before = Date.now();
    await fallback.workerTick();

    const row = await db.execute<{ state: string; attempts: number; run_after: string; last_error: string | null }>(
      sql`SELECT state, attempts, run_after, last_error FROM fallback_jobs WHERE id = ${id}`,
    );
    const claimed = row.rows[0];
    expect(claimed?.state).toBe('QUEUED');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.last_error).toContain('stub handler failure');
    // BullMQ's own formula: 2^(attemptsMade-1) * 2000ms; first failure is 2000ms out.
    expect(new Date(claimed?.run_after ?? 0).getTime()).toBeGreaterThan(before + 1_500);
  });

  it('fails permanently once attempts reach the cap', async () => {
    const { fallback, stub } = newFallback();
    stub.shouldFail = true;

    // Seeded one attempt below the cap (5), due immediately, rather than
    // waiting out four real exponential-backoff delays.
    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO fallback_jobs (job_name, payload, attempts) VALUES ('purge-expired-files', '{"requestedAt":"2026-01-01T00:00:00.000Z"}'::jsonb, 4) RETURNING id
    `);
    const id = inserted.rows[0]?.id;
    if (id === undefined) throw new Error('seed insert returned no row');
    insertedJobIds.push(id);

    await fallback.workerTick();

    const row = await rowFor(id);
    expect(row?.state).toBe('FAILED');
    expect(row?.attempts).toBe(5);
  });

  it('hands an abandoned claim back to the queue', async () => {
    const { fallback } = newFallback();
    const id = await fallback.enqueue('purge-expired-files', { requestedAt: new Date().toISOString() });
    insertedJobIds.push(id);

    await db.execute(sql`
      UPDATE fallback_jobs SET state = 'CLAIMED', claimed_by = 'stale-test', claimed_at = ${new Date(Date.now() - 10 * 60 * 1000)}
       WHERE id = ${id}
    `);

    await fallback.workerTick();

    const row = await rowFor(id);
    // Requeued, then immediately reclaimed and run by the same tick.
    expect(row?.state).toBe('DONE');
  });
});

describe('FallbackJobRunner.activate', () => {
  it('seeds a schedule row per SCHEDULED_JOBS entry with a future next_run_at', async () => {
    const { fallback } = newFallback();
    try {
      await fallback.activate();

      const rows = await db.execute<{ scheduler_id: string; next_run_at: string }>(
        sql`SELECT scheduler_id, next_run_at FROM fallback_job_schedules`,
      );
      const bySchedulerId = new Map(rows.rows.map((r) => [r.scheduler_id, r]));
      for (const scheduled of SCHEDULED_JOBS) {
        const row = bySchedulerId.get(scheduled.schedulerId);
        expect(row, `missing schedule row for ${scheduled.schedulerId}`).toBeDefined();
        expect(new Date(row?.next_run_at ?? 0).getTime()).toBeGreaterThan(Date.now());
      }
    } finally {
      // Stops the timers `activate()` started, so this test does not keep
      // the process alive waiting for a 30s/5s/1h tick that nothing asserts on.
      fallback.onApplicationShutdown();
    }
  });
});
