import { describe, expect, it } from 'vitest';

import {
  MAX_RETRIES_PER_REQUEST,
  RECONNECT_DELAY_CAP_MS,
  commandGiveUpMs,
  reconnectDelayMs,
} from './redis.provider.js';

/**
 * How long the API waits on a Redis that is not there.
 *
 * The per-IP login limit deliberately fails open when Redis is unreachable
 * (OPEN-QUESTIONS P0-11), and the provider says it does so after "three quick
 * tries". Both halves were true and their product was not: ioredis abandons a
 * queued command after `maxRetriesPerRequest` reconnection attempts, and a few
 * seconds into an outage every one of those attempts waits the full
 * `retryStrategy` cap. At 5,000ms that was about twenty seconds per command.
 *
 * Measured on the production build with Redis behind a killed TCP proxy:
 * `POST /auth/login` answered 200 after 35.3s -- two limiter commands, one
 * before the password check and one after -- and `POST /auth/password-resets`
 * spent 6.3s of its 8.3s in the same place. A sign-in that takes half a minute
 * is an outage whatever the limiter's log line says.
 *
 * The bound under test is therefore the product, not either half: raising the
 * cap without noticing that it multiplies is exactly how this happened.
 */

/**
 * Slow enough to ride out a Redis failover, fast enough that a person waiting
 * on a sign-in form does not conclude the product is broken. A sign-in issues
 * two of these commands in series -- the budget check before the password is
 * verified and the clear after it succeeds -- so the wait a person experiences
 * is twice this.
 */
const ACCEPTABLE_GIVE_UP_MS = 4_000;

describe('the Redis command give-up bound', () => {
  it('gives up on a command well inside a human sign-in', () => {
    expect(commandGiveUpMs()).toBeLessThanOrEqual(ACCEPTABLE_GIVE_UP_MS);
  });

  it('is the product of the two numbers, so neither can be raised alone', () => {
    expect(commandGiveUpMs()).toBe(MAX_RETRIES_PER_REQUEST * RECONNECT_DELAY_CAP_MS);
  });

  it('still backs off rather than reconnecting in a tight loop', () => {
    // The opposite failure: a strategy returning 0 would hammer a Redis that is
    // coming back up, which is when it can least afford it.
    expect(reconnectDelayMs(1)).toBeGreaterThan(0);
    expect(reconnectDelayMs(1)).toBeLessThan(reconnectDelayMs(5));
  });

  it('climbs to the cap and stays there', () => {
    expect(reconnectDelayMs(1_000)).toBe(RECONNECT_DELAY_CAP_MS);
    expect(reconnectDelayMs(Number.MAX_SAFE_INTEGER)).toBe(RECONNECT_DELAY_CAP_MS);
  });
});
