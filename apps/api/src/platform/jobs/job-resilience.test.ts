import { ERROR_CODES } from '@vyuha/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';
import { AppError } from '../common/errors.js';
import { JobRunner } from './job-runner.service.js';
import { ENQUEUE_TIMEOUT_MS, QUEUES } from './queue.registry.js';

/**
 * What the API does when Redis stops answering.
 *
 * Every behaviour here was found on the running production build with Redis
 * behind a TCP proxy that was then killed -- absence proven with `lsof`, not
 * with a failed connect. The numbers in each test's comment are from that
 * session; the tests reproduce the *shape* of the failure deterministically,
 * because a suite that killed the shared Redis would take every other agent on
 * this machine down with it.
 *
 * The shape is precise, not approximate: BullMQ requires
 * `maxRetriesPerRequest: null` (`bull-connection.ts`), so a command issued
 * while Redis is unreachable does not fail -- it never settles. A promise that
 * never resolves is exactly that, and it is what `add` returned for 40 seconds
 * while `POST /auth/password-resets` held its connection open.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000f5';

let harness: ApiHarness;
let runner: JobRunner;

/** A promise with the one property that matters here: it never settles. */
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Vyuha Job Resilience');
  runner = harness.resolve(JobRunner);
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('enqueueing while Redis does not answer', () => {
  it('gives up inside the deadline instead of waiting for ever', async () => {
    const queue = runner.queueFor(QUEUES.NOTIFICATION);
    const add = vi.spyOn(queue, 'add').mockImplementation(() => neverSettles());

    try {
      const started = Date.now();
      const failure = await runner
        .enqueue('deliver-password-reset', {
          email: 'nobody@vyuha.test',
          ip: null,
          requestedAt: new Date().toISOString(),
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      const elapsed = Date.now() - started;

      expect(add).toHaveBeenCalledTimes(1);
      expect(failure).toBeInstanceOf(AppError);
      expect((failure as AppError).code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
      expect((failure as AppError).status).toBe(503);
      // Generous upper bound: the assertion is "bounded", not "fast". Before
      // the deadline existed this line was never reached at all.
      expect(elapsed).toBeLessThan(ENQUEUE_TIMEOUT_MS * 3);
    } finally {
      add.mockRestore();
    }
  }, 30_000);

  /**
   * REQ-B-04. The endpoint documents an unconditional 202 -- an address with an
   * account and one without must be indistinguishable in status, body *and*
   * clock -- and absorbs a failed enqueue to keep it. That absorption was
   * unreachable: measured on the production build, `curl -m 40` got HTTP 000
   * after 40.0s, and the "could not queue" line the catch writes appeared zero
   * times in the log. A contract that cannot fail cannot be kept.
   */
  it('still answers POST /auth/password-resets with 202', async () => {
    const queue = runner.queueFor(QUEUES.NOTIFICATION);
    const add = vi.spyOn(queue, 'add').mockImplementation(() => neverSettles());

    try {
      const started = Date.now();
      const result = await harness.post('/auth/password-resets', {
        body: { email: scopedEmail('reset.while.redis.down') },
      });
      const elapsed = Date.now() - started;

      expect(result.status).toBe(202);
      expect(elapsed).toBeLessThan(ENQUEUE_TIMEOUT_MS * 3);
    } finally {
      add.mockRestore();
    }
  }, 30_000);

  /**
   * The other request paths that await an enqueue -- the export request and
   * every leave decision -- have no catch of their own, so what reaches their
   * client is whatever `enqueue` throws. A retryable 503 with a `Retry-After`
   * is a caller's answer; a request that never returns is not, and neither is
   * a 500. Asserted on the error rather than through those endpoints so this
   * stays a statement about the queue layer.
   */
  it('refuses with a retryable code carrying a retry hint', async () => {
    const queue = runner.queueFor(QUEUES.EXPORT);
    const add = vi.spyOn(queue, 'add').mockImplementation(() => neverSettles());

    try {
      const failure = await runner
        .enqueue('generate-report-export', {
          orgId: ORG_ID,
          exportJobId: '01900000-0000-7000-8000-0000000000f6',
          requestedAt: new Date().toISOString(),
        })
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect((failure as AppError).details).toMatchObject({
        retryAfterSeconds: expect.any(Number),
        jobName: 'generate-report-export',
      });
    } finally {
      add.mockRestore();
    }
  }, 30_000);
});

describe('a queue that answers normally', () => {
  /**
   * The control. Every test above proves something about failure, and each of
   * them would also pass against a runner that had simply stopped working.
   */
  it('still enqueues against the real Redis', async () => {
    const jobId = await runner.enqueue('purge-expired-files', {
      requestedAt: new Date().toISOString(),
    });

    expect(jobId).not.toBe('');

    const job = await runner.queueFor(QUEUES.MAINTENANCE).getJob(jobId);
    expect(job?.name).toBe('purge-expired-files');
    await job?.remove();
  }, 30_000);
});
