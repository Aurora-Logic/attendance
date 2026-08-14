import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JobRunner } from '../jobs/job-runner.service.js';
import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * REQ-B-04. `auth.timing.test.ts` covers login; this covers the other endpoint
 * whose entire design is that it answers the same way for an address with an
 * account and one without.
 *
 * The status and the body were already blind -- always 202 `{"status":
 * "accepted"}` -- and the pre-launch gate found that the clock was not. Inside
 * the rate limiter's budget, which is the only case a real attacker cares
 * about, the two branches separated cleanly: a known address took a minimum of
 * 9.75 ms against an unknown address's median of 4.33 ms. The known branch
 * awaited a DELETE sweep, an INSERT, an SMTP send and an audit write; the
 * unknown branch returned straight after the account lookup. Against a real
 * relay rather than loopback Mailpit the gap is a whole SMTP round trip, which
 * is separable from the open internet.
 *
 * What would make this test pass while the endpoint is still broken:
 *
 * - Too few samples. Thirty per branch, interleaved, so a warming CPU and a
 *   filling connection pool are spent on both sides equally.
 * - Comparing only medians. A median ratio hides a leak whose *shape* differs,
 *   so the assertions below are the gate's own signature inverted -- the known
 *   minimum must not sit above the unknown median -- plus a rank statistic
 *   that does not assume either distribution is normal.
 * - Measuring the throttled path. Over budget the endpoint already returns
 *   without doing anything, so both branches look identical and prove nothing.
 *   The per-IP window is therefore cleared before every pair, keeping every
 *   sample on the in-budget path that the finding is about.
 * - Making both branches fast by no longer sending the mail at all. That would
 *   be far worse than the leak, so the last case drains the queue and asserts
 *   the reset link really reaches the addresses that have accounts, and only
 *   those.
 *
 * One thing this test deliberately cannot see: the harness swaps `Mailer` for
 * `RecordingMailer`, so the SMTP round trip -- the largest single component of
 * the gap in production, and the one a remote attacker measures -- is absent
 * from every sample. What is left is the database work alone. That makes the
 * test conservative rather than optimistic: it fails on a smaller signal than
 * the deployed system would emit, and cannot pass by the leak being too small
 * to see here.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000a7';
const SAMPLES = 30;

let harness: ApiHarness;
const realAccounts: string[] = [];
const ghostAddresses: string[] = [];

function quantile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

function describeDistribution(label: string, values: readonly number[]): string {
  return (
    `${label} n=${String(values.length)} ` +
    `min=${Math.min(...values).toFixed(2)}ms ` +
    `p50=${quantile(values, 0.5).toFixed(2)}ms ` +
    `p90=${quantile(values, 0.9).toFixed(2)}ms ` +
    `max=${Math.max(...values).toFixed(2)}ms`
  );
}

/**
 * The probability that a randomly drawn known-address sample took longer than a
 * randomly drawn unknown-address one -- the Mann-Whitney U statistic as a
 * proportion. 0.5 is "the two are interchangeable"; 1.0 is "every known request
 * was slower than every unknown one", which is what a perfect oracle looks
 * like. Rank-based on purpose: it needs no assumption about the shape of either
 * distribution, and one slow outlier cannot move it far.
 */
function probabilityKnownIsSlower(known: readonly number[], unknown: readonly number[]): number {
  let wins = 0;
  for (const a of known) {
    for (const b of unknown) {
      if (a > b) wins += 1;
      else if (a === b) wins += 0.5;
    }
  }
  return wins / (known.length * unknown.length);
}

async function timeReset(email: string): Promise<{ ms: number; status: number }> {
  const started = process.hrtime.bigint();
  const result = await harness.post('/auth/password-resets', { body: { email } });
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, status: result.status };
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Password Reset Timing Fixture Org');

  // One account per sample. The per-address budget is three an hour, so reusing
  // one address would put twenty-seven of the thirty known samples on the
  // throttled path -- which is the path that already looks identical, and would
  // make this test pass by measuring the wrong thing.
  for (let i = 0; i < SAMPLES; i += 1) {
    const user = await harness.createUser({ email: scopedEmail(`reset-timing-${String(i)}`) });
    realAccounts.push(user.email);
    ghostAddresses.push(scopedEmail(`reset-ghost-${String(i)}`));
  }

  // Warm the pool, the query plans and the JIT before anything is measured, on
  // an address that is not one of the samples.
  for (let i = 0; i < 3; i += 1) {
    await harness.post('/auth/password-resets', { body: { email: scopedEmail('reset-warmup') } });
  }
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('password reset timing does not reveal whether an account exists', () => {
  it('takes the same time for an address with an account as for one without', async () => {
    const known: number[] = [];
    const unknown: number[] = [];

    for (let i = 0; i < SAMPLES; i += 1) {
      // Every sample must be in budget: the throttled path returns immediately
      // for both branches and would dilute the very difference under test.
      await harness.clearPasswordResetRateLimit();

      const withAccount = await timeReset(realAccounts[i] ?? '');
      expect(withAccount.status).toBe(202);
      known.push(withAccount.ms);

      const withoutAccount = await timeReset(ghostAddresses[i] ?? '');
      expect(withoutAccount.status).toBe(202);
      unknown.push(withoutAccount.ms);
    }

    const separation = probabilityKnownIsSlower(known, unknown);
    const report =
      `${describeDistribution('known', known)} | ${describeDistribution('unknown', unknown)}` +
      ` | P(known > unknown)=${separation.toFixed(3)}`;

    // The gate's own signature, inverted. A known minimum above the unknown
    // median means the fastest possible request against a real address is still
    // slower than half of all requests against a fake one -- separable with a
    // single sample and no statistics at all.
    expect(Math.min(...known), report).toBeLessThanOrEqual(quantile(unknown, 0.5));
    expect(Math.min(...unknown), report).toBeLessThanOrEqual(quantile(known, 0.5));

    // And the distributions must overlap rather than merely touch.
    expect(separation, report).toBeGreaterThan(0.3);
    expect(separation, report).toBeLessThan(0.7);
  }, 120_000);

  /**
   * The other half of the fix, and the more important one. Taking the send off
   * the request path is only correct if the send still happens.
   */
  it('still delivers a usable reset link, and only to addresses that have accounts', async () => {
    const runner = harness.resolve(JobRunner);
    runner.startWorkers();

    const delivered = await harness.waitForMailTo(realAccounts[0] ?? '', 15_000);
    expect(delivered, 'no reset mail arrived for an address that has an account').not.toBeNull();
    expect(delivered?.actionUrl ?? '').toContain('/reset-password/');

    // Give the queue a moment past the first delivery, then confirm nothing was
    // ever addressed to an account that does not exist.
    await harness.waitForMailTo(realAccounts[SAMPLES - 1] ?? '', 15_000);
    for (const ghost of ghostAddresses) {
      expect(harness.mail.lastTo(ghost), `reset mail was sent to ${ghost}`).toBeNull();
    }
  }, 60_000);
});
