import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@vyuha/shared';

import { AppError } from '../common/errors.js';

/**
 * REQ-B-10, second half: "20 [failed logins] per IP per 15 min."
 *
 * **In-process, in-memory.** No Redis client is an installed dependency and
 * this phase was told not to add one. Two consequences to be honest about:
 * the counter resets when the process restarts, and with more than one API
 * instance the effective limit is 20 per instance. Neither weakens the
 * per-account control, which lives in the database and is the one that
 * actually protects an account. Moving this to Redis is a small, isolated
 * change -- the interface below is two methods.
 *
 * Only *failed* attempts are counted, and that is deliberate rather than
 * lenient. Everyone in this product punches in from one office within the same
 * few minutes (ADR 0002), so they share one public IP: counting successes
 * would lock out the entire workforce at 09:05 every morning, which is a
 * denial of service the product would inflict on itself.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP = 20;

/**
 * A bound on how many distinct addresses are tracked. Without it a burst from
 * a rotating source is an unbounded map, which is a memory exhaustion bug
 * hiding inside a defence against a different attack.
 */
const MAX_TRACKED_ADDRESSES = 10_000;

@Injectable()
export class LoginRateLimiter {
  private readonly logger = new Logger(LoginRateLimiter.name);
  private readonly failuresByAddress = new Map<string, number[]>();

  /** Throws RATE_LIMITED when this address has already spent its budget. */
  assertWithinBudget(ip: string | null, now: number = Date.now()): void {
    if (ip === null) return;

    const recent = this.recentFailures(ip, now);
    if (recent.length < MAX_FAILURES_PER_IP) return;

    const oldest = recent[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));

    this.logger.warn({ msg: 'Login rate limit reached for address', ip, failures: recent.length });

    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many failed sign-in attempts from this network. Try again shortly.',
      { details: { retryAfterSeconds } },
    );
  }

  recordFailure(ip: string | null, now: number = Date.now()): void {
    if (ip === null) return;

    const recent = this.recentFailures(ip, now);
    recent.push(now);
    this.failuresByAddress.set(ip, recent);

    if (this.failuresByAddress.size > MAX_TRACKED_ADDRESSES) this.evictOldest(now);
  }

  /** A successful sign-in clears the address; the failures were not an attack. */
  clear(ip: string | null): void {
    if (ip === null) return;
    this.failuresByAddress.delete(ip);
  }

  private recentFailures(ip: string, now: number): number[] {
    const cutoff = now - WINDOW_MS;
    const existing = this.failuresByAddress.get(ip) ?? [];
    const recent = existing.filter((at) => at > cutoff);
    if (recent.length === 0) this.failuresByAddress.delete(ip);
    return recent;
  }

  /**
   * Drops every address whose window has fully elapsed. If that frees nothing
   * -- ten thousand addresses all actively failing -- the map is cleared, which
   * gives every attacker a fresh budget but keeps the process alive. Staying up
   * with a weakened per-IP counter is better than falling over, because the
   * per-account lockout is untouched either way.
   */
  private evictOldest(now: number): void {
    const cutoff = now - WINDOW_MS;
    for (const [ip, attempts] of this.failuresByAddress) {
      const newest = attempts[attempts.length - 1];
      if (newest === undefined || newest <= cutoff) this.failuresByAddress.delete(ip);
    }

    if (this.failuresByAddress.size > MAX_TRACKED_ADDRESSES) {
      this.logger.error({
        msg: 'Per-IP login limiter exceeded its address budget with no expired entries; clearing.',
        tracked: this.failuresByAddress.size,
      });
      this.failuresByAddress.clear();
    }
  }
}
