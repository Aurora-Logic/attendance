import { uuidv7 } from '@vyuha/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../common/errors.js';
import { redisTarget } from '../redis/redis.provider.js';
import { LoginRateLimiter, loginRateLimitKey } from './login-rate-limit.service.js';

/**
 * Against real Redis, and the two properties under test are the two the
 * in-memory version could not have (docs OPEN-QUESTIONS P0-11): the count
 * survives the process, and two processes share it.
 *
 * Both are checked by constructing a *second* limiter over a *second* client.
 * That is not a stand-in for a restart -- it is exactly what a restart and a
 * second instance look like from Redis's side, which is a fresh connection
 * finding the state already there.
 */

const MAX_FAILURES_PER_IP = 20;

const target = redisTarget();
const clientOptions = { host: target.host, port: target.port, maxRetriesPerRequest: 2 };

const clients: Redis[] = [];

function newLimiter(): LoginRateLimiter {
  const client = new Redis(clientOptions);
  client.on('error', () => {
    // Surfaced by the assertion that follows; an unhandled 'error' event would
    // take the test runner down instead.
  });
  clients.push(client);
  return new LoginRateLimiter(client);
}

let limiter: LoginRateLimiter;
let ip: string;

beforeEach(() => {
  limiter = newLimiter();
  // A fresh address per test, so nothing here depends on cleanup running and
  // no test can spend another test's budget.
  ip = `203.0.113.${String(Math.floor(Math.random() * 200) + 1)}-${uuidv7()}`;
});

afterAll(async () => {
  const cleanup = new Redis(clientOptions);
  const keys = await cleanup.keys(`${loginRateLimitKey('203.0.113.')}*`);
  if (keys.length > 0) await cleanup.del(...keys);
  await cleanup.quit();
  await Promise.all(clients.map((client) => client.quit().catch(() => client.disconnect())));
});

async function code(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return 'no-error';
}

describe('per-IP failed login budget', () => {
  it('allows the budget and refuses the attempt after it', async () => {
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) {
      await limiter.assertWithinBudget(ip);
      await limiter.recordFailure(ip);
    }

    expect(await code(() => limiter.assertWithinBudget(ip))).toBe('RATE_LIMITED');
  });

  it('does not refuse one attempt short of the budget', async () => {
    // The control. Without it the test above would also pass for a limiter
    // that refused after a single failure.
    for (let i = 0; i < MAX_FAILURES_PER_IP - 1; i += 1) await limiter.recordFailure(ip);
    await expect(limiter.assertWithinBudget(ip)).resolves.toBeUndefined();
  });

  it('survives the process that recorded the failures', async () => {
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) await limiter.recordFailure(ip);

    // A different limiter over a different connection: what the next instance,
    // or this one after a deploy, sees.
    const afterRestart = newLimiter();
    expect(await code(() => afterRestart.assertWithinBudget(ip))).toBe('RATE_LIMITED');
  });

  it('shares one budget between two instances rather than one each', async () => {
    const instanceA = newLimiter();
    const instanceB = newLimiter();

    // Split across the two, which under the old in-process limiter would have
    // been ten each and well inside a per-instance budget of twenty.
    for (let i = 0; i < MAX_FAILURES_PER_IP / 2; i += 1) {
      await instanceA.recordFailure(ip);
      await instanceB.recordFailure(ip);
    }

    expect(await code(() => instanceA.assertWithinBudget(ip))).toBe('RATE_LIMITED');
    expect(await code(() => instanceB.assertWithinBudget(ip))).toBe('RATE_LIMITED');
  });

  it('slides: failures older than the window stop counting', async () => {
    const now = Date.now();
    const beforeTheWindow = now - 16 * 60 * 1000;

    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) {
      await limiter.recordFailure(ip, beforeTheWindow + i);
    }
    await expect(limiter.assertWithinBudget(ip, now)).resolves.toBeUndefined();

    // ...and the same failures do count while they are still inside it.
    const fresh = `${ip}-fresh`;
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) {
      await limiter.recordFailure(fresh, now - 60_000 + i);
    }
    expect(await code(() => limiter.assertWithinBudget(fresh, now))).toBe('RATE_LIMITED');
  });

  it('reports how long the caller must wait', async () => {
    const now = Date.now();
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) {
      await limiter.recordFailure(ip, now - 60_000 + i);
    }

    const error = await limiter.assertWithinBudget(ip, now).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    const retryAfter = (error as AppError).details?.retryAfterSeconds;
    // Fourteen minutes give or take: the oldest failure was a minute ago.
    expect(typeof retryAfter).toBe('number');
    expect(retryAfter).toBeGreaterThan(13 * 60);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
  });

  it('clears the address on a successful sign-in', async () => {
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) await limiter.recordFailure(ip);
    expect(await code(() => limiter.assertWithinBudget(ip))).toBe('RATE_LIMITED');

    await limiter.clear(ip);
    await expect(limiter.assertWithinBudget(ip)).resolves.toBeUndefined();
  });

  it('expires the key so a quiet address costs nothing to remember', async () => {
    await limiter.recordFailure(ip);

    const inspector = new Redis(clientOptions);
    const ttl = await inspector.pttl(loginRateLimitKey(ip));
    await inspector.quit();

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('counts a failure only once per attempt, even within one millisecond', async () => {
    const now = Date.now();
    // A sorted set deduplicates by member, so a naive implementation using the
    // timestamp as the member would collapse a burst into a single failure --
    // which is precisely the burst a limiter exists to stop.
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) await limiter.recordFailure(ip, now);

    expect(await code(() => limiter.assertWithinBudget(ip, now))).toBe('RATE_LIMITED');
  });

  it('does nothing at all when there is no address to attribute', async () => {
    await expect(limiter.assertWithinBudget(null)).resolves.toBeUndefined();
    await expect(limiter.recordFailure(null)).resolves.toBeUndefined();
    await expect(limiter.clear(null)).resolves.toBeUndefined();
  });

  it('fails open, not closed, when Redis cannot be reached', async () => {
    // Port 1: nothing listens, so every command errors. Failing closed here
    // would mean a Redis outage stops the whole company signing in, while the
    // per-account lockout in Postgres is untouched either way.
    const offline = new Redis({
      ...clientOptions,
      host: '127.0.0.1',
      port: 1,
      maxRetriesPerRequest: 1,
      connectTimeout: 200,
    });
    offline.on('error', () => {
      // Expected; the assertions below are the report.
    });
    const stranded = new LoginRateLimiter(offline);

    await expect(stranded.recordFailure('198.51.100.7')).resolves.toBeUndefined();
    await expect(stranded.assertWithinBudget('198.51.100.7')).resolves.toBeUndefined();

    offline.disconnect();
  });
});
