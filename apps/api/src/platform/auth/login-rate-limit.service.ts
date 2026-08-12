import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@vyuha/shared';
import type { Redis } from 'ioredis';

import { AppError, describeError } from '../common/errors.js';
import { InjectRedis } from '../redis/redis.provider.js';

/**
 * REQ-B-10, second half: "20 [failed logins] per IP per 15 min."
 *
 * **In Redis**, so it survives a restart and holds across instances -- the
 * previous in-process version reset on every deploy and gave each instance its
 * own budget, which meant the effective limit was 20 times the number of
 * processes (docs OPEN-QUESTIONS P0-11). The per-account limit stays in
 * Postgres and is untouched; that one is what actually protects an account,
 * and this one is what makes a spray across many accounts expensive.
 *
 * A sorted set per address, scored by timestamp, is a genuine sliding window:
 * a fixed-window counter would let an attacker spend the full budget at
 * 14:59:59 and the full budget again at 15:00:01.
 *
 * Only *failed* attempts are counted, and that is deliberate rather than
 * lenient. Everyone in this product punches in from one office within the same
 * few minutes (ADR 0002), so they share one public IP: counting successes
 * would lock out the entire workforce at 09:05 every morning, which is a
 * denial of service the product would inflict on itself.
 *
 * **When Redis is unreachable the limiter fails open**, loudly. The trade is
 * deliberate: failing closed would mean nobody in the company can sign in
 * because a cache is down, and the per-account lockout -- five attempts, in
 * Postgres, with an email notice -- still stands either way. Every occurrence
 * is logged at error level, so "the per-IP limit is not currently in force" is
 * visible rather than assumed.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP = 20;

const KEY_PREFIX = 'login:failures:';

/** Exported so test support can clear an address without guessing the format. */
export function loginRateLimitKey(ip: string): string {
  return `${KEY_PREFIX}${ip}`;
}

@Injectable()
export class LoginRateLimiter {
  private readonly logger = new Logger(LoginRateLimiter.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  /** Throws RATE_LIMITED when this address has already spent its budget. */
  async assertWithinBudget(ip: string | null, now: number = Date.now()): Promise<void> {
    if (ip === null) return;

    const key = loginRateLimitKey(ip);

    let recent: string[];
    try {
      // Prune and read in one round trip. Pruning here as well as on write
      // means an address that stops failing does not keep a stale count.
      const results = await this.redis
        .multi()
        .zremrangebyscore(key, '-inf', String(now - WINDOW_MS))
        .zrange(key, '0', '0', 'WITHSCORES')
        .zcard(key)
        .exec();

      const count = readCount(results, 2);
      if (count < MAX_FAILURES_PER_IP) return;

      recent = readStrings(results, 1);
    } catch (error: unknown) {
      this.failOpen('checking', error);
      return;
    }

    // The score of the oldest surviving failure is when the window frees up.
    const oldest = Number(recent[1] ?? now);
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));

    this.logger.warn({ msg: 'Login rate limit reached for address', ip });

    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many failed sign-in attempts from this network. Try again shortly.',
      { details: { retryAfterSeconds } },
    );
  }

  async recordFailure(ip: string | null, now: number = Date.now()): Promise<void> {
    if (ip === null) return;

    const key = loginRateLimitKey(ip);
    // Unique per attempt: a sorted set deduplicates by member, so two failures
    // in the same millisecond would otherwise count once.
    const member = `${String(now)}-${randomBytes(6).toString('hex')}`;

    try {
      await this.redis
        .multi()
        .zremrangebyscore(key, '-inf', String(now - WINDOW_MS))
        .zadd(key, String(now), member)
        // Expiry is the whole eviction strategy. The previous version needed a
        // tracked-address cap and a hand-written sweep to stop a rotating
        // source turning the counter into a memory leak; Redis does it.
        .pexpire(key, WINDOW_MS)
        .exec();
    } catch (error: unknown) {
      this.failOpen('recording a failure for', error);
    }
  }

  /** A successful sign-in clears the address; the failures were not an attack. */
  async clear(ip: string | null): Promise<void> {
    if (ip === null) return;
    try {
      await this.redis.del(loginRateLimitKey(ip));
    } catch (error: unknown) {
      this.failOpen('clearing', error);
    }
  }

  private failOpen(action: string, error: unknown): void {
    this.logger.error({
      msg: `Redis is unavailable while ${action} the per-IP login limit; the limit is NOT in force. The per-account lockout is unaffected.`,
      reason: describeError(error),
    });
  }
}

type MultiResult = [Error | null, unknown][] | null;

function readCount(results: MultiResult, index: number): number {
  const entry = results?.[index];
  if (entry === undefined) throw new Error('Redis pipeline returned no result for ZCARD.');
  const [error, value] = entry;
  if (error !== null) throw error;
  return typeof value === 'number' ? value : 0;
}

function readStrings(results: MultiResult, index: number): string[] {
  const entry = results?.[index];
  if (entry === undefined) return [];
  const [error, value] = entry;
  if (error !== null) throw error;
  return Array.isArray(value) ? value.map(String) : [];
}
