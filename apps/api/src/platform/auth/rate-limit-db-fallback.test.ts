import { uuidv7 } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { env } from '../common/env.js';
import { RATE_LIMIT_FALLBACK_LOCK_NAMESPACE, RateLimitDbFallback } from './rate-limit-db-fallback.service.js';

/**
 * The Postgres fallback path, exercised directly (no Redis involved at all).
 *
 * Mirrors `login-rate-limit.test.ts`'s own reason for existing: the property
 * that matters is what a check-then-act limiter cannot survive -- a burst of
 * concurrent requests all reading the same stale count and all passing. The
 * advisory-lock retry loop is what `tryAcquire`/`tryAcquirePair` use instead
 * of the Lua script's atomicity; this file is the direct regression test for
 * it.
 */

const pool = new Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool);
const fallback = new RateLimitDbFallback(db);

function freshSubject(label: string): string {
  return `${label}-${uuidv7()}`;
}

afterAll(async () => {
  await pool.end();
});

describe('RateLimitDbFallback.tryAcquire', () => {
  it('holds the cap when the whole burst is in flight together', async () => {
    const bucket = 'test:login';
    const subject = freshSubject('burst');
    const cap = 20;
    const burst = 25;

    const outcomes = await Promise.all(
      Array.from({ length: burst }, () => fallback.tryAcquire({ bucket, subject, windowMs: 15 * 60 * 1000, cap })),
    );

    const acquired = outcomes.filter((o) => o.acquired).length;
    const refused = outcomes.filter((o) => !o.acquired && 'retryAfterSeconds' in o).length;

    expect(acquired).toBe(cap);
    expect(refused).toBe(burst - cap);

    // The table records exactly what it allowed, not everything that asked.
    const rows = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM rate_limit_fallback_attempts WHERE bucket = ${bucket} AND subject = ${subject}`,
    );
    expect(rows.rows[0]?.count).toBe(cap);
  }, 20_000);

  it('does not refuse one attempt short of the budget', async () => {
    const bucket = 'test:login';
    const subject = freshSubject('near-cap');
    const cap = 20;

    for (let i = 0; i < cap - 1; i += 1) {
      const outcome = await fallback.tryAcquire({ bucket, subject, windowMs: 15 * 60 * 1000, cap });
      expect(outcome.acquired).toBe(true);
    }
  }, 20_000);

  it('reports how long the caller must wait', async () => {
    const bucket = 'test:login';
    const subject = freshSubject('retry-after');
    const cap = 1;
    const windowMs = 15 * 60 * 1000;
    const now = Date.now();

    const first = await fallback.tryAcquire({ bucket, subject, windowMs, cap }, now - 60_000);
    expect(first.acquired).toBe(true);

    const second = await fallback.tryAcquire({ bucket, subject, windowMs, cap }, now);
    expect(second.acquired).toBe(false);
    if (!second.acquired && 'retryAfterSeconds' in second) {
      expect(second.retryAfterSeconds).toBeGreaterThan(13 * 60);
      expect(second.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    } else {
      throw new Error('expected a refusal carrying retryAfterSeconds');
    }
  });

  it('release hands a claimed slot back', async () => {
    const bucket = 'test:login';
    const subject = freshSubject('release');
    const cap = 1;

    const first = await fallback.tryAcquire({ bucket, subject, windowMs: 15 * 60 * 1000, cap });
    if (!first.acquired) throw new Error('expected the first attempt to be acquired');
    await fallback.release(first.rowId);

    const second = await fallback.tryAcquire({ bucket, subject, windowMs: 15 * 60 * 1000, cap });
    expect(second.acquired).toBe(true);
  });

  it('clear empties the whole bucket for a subject', async () => {
    const bucket = 'test:login';
    const subject = freshSubject('clear');
    const cap = 1;

    await fallback.tryAcquire({ bucket, subject, windowMs: 15 * 60 * 1000, cap });
    await fallback.clear(bucket, subject);

    const outcome = await fallback.tryAcquire({ bucket, subject, windowMs: 15 * 60 * 1000, cap });
    expect(outcome.acquired).toBe(true);
  });

  it('fails open, not hanging, when the advisory lock is held elsewhere', async () => {
    const bucket = 'test:login';
    const subject = freshSubject('contended');
    const key = `${bucket}:${subject}`;

    const holder = new Client({ connectionString: env.DATABASE_URL });
    await holder.connect();
    await holder.query('SELECT pg_advisory_lock($1, hashtext($2))', [RATE_LIMIT_FALLBACK_LOCK_NAMESPACE, key]);

    try {
      const started = Date.now();
      const outcome = await fallback.tryAcquire({ bucket, subject, windowMs: 15 * 60 * 1000, cap: 20 });
      const elapsed = Date.now() - started;

      expect(outcome.acquired).toBe(false);
      expect(outcome).toMatchObject({ lockUnavailable: true });
      // Bounded by the retry loop, not an unbounded hang. The loop's own
      // budget is ~1s against a local Postgres; the generous ceiling here
      // absorbs this suite's round trip to a remote dev database, where each
      // of the 40 attempts pays real network latency the production
      // deployment (API and Postgres co-located) will not.
      expect(elapsed).toBeLessThan(25_000);
    } finally {
      await holder.query('SELECT pg_advisory_unlock_all()');
      await holder.end();
    }
  }, 30_000);
});

describe('RateLimitDbFallback.tryAcquirePair', () => {
  it('keeps the two budgets independent, matching the Lua script', async () => {
    const emailBucket = 'test:pwreset:email';
    const ipBucket = 'test:pwreset:ip';
    const ip = freshSubject('ip');
    const windowMs = 60 * 60 * 1000;
    // A small IP cap proves the same independence property as the real
    // MAX_PER_IP=20 with far fewer sequential round trips against this
    // suite's remote dev database.
    const ipCap = 3;

    // Spend the whole IP budget with distinct emails.
    for (let i = 0; i < ipCap; i += 1) {
      const outcome = await fallback.tryAcquirePair(
        { bucket: emailBucket, subject: freshSubject(`spender-${String(i)}`), windowMs, cap: 3 },
        { bucket: ipBucket, subject: ip, windowMs, cap: ipCap },
      );
      expect(outcome.acquired).toBe(true);
    }

    // A fresh email from the same IP is refused on the IP budget...
    const victimEmail = freshSubject('victim');
    const refused = await fallback.tryAcquirePair(
      { bucket: emailBucket, subject: victimEmail, windowMs, cap: 3 },
      { bucket: ipBucket, subject: ip, windowMs, cap: ipCap },
    );
    expect(refused).toEqual({ acquired: false, which: 'b' });

    // ...and must leave no mark on the email budget it never got to write.
    const stillFresh = await fallback.tryAcquirePair(
      { bucket: emailBucket, subject: victimEmail, windowMs, cap: 3 },
      null,
    );
    expect(stillFresh.acquired).toBe(true);
  }, 30_000);
});
