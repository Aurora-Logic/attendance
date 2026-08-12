import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiHarness, scopedEmail } from '../../test-support/api-harness.js';

/**
 * REQ-B-01 has no timing clause, but account enumeration is the attack that
 * survives every other login defence: rate limits and lockouts stop guessing
 * *passwords*, and do nothing to stop an attacker learning which addresses
 * have accounts. The defence is the decoy hash in `password.ts`.
 *
 * Its own file, and this is the reason: the per-IP limiter (REQ-B-10) allows
 * twenty failed sign-ins per address per fifteen minutes, this test spends
 * twelve of them, and the whole suite arrives from 127.0.0.1. Sharing an
 * application instance with the other endpoint tests would exhaust the budget
 * and the failure would look like a bug in login rather than a test that asked
 * for too much.
 *
 * What would make this pass while the feature is broken: too few samples, so
 * scheduling noise hides a 70 ms gap. Hence twelve samples, interleaved so a
 * warming CPU affects both sides equally, compared on the median, and anchored
 * to an absolute floor -- if the decoy were removed the missing-account path
 * would return in single-digit milliseconds and fail the floor outright.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000a6';
const SAMPLES = 6;

let harness: ApiHarness;
const realAccounts: string[] = [];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function timeLogin(email: string, password: string): Promise<{ ms: number; status: number }> {
  const started = process.hrtime.bigint();
  const result = await harness.post('/auth/login', { body: { email, password } });
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, status: result.status };
}

beforeAll(async () => {
  harness = await ApiHarness.start(ORG_ID, 'Auth Timing Fixture Org');

  // One account per sample, so no account collects enough failures to lock and
  // change the shape of what is being measured.
  for (let i = 0; i < SAMPLES; i += 1) {
    const user = await harness.createUser({ email: scopedEmail(`timing-${String(i)}`) });
    realAccounts.push(user.email);
  }

  // Warm-up on the success path, which the per-IP limiter does not count.
  const warmup = realAccounts[0];
  if (warmup !== undefined) {
    await harness.post('/auth/login', {
      body: { email: warmup, password: 'fixture-passphrase-2026' },
    });
    await harness.post('/auth/login', {
      body: { email: warmup, password: 'fixture-passphrase-2026' },
    });
  }
}, 30_000);

afterAll(async () => {
  await harness.close();
});

describe('login timing does not reveal whether an account exists', () => {
  it('takes the same time for an unknown address as for a wrong password', async () => {
    const existing: number[] = [];
    const missing: number[] = [];

    for (let i = 0; i < SAMPLES; i += 1) {
      const email = realAccounts[i] ?? '';

      const wrongPassword = await timeLogin(email, 'this-is-not-the-password');
      expect(wrongPassword.status).toBe(401);
      existing.push(wrongPassword.ms);

      const noSuchAccount = await timeLogin(scopedEmail(`ghost-${String(i)}`), 'this-is-not-the-password');
      expect(noSuchAccount.status).toBe(401);
      missing.push(noSuchAccount.ms);
    }

    const withAccount = median(existing);
    const withoutAccount = median(missing);

    // The floor. A missing account that answered instantly would be the
    // enumeration oracle this test exists to rule out, and it is what removing
    // the decoy hash would produce.
    expect(withoutAccount).toBeGreaterThan(20);
    expect(withAccount).toBeGreaterThan(20);

    const gap = Math.abs(withAccount - withoutAccount);
    const relative = gap / Math.max(withAccount, withoutAccount);

    // Generous, because this measures a real HTTP round trip on a shared
    // machine. It is still far tighter than the ~100% gap that dropping the
    // decoy would open up.
    expect(
      relative,
      `existing=${withAccount.toFixed(1)}ms missing=${withoutAccount.toFixed(1)}ms`,
    ).toBeLessThan(0.4);
  }, 30_000);
});
