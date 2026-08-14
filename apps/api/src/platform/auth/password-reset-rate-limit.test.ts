import { uuidv7 } from '@vyuha/shared';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { redisTarget } from '../redis/redis.provider.js';
import {
  PasswordResetRateLimiter,
  passwordResetEmailKey,
  passwordResetIpKey,
} from './password-reset-rate-limit.service.js';

/**
 * Against real Redis, mirroring `login-rate-limit.test.ts`. The property that
 * matters most here is the one the endpoint cannot show from outside: a
 * refused acquire is invisible to the caller (the 202 is asserted in
 * `auth.endpoints.test.ts`), so this file proves the window arithmetic and
 * the fail-open direction on the limiter itself.
 *
 * Every sequential test below passed while the limiter was defeated by adding
 * `&` to the attacker's loop, which is why the concurrent ones exist: a
 * check-then-act limiter gives its whole budget to every request already in
 * flight, so `Promise.all` is the only shape that can see the defect.
 */

const MAX_PER_EMAIL = 3;
const MAX_PER_IP = 20;

const target = redisTarget();
const clientOptions = { host: target.host, port: target.port, maxRetriesPerRequest: 2 };

const clients: Redis[] = [];

function newLimiter(): PasswordResetRateLimiter {
  const client = new Redis(clientOptions);
  client.on('error', () => {
    // Surfaced by the assertion that follows; an unhandled 'error' event would
    // take the test runner down instead.
  });
  clients.push(client);
  return new PasswordResetRateLimiter(client);
}

let limiter: PasswordResetRateLimiter;
let email: string;
let ip: string;

beforeEach(() => {
  limiter = newLimiter();
  // Fresh subjects per test, so nothing depends on cleanup and no test can
  // spend another test's budget.
  email = `reset-probe-${uuidv7()}@vyuha.test`;
  ip = `203.0.113.${String(Math.floor(Math.random() * 200) + 1)}-${uuidv7()}`;
});

afterAll(async () => {
  const cleanup = new Redis(clientOptions);
  const keys = [
    ...(await cleanup.keys(`${passwordResetEmailKey('reset-probe-')}*`)),
    ...(await cleanup.keys(`${passwordResetIpKey('203.0.113.')}*`)),
  ];
  if (keys.length > 0) await cleanup.del(...keys);
  await cleanup.quit();
  await Promise.all(clients.map((client) => client.quit().catch(() => client.disconnect())));
});

describe('per-address and per-IP password reset budget', () => {
  it('allows the per-address budget and refuses the request after it', async () => {
    for (let i = 0; i < MAX_PER_EMAIL; i += 1) {
      expect(await limiter.tryAcquire(email, ip)).toBe(true);
    }
    expect(await limiter.tryAcquire(email, ip)).toBe(false);
  });

  it('does not refuse one request short of the budget', async () => {
    // The control: without it the test above would also pass for a limiter
    // that refused after a single request.
    for (let i = 0; i < MAX_PER_EMAIL - 1; i += 1) {
      expect(await limiter.tryAcquire(email, ip)).toBe(true);
    }
  });

  it('holds the per-address cap when the whole burst is in flight together', async () => {
    // The regression for the mailbox-bombing defect. Measured against the
    // booted production API before the fix: a sequential burst of twenty-five
    // to one address sent three emails, a concurrent burst of twenty-five sent
    // eight, and a hundred sent fifty-nine -- against a cap of three.
    const burst = 100;
    const granted = await Promise.all(
      Array.from({ length: burst }, () => limiter.tryAcquire(email, ip)),
    );

    expect(granted.filter(Boolean).length).toBe(MAX_PER_EMAIL);

    // The set records what it allowed, rather than recording everything after
    // letting it through -- which is what the two-round-trip version did.
    const inspector = new Redis(clientOptions);
    const members = await inspector.zcard(passwordResetEmailKey(email));
    await inspector.quit();
    expect(members).toBe(MAX_PER_EMAIL);
  });

  it('holds the per-IP cap when the whole burst is in flight together', async () => {
    // One address per request, so only the IP window can refuse any of them.
    const burst = 60;
    const granted = await Promise.all(
      Array.from({ length: burst }, (_unused, i) =>
        limiter.tryAcquire(`burst-${String(i)}-${email}`, ip),
      ),
    );

    expect(granted.filter(Boolean).length).toBe(MAX_PER_IP);
  });

  it('holds the cap when the burst is spread across instances', async () => {
    // Two limiters over two connections: what two API processes behind a load
    // balancer look like from Redis's side.
    const instanceA = newLimiter();
    const instanceB = newLimiter();

    const granted = await Promise.all(
      Array.from({ length: 40 }, (_unused, i) =>
        (i % 2 === 0 ? instanceA : instanceB).tryAcquire(email, ip),
      ),
    );

    expect(granted.filter(Boolean).length).toBe(MAX_PER_EMAIL);
  });

  it('does not spend the address budget on a request the IP budget refused', async () => {
    // The two caps are independent, and a burst that exhausts one must not
    // quietly consume the other -- otherwise one noisy office would use up
    // every mailbox's budget without a single email being sent.
    const spender = `spender-${email}`;
    for (let i = 0; i < MAX_PER_IP; i += 1) {
      expect(await limiter.tryAcquire(`${String(i)}-${spender}`, ip)).toBe(true);
    }

    const victim = `victim-${email}`;
    expect(await limiter.tryAcquire(victim, ip)).toBe(false);

    const inspector = new Redis(clientOptions);
    const members = await inspector.zcard(passwordResetEmailKey(victim));
    await inspector.quit();
    expect(members).toBe(0);
  });

  it('keys the address case-insensitively, matching the account lookup', async () => {
    for (let i = 0; i < MAX_PER_EMAIL; i += 1) {
      await limiter.tryAcquire(email.toUpperCase(), ip);
    }
    expect(await limiter.tryAcquire(email, ip)).toBe(false);
  });

  it('spends the per-IP budget across many addresses', async () => {
    for (let i = 0; i < MAX_PER_IP; i += 1) {
      expect(await limiter.tryAcquire(`spray-${String(i)}-${email}`, ip)).toBe(true);
    }
    // A fresh address from the same place: the IP window is what refuses it.
    expect(await limiter.tryAcquire(`fresh-${email}`, ip)).toBe(false);
  });

  it('counts a request with no attributable IP against the address alone', async () => {
    for (let i = 0; i < MAX_PER_EMAIL; i += 1) {
      expect(await limiter.tryAcquire(email, null)).toBe(true);
    }
    expect(await limiter.tryAcquire(email, null)).toBe(false);
  });

  it('slides: requests older than the window stop counting', async () => {
    const now = Date.now();
    const beforeTheWindow = now - 61 * 60 * 1000;

    for (let i = 0; i < MAX_PER_EMAIL; i += 1) {
      await limiter.tryAcquire(email, ip, beforeTheWindow + i);
    }
    expect(await limiter.tryAcquire(email, ip, now)).toBe(true);
  });

  it('expires the keys so a quiet subject costs nothing to remember', async () => {
    await limiter.tryAcquire(email, ip);

    const inspector = new Redis(clientOptions);
    const emailTtl = await inspector.pttl(passwordResetEmailKey(email));
    const ipTtl = await inspector.pttl(passwordResetIpKey(ip));
    await inspector.quit();

    expect(emailTtl).toBeGreaterThan(0);
    expect(emailTtl).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(ipTtl).toBeGreaterThan(0);
    expect(ipTtl).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('fails open, not closed, when Redis cannot be reached', async () => {
    // Port 1: nothing listens, so every command errors. Failing closed would
    // mean a Redis outage stops anyone resetting a forgotten password; the
    // per-account login lockout in Postgres is untouched either way.
    const offline = new Redis({
      ...clientOptions,
      host: '127.0.0.1',
      port: 1,
      maxRetriesPerRequest: 1,
      connectTimeout: 200,
    });
    offline.on('error', () => {
      // Expected; the assertion below is the report.
    });
    const stranded = new PasswordResetRateLimiter(offline);

    expect(await stranded.tryAcquire('stranded@vyuha.test', '198.51.100.7')).toBe(true);

    offline.disconnect();
  });
});
