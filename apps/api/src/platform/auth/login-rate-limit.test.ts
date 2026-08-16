import { uuidv7 } from '@vyuha/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../common/errors.js';
import { redisTarget } from '../redis/redis.provider.js';
import { LoginRateLimiter, loginRateLimitKey } from './login-rate-limit.service.js';

/**
 * Against real Redis, and three properties the implementation cannot fake: the
 * count survives the process, two processes share it (docs OPEN-QUESTIONS
 * P0-11), and the cap holds when the attempts arrive *together*.
 *
 * The first two are checked by constructing a *second* limiter over a *second*
 * client. That is not a stand-in for a restart -- it is exactly what a restart
 * and a second instance look like from Redis's side, which is a fresh
 * connection finding the state already there.
 *
 * The third is the one that matters most and the one every sequential test
 * here passed while it was broken. A check-then-act limiter allows its whole
 * budget to every request that is already in flight, so `Promise.all` is not a
 * stress test, it is the test.
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
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) await limiter.claimAttempt(ip);

    expect(await code(() => limiter.claimAttempt(ip))).toBe('RATE_LIMITED');
  });

  it('does not refuse one attempt short of the budget', async () => {
    // The control. Without it the test above would also pass for a limiter
    // that refused after a single failure.
    for (let i = 0; i < MAX_FAILURES_PER_IP - 1; i += 1) await limiter.claimAttempt(ip);
    await expect(limiter.claimAttempt(ip)).resolves.not.toBeNull();
  });

  it('holds the cap when the whole burst is in flight together', async () => {
    // The regression for the defect this class was rewritten for. Against the
    // check-then-act version -- ZCARD, decide in Node, ZADD on a second round
    // trip -- all hundred of these read a count of zero and all hundred were
    // allowed. Measured against the booted API before the fix: sixty
    // concurrent wrong passwords, sixty 401s, not one 429, and sixty members
    // left in the window against a cap of twenty.
    const burst = 100;
    const outcomes = await Promise.all(
      Array.from({ length: burst }, () => code(() => limiter.claimAttempt(ip))),
    );

    const allowed = outcomes.filter((outcome) => outcome === 'no-error').length;
    const refused = outcomes.filter((outcome) => outcome === 'RATE_LIMITED').length;

    expect(allowed).toBe(MAX_FAILURES_PER_IP);
    expect(refused).toBe(burst - MAX_FAILURES_PER_IP);

    // And the window records exactly what it allowed, rather than recording
    // everything it let through.
    const inspector = new Redis(clientOptions);
    const members = await inspector.zcard(loginRateLimitKey(ip));
    await inspector.quit();
    expect(members).toBe(MAX_FAILURES_PER_IP);
  });

  it('holds the cap when the burst is spread across instances', async () => {
    // The same burst, but split between two limiters over two connections --
    // what two API processes behind a load balancer look like from Redis.
    const instanceA = newLimiter();
    const instanceB = newLimiter();
    const burst = 60;

    const outcomes = await Promise.all(
      Array.from({ length: burst }, (_unused, i) =>
        code(() => (i % 2 === 0 ? instanceA : instanceB).claimAttempt(ip)),
      ),
    );

    expect(outcomes.filter((outcome) => outcome === 'no-error').length).toBe(MAX_FAILURES_PER_IP);
  });

  it('survives the process that recorded the failures', async () => {
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) await limiter.claimAttempt(ip);

    // A different limiter over a different connection: what the next instance,
    // or this one after a deploy, sees.
    const afterRestart = newLimiter();
    expect(await code(() => afterRestart.claimAttempt(ip))).toBe('RATE_LIMITED');
  });

  it('shares one budget between two instances rather than one each', async () => {
    const instanceA = newLimiter();
    const instanceB = newLimiter();

    // Split across the two, which under the old in-process limiter would have
    // been ten each and well inside a per-instance budget of twenty.
    for (let i = 0; i < MAX_FAILURES_PER_IP / 2; i += 1) {
      await instanceA.claimAttempt(ip);
      await instanceB.claimAttempt(ip);
    }

    expect(await code(() => instanceA.claimAttempt(ip))).toBe('RATE_LIMITED');
    expect(await code(() => instanceB.claimAttempt(ip))).toBe('RATE_LIMITED');
  });

  it('gives the slot back when the attempt was not a failed sign-in', async () => {
    // A database blip must not spend the office's budget on requests that
    // never tested a password.
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) {
      const claim = await limiter.claimAttempt(ip);
      await limiter.release(claim);
    }

    await expect(limiter.claimAttempt(ip)).resolves.not.toBeNull();
  });

  it('releases only the attempt that claimed it', async () => {
    const kept = await limiter.claimAttempt(ip);
    const given = await limiter.claimAttempt(ip);
    await limiter.release(given);

    const inspector = new Redis(clientOptions);
    const members = await inspector.zrange(loginRateLimitKey(ip), '0', '-1');
    await inspector.quit();

    expect(members).toEqual([kept?.member]);
  });

  it('slides: failures older than the window stop counting', async () => {
    const now = Date.now();
    const beforeTheWindow = now - 16 * 60 * 1000;

    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) {
      await limiter.claimAttempt(ip, beforeTheWindow + i);
    }
    await expect(limiter.claimAttempt(ip, now)).resolves.not.toBeNull();

    // ...and the same failures do count while they are still inside it.
    const fresh = `${ip}-fresh`;
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) {
      await limiter.claimAttempt(fresh, now - 60_000 + i);
    }
    expect(await code(() => limiter.claimAttempt(fresh, now))).toBe('RATE_LIMITED');
  });

  it('reports how long the caller must wait', async () => {
    const now = Date.now();
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) {
      await limiter.claimAttempt(ip, now - 60_000 + i);
    }

    const error = await limiter.claimAttempt(ip, now).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    const retryAfter = (error as AppError).details?.retryAfterSeconds;
    // Fourteen minutes give or take: the oldest failure was a minute ago.
    expect(typeof retryAfter).toBe('number');
    expect(retryAfter).toBeGreaterThan(13 * 60);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
  });

  it('clears the address on a successful sign-in', async () => {
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) await limiter.claimAttempt(ip);
    expect(await code(() => limiter.claimAttempt(ip))).toBe('RATE_LIMITED');

    await limiter.clear(ip);
    await expect(limiter.claimAttempt(ip)).resolves.not.toBeNull();
  });

  it('expires the key so a quiet address costs nothing to remember', async () => {
    await limiter.claimAttempt(ip);

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
    for (let i = 0; i < MAX_FAILURES_PER_IP; i += 1) await limiter.claimAttempt(ip, now);

    expect(await code(() => limiter.claimAttempt(ip, now))).toBe('RATE_LIMITED');
  });

  it('does nothing at all when there is no address to attribute', async () => {
    await expect(limiter.claimAttempt(null)).resolves.toBeNull();
    await expect(limiter.release(null)).resolves.toBeUndefined();
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

    await expect(stranded.claimAttempt('198.51.100.7')).resolves.toBeNull();
    await expect(stranded.release({ ip: '198.51.100.7', member: 'x', scope: 'login' })).resolves.toBeUndefined();

    offline.disconnect();
  });
});
