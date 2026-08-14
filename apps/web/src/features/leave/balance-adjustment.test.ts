import { describe, expect, it } from 'vitest';

import { leaveAdjustmentSchema } from '@vyuha/shared';

import {
  adjustmentProblems,
  projectedClosing,
  signedDays,
  type AdjustmentDraft,
} from './balance-adjustment';
import type { LeaveBalance } from './types';

/**
 * REQ-G-03's `adjusted` bucket. The rules here have to agree with
 * `leaveAdjustmentSchema`, which the server parses the body with, so the last
 * block below asserts exactly that rather than trusting two lists to stay in
 * step.
 */

function draft(overrides: Partial<AdjustmentDraft> = {}): AdjustmentDraft {
  return {
    employeeId: '01a00028-7470-74d1-b9ce-9985905dcfcb',
    leaveTypeId: '01a00029-0000-7000-8000-000000000001',
    direction: 'ADD',
    amount: '12',
    reason: 'Opening balance for the pilot',
    ...overrides,
  };
}

function balance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  return {
    leaveType: { id: 't1', name: 'Casual Leave', code: 'CL' },
    leaveYear: 2026,
    opening: 0,
    accrued: 4,
    availed: 1.5,
    adjusted: 0,
    carriedForward: 0,
    closing: 2.5,
    ...overrides,
  };
}

describe('signedDays', () => {
  it('makes the direction the sign', () => {
    expect(signedDays(draft({ direction: 'ADD', amount: '12' }))).toBe(12);
    expect(signedDays(draft({ direction: 'REMOVE', amount: '12' }))).toBe(-12);
  });

  it('keeps half days', () => {
    expect(signedDays(draft({ amount: '0.5' }))).toBe(0.5);
    expect(signedDays(draft({ direction: 'REMOVE', amount: '2.5' }))).toBe(-2.5);
  });

  it('rounds to the stored scale rather than carrying float noise into the ledger', () => {
    // numeric(6,2) is the column, so two decimals is the contract. Rounding
    // is the shared `roundLeaveDays`, which rounds the binary float — 1.005
    // is 100.4999… at scale and therefore lands on 1.00, not 1.01. Stated
    // here because it is the sort of thing somebody would later "fix".
    expect(signedDays(draft({ amount: '0.1' }))).toBe(0.1);
    expect(signedDays(draft({ amount: '1.004' }))).toBe(1);
    expect(signedDays(draft({ amount: '1.006' }))).toBe(1.01);
  });

  it('is null while the amount is half-typed', () => {
    expect(signedDays(draft({ amount: '' }))).toBeNull();
    expect(signedDays(draft({ amount: '  ' }))).toBeNull();
    expect(signedDays(draft({ amount: 'abc' }))).toBeNull();
  });

  it('does not turn a removal of zero into a negative zero', () => {
    // -0 compares equal to 0 but serialises and formats differently, and
    // "removed -0 days" in an append-only ledger is a row nobody can explain.
    expect(Object.is(signedDays(draft({ direction: 'REMOVE', amount: '0' })), -0)).toBe(false);
  });
});

describe('adjustmentProblems', () => {
  it('passes a complete draft', () => {
    expect(adjustmentProblems(draft())).toEqual([]);
  });

  it('names each missing part', () => {
    expect(adjustmentProblems(draft({ employeeId: null }))).toContain('NO_EMPLOYEE');
    expect(adjustmentProblems(draft({ leaveTypeId: null }))).toContain('NO_TYPE');
    expect(adjustmentProblems(draft({ amount: '' }))).toContain('AMOUNT_MISSING');
    expect(adjustmentProblems(draft({ amount: 'ten' }))).toContain('AMOUNT_NOT_A_NUMBER');
    expect(adjustmentProblems(draft({ reason: 'x' }))).toContain('REASON_TOO_SHORT');
  });

  it('refuses a zero correction in either direction', () => {
    expect(adjustmentProblems(draft({ amount: '0' }))).toContain('AMOUNT_ZERO');
    expect(adjustmentProblems(draft({ direction: 'REMOVE', amount: '0' }))).toContain('AMOUNT_ZERO');
    // 0.004 rounds to 0 at the stored scale, so it is a zero the column would
    // not hold either.
    expect(adjustmentProblems(draft({ amount: '0.004' }))).toContain('AMOUNT_ZERO');
  });

  it('refuses more than the column can hold', () => {
    expect(adjustmentProblems(draft({ amount: '10000' }))).toContain('AMOUNT_TOO_LARGE');
    expect(adjustmentProblems(draft({ amount: '9999.99' }))).toEqual([]);
  });

  it('treats a whitespace-only reason as no reason', () => {
    expect(adjustmentProblems(draft({ reason: '   ' }))).toContain('REASON_TOO_SHORT');
  });
});

describe('projectedClosing', () => {
  it('moves the closing balance by the correction', () => {
    expect(projectedClosing(balance(), 12)).toBe(14.5);
    expect(projectedClosing(balance(), -2)).toBe(0.5);
  });

  it('can take a balance negative, which REQ-G-08 allows', () => {
    expect(projectedClosing(balance(), -5)).toBe(-2.5);
  });

  it('adds to an adjustment that is already there', () => {
    expect(projectedClosing(balance({ adjusted: 3, closing: 5.5 }), 2)).toBe(7.5);
  });

  it('stays exact across half days', () => {
    expect(projectedClosing(balance({ closing: 0.1, accrued: 0.1, availed: 0 }), 0.2)).toBe(0.3);
  });
});

describe('agreement with the schema the server parses', () => {
  const base = {
    employeeId: '01a00028-7470-74d1-b9ce-9985905dcfcb',
    leaveTypeId: '01a00029-0000-7000-8000-000000000001',
    year: 2026,
  };

  it('accepts what the form calls valid', () => {
    const ok = draft();
    const days = signedDays(ok);
    expect(days).not.toBeNull();
    expect(
      leaveAdjustmentSchema.safeParse({ ...base, days, reason: ok.reason }).success,
    ).toBe(true);
  });

  it('rejects everything the form calls a problem', () => {
    // Each of these must fail on the server too; if one passed there, this
    // form would be refusing something the product allows.
    for (const bad of [
      { days: 0, reason: 'Opening balance' },
      { days: 12, reason: 'x' },
      { days: 10_000, reason: 'Opening balance' },
    ]) {
      expect(leaveAdjustmentSchema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
  });
});
