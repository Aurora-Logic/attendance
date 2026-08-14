import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { describeError } from '../common/errors.js';
import { InjectRedis } from '../redis/redis.provider.js';

/**
 * REQ-B-04's missing half, found live by the pre-deploy gate: sixty rapid
 * requests to `POST /auth/password-resets` produced sixty 202s and forty-odd
 * real emails. The endpoint's enumeration-resistant design -- always 202,
 * never a hint -- made it a free mailbox-bombing primitive.
 *
 * Same shape as `LoginRateLimiter`, deliberately: Redis sorted sets as a
 * genuine sliding window, one key per subject, expiry as the whole eviction
 * strategy. Two subjects rather than one, because they stop different abuse:
 * the per-address cap is what protects a mailbox from being flooded, and the
 * per-IP budget is what makes spraying many addresses from one place
 * expensive. The address is keyed lower-cased, matching the unique index the
 * account lookup uses, so `User@` and `user@` spend one budget.
 *
 * The crucial difference from the login limiter: a throttled request must
 * never *say* it was throttled. A 429 for one address and a 202 for another
 * would reintroduce, through the limiter, exactly the enumeration oracle the
 * endpoint was shaped to avoid -- so the caller asks `tryAcquire` and, when
 * refused, silently skips the insert and the send while still answering 202.
 *
 * **When Redis is unreachable this fails open**, loudly, for the login
 * limiter's reason: a dead cache must not stop a genuine "I forgot my
 * password" from working, and every occurrence is logged at error level so
 * "the cap is not currently in force" is visible rather than assumed.
 */

const WINDOW_MS = 60 * 60 * 1000;
/** Three real emails per mailbox per hour is plenty for a person at a login screen. */
const MAX_PER_EMAIL = 3;
/** Matches the login limiter's per-IP number: one office NAT, many people. */
const MAX_PER_IP = 20;

const EMAIL_PREFIX = 'pwreset:email:';
const IP_PREFIX = 'pwreset:ip:';

/** Exported so test support can clear a subject without guessing the format. */
export function passwordResetEmailKey(email: string): string {
  return `${EMAIL_PREFIX}${email.toLowerCase()}`;
}

export function passwordResetIpKey(ip: string): string {
  return `${IP_PREFIX}${ip}`;
}

@Injectable()
export class PasswordResetRateLimiter {
  private readonly logger = new Logger(PasswordResetRateLimiter.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  /**
   * True when this request may insert a reset row and send the email; false
   * when either window is spent. An allowed request is recorded against both
   * windows in the same call -- every request counts, known address or not,
   * so the limiter's behaviour cannot be used to tell the two apart.
   */
  async tryAcquire(email: string, ip: string | null, now: number = Date.now()): Promise<boolean> {
    const emailKey = passwordResetEmailKey(email);
    const ipKey = ip === null ? null : passwordResetIpKey(ip);

    try {
      const probe = this.redis
        .multi()
        .zremrangebyscore(emailKey, '-inf', String(now - WINDOW_MS))
        .zcard(emailKey);
      if (ipKey !== null) {
        probe.zremrangebyscore(ipKey, '-inf', String(now - WINDOW_MS)).zcard(ipKey);
      }
      const results = await probe.exec();

      const emailCount = readCount(results, 1);
      const ipCount = ipKey === null ? 0 : readCount(results, 3);
      if (emailCount >= MAX_PER_EMAIL || ipCount >= MAX_PER_IP) {
        // The address itself stays out of the log, as everywhere on this path.
        this.logger.warn({
          msg: 'Password reset request over budget; answering 202 and sending nothing.',
          subject: emailCount >= MAX_PER_EMAIL ? 'email' : 'ip',
          ip,
        });
        return false;
      }

      // Unique per attempt: a sorted set deduplicates by member, so a burst
      // within one millisecond would otherwise count once.
      const member = `${String(now)}-${randomBytes(6).toString('hex')}`;
      const record = this.redis
        .multi()
        .zadd(emailKey, String(now), member)
        .pexpire(emailKey, WINDOW_MS);
      if (ipKey !== null) {
        record.zadd(ipKey, String(now), member).pexpire(ipKey, WINDOW_MS);
      }
      await record.exec();
      return true;
    } catch (error: unknown) {
      this.logger.error({
        msg: 'Redis is unavailable for the password-reset limit; the cap is NOT in force.',
        reason: describeError(error),
      });
      return true;
    }
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
