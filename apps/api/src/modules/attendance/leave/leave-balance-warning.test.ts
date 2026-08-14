import { describe, expect, it } from 'vitest';

import {
  LOW_LEAVE_BALANCE_DAYS,
  balanceBeforeApproval,
  crossedLowBalance,
} from './leave-balance-warning.js';

/**
 * REQ-K-03's low-balance warning, as a rule rather than a dispatch.
 *
 * The behaviour worth pinning is what does *not* warn. A rule that fires
 * whenever the balance is low turns into one notification per approval for
 * everybody who is near the line, and into one per Leave Without Pay approval
 * for everybody, forever.
 */

describe('crossedLowBalance', () => {
  it('warns on the approval that takes the balance under the line', () => {
    expect(crossedLowBalance(3, 1)).toBe(true);
    expect(crossedLowBalance(LOW_LEAVE_BALANCE_DAYS, 1.5)).toBe(true);
  });

  it('says nothing when the balance was already under it', () => {
    // The warning was sent on the approval that crossed. Repeating it on every
    // subsequent approval is how a bell stops being read.
    expect(crossedLowBalance(1.5, 0.5)).toBe(false);
    expect(crossedLowBalance(0, -1)).toBe(false);
  });

  it('stays quiet for Leave Without Pay, which opens at zero', () => {
    // REQ-G-08 allows a negative balance up to a per-type limit, and LWP is
    // the type that lives there. It can never have been above the line.
    expect(crossedLowBalance(0, -3)).toBe(false);
    expect(crossedLowBalance(-3, -6)).toBe(false);
  });

  it('says nothing when the balance is still comfortable', () => {
    expect(crossedLowBalance(10, 8)).toBe(false);
    expect(crossedLowBalance(3, LOW_LEAVE_BALANCE_DAYS)).toBe(false);
  });

  it('warns on a single long request that jumps the line from well above it', () => {
    expect(crossedLowBalance(12, -1)).toBe(true);
  });

  it('treats the threshold itself as still comfortable', () => {
    // The template says "you have N days left"; saying it while the person
    // still has exactly the threshold would be a warning about nothing.
    expect(crossedLowBalance(4, LOW_LEAVE_BALANCE_DAYS)).toBe(false);
  });
});

describe('balanceBeforeApproval', () => {
  it('adds the days back, rounded the way the ledger stores them', () => {
    expect(balanceBeforeApproval(1.5, 2)).toBe(3.5);
    expect(balanceBeforeApproval(-1, 4)).toBe(3);
  });

  it('does not accumulate binary float error across half days', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point, and the
    // ledger's check constraint refuses more than two decimals.
    expect(balanceBeforeApproval(0.1, 0.2)).toBe(0.3);
  });
});
