import { DEFAULT_LEAVE_YEAR_START_MONTH, leaveYearBounds, leaveYearOf } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { accrualForPeriod, accrualPeriodFor, carryForward, servedFraction } from './leave-accrual.js';

const APRIL = DEFAULT_LEAVE_YEAR_START_MONTH;

const FULL_YEAR_EMPLOYEE = { dateOfJoining: '2020-01-01', dateOfLeaving: null };

describe('the leave year (REQ-G-04)', () => {
  it('puts a date before the start month into the previous leave year', () => {
    expect(leaveYearOf('2026-04-01', APRIL)).toBe(2026);
    expect(leaveYearOf('2027-03-31', APRIL)).toBe(2026);
    expect(leaveYearOf('2027-04-01', APRIL)).toBe(2027);
  });

  it('degenerates correctly to a calendar year when the start month is January', () => {
    expect(leaveYearOf('2026-01-01', 1)).toBe(2026);
    expect(leaveYearOf('2026-12-31', 1)).toBe(2026);
    expect(leaveYearBounds(2026, 1)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('bounds an April year at the last day of the following March', () => {
    expect(leaveYearBounds(2026, APRIL)).toEqual({ start: '2026-04-01', end: '2027-03-31' });
  });

  it('gets February right in a leap year', () => {
    expect(leaveYearBounds(2027, 3)).toEqual({ start: '2027-03-01', end: '2028-02-29' });
  });

  it('refuses a malformed date rather than returning a plausible year', () => {
    expect(() => leaveYearOf('not-a-date', APRIL)).toThrow(RangeError);
    expect(() => leaveYearOf('2026-13-01', APRIL)).toThrow(RangeError);
  });
});

describe('accrualPeriodFor', () => {
  it('walks the twelve months of an April leave year and rolls into the next calendar year', () => {
    expect(accrualPeriodFor(2026, APRIL, 0).periodKey).toBe('2026-04');
    expect(accrualPeriodFor(2026, APRIL, 8).periodKey).toBe('2026-12');
    expect(accrualPeriodFor(2026, APRIL, 9).periodKey).toBe('2027-01');
    expect(accrualPeriodFor(2026, APRIL, 11).periodKey).toBe('2027-03');
  });

  it('reports the real last day of each month', () => {
    expect(accrualPeriodFor(2026, APRIL, 0).end).toBe('2026-04-30');
    expect(accrualPeriodFor(2027, 2, 0).end).toBe('2027-02-28');
    expect(accrualPeriodFor(2028, 2, 0).end).toBe('2028-02-29');
  });
});

describe('pro-rating for joiners and leavers (REQ-G-05)', () => {
  it('gives a full share to somebody in service for the whole period', () => {
    expect(servedFraction(FULL_YEAR_EMPLOYEE, { start: '2026-04-01', end: '2026-04-30' })).toBe(1);
  });

  it('gives nothing for a period entirely before the joining date', () => {
    expect(
      servedFraction({ dateOfJoining: '2026-06-15', dateOfLeaving: null }, accrualPeriodFor(2026, APRIL, 0)),
    ).toBe(0);
  });

  it('gives nothing for a period entirely after the leaving date', () => {
    expect(
      servedFraction(
        { dateOfJoining: '2020-01-01', dateOfLeaving: '2026-04-30' },
        accrualPeriodFor(2026, APRIL, 1),
      ),
    ).toBe(0);
  });

  it('pro-rates the month somebody joins in', () => {
    // Joined on the 16th of a 30-day month: 15 of 30 days served.
    const fraction = servedFraction(
      { dateOfJoining: '2026-04-16', dateOfLeaving: null },
      accrualPeriodFor(2026, APRIL, 0),
    );
    expect(fraction).toBeCloseTo(0.5, 10);
  });

  it('pro-rates the month somebody leaves in', () => {
    const fraction = servedFraction(
      { dateOfJoining: '2020-01-01', dateOfLeaving: '2026-04-15' },
      accrualPeriodFor(2026, APRIL, 0),
    );
    expect(fraction).toBeCloseTo(0.5, 10);
  });

  it('handles joining and leaving inside the same period', () => {
    const fraction = servedFraction(
      { dateOfJoining: '2026-04-11', dateOfLeaving: '2026-04-20' },
      accrualPeriodFor(2026, APRIL, 0),
    );
    expect(fraction).toBeCloseTo(10 / 30, 10);
  });
});

describe('accrualForPeriod', () => {
  const base = { employee: FULL_YEAR_EMPLOYEE, leaveYearStartMonth: APRIL } as const;

  it('accrues nothing for a type whose method is NONE, whatever the entitlement', () => {
    expect(
      accrualForPeriod({
        ...base,
        accrualMethod: 'NONE',
        annualEntitlement: 24,
        period: accrualPeriodFor(2026, APRIL, 0),
      }),
    ).toBe(0);
  });

  it('accrues nothing for a type with no entitlement, whatever the method', () => {
    expect(
      accrualForPeriod({
        ...base,
        accrualMethod: 'MONTHLY',
        annualEntitlement: 0,
        period: accrualPeriodFor(2026, APRIL, 0),
      }),
    ).toBe(0);
  });

  it('splits a monthly entitlement twelve ways, rounded to the stored scale', () => {
    // 10/12 is 0.8333...; `numeric(6,2)` holds 0.83 and nothing finer, so the
    // domain must round to the same place the column does.
    expect(
      accrualForPeriod({
        ...base,
        accrualMethod: 'MONTHLY',
        annualEntitlement: 10,
        period: accrualPeriodFor(2026, APRIL, 0),
      }),
    ).toBe(0.83);

    expect(
      accrualForPeriod({
        ...base,
        accrualMethod: 'MONTHLY',
        annualEntitlement: 12,
        period: accrualPeriodFor(2026, APRIL, 0),
      }),
    ).toBe(1);
  });

  it('pro-rates a monthly accrual for a mid-month joiner', () => {
    expect(
      accrualForPeriod({
        accrualMethod: 'MONTHLY',
        annualEntitlement: 12,
        employee: { dateOfJoining: '2026-04-16', dateOfLeaving: null },
        period: accrualPeriodFor(2026, APRIL, 0),
        leaveYearStartMonth: APRIL,
      }),
    ).toBe(0.5);
  });

  it('grants a yearly entitlement only in the month the leave year opens', () => {
    const yearly = { ...base, accrualMethod: 'YEARLY', annualEntitlement: 15 } as const;
    expect(accrualForPeriod({ ...yearly, period: accrualPeriodFor(2026, APRIL, 0) })).toBe(15);
    expect(accrualForPeriod({ ...yearly, period: accrualPeriodFor(2026, APRIL, 1) })).toBe(0);
    expect(accrualForPeriod({ ...yearly, period: accrualPeriodFor(2026, APRIL, 11) })).toBe(0);
  });

  it('pro-rates a yearly grant across the whole leave year for a mid-year joiner', () => {
    // Joined 1 October, so half of an April-to-March year remains.
    const granted = accrualForPeriod({
      accrualMethod: 'YEARLY',
      annualEntitlement: 12,
      employee: { dateOfJoining: '2026-10-01', dateOfLeaving: null },
      period: accrualPeriodFor(2026, APRIL, 0),
      leaveYearStartMonth: APRIL,
    });
    // 182 of 365 days remain from 1 October to 31 March.
    expect(granted).toBeCloseTo(5.98, 2);
  });

  it('grants an ON_JOINING entitlement once, in the joining month, unprorated', () => {
    const onJoining = {
      accrualMethod: 'ON_JOINING',
      annualEntitlement: 6,
      employee: { dateOfJoining: '2026-06-20', dateOfLeaving: null },
      leaveYearStartMonth: APRIL,
    } as const;

    expect(accrualForPeriod({ ...onJoining, period: accrualPeriodFor(2026, APRIL, 2) })).toBe(6);
    expect(accrualForPeriod({ ...onJoining, period: accrualPeriodFor(2026, APRIL, 3) })).toBe(0);
  });

  it('never accrues for a period after the employee left', () => {
    expect(
      accrualForPeriod({
        accrualMethod: 'MONTHLY',
        annualEntitlement: 12,
        employee: { dateOfJoining: '2020-01-01', dateOfLeaving: '2026-04-30' },
        period: accrualPeriodFor(2026, APRIL, 1),
        leaveYearStartMonth: APRIL,
      }),
    ).toBe(0);
  });
});

describe('carryForward (REQ-G-01)', () => {
  it('lapses the whole balance when the type does not allow carry forward', () => {
    expect(carryForward({ carryForwardAllowed: false, carryForwardCap: null, closingBalance: 7 })).toEqual(
      { carried: 0, lapsed: 7 },
    );
  });

  it('carries everything when the type allows it with no cap', () => {
    expect(carryForward({ carryForwardAllowed: true, carryForwardCap: null, closingBalance: 7 })).toEqual(
      { carried: 7, lapsed: 0 },
    );
  });

  it('carries up to the cap and lapses the rest', () => {
    expect(carryForward({ carryForwardAllowed: true, carryForwardCap: 5, closingBalance: 7.5 })).toEqual({
      carried: 5,
      lapsed: 2.5,
    });
  });

  it('carries the whole balance when it is under the cap', () => {
    expect(carryForward({ carryForwardAllowed: true, carryForwardCap: 10, closingBalance: 3 })).toEqual({
      carried: 3,
      lapsed: 0,
    });
  });

  it('carries a negative balance in full and never lapses it (REQ-G-08)', () => {
    // A negative balance is a recovery item at exit. Lapsing it would quietly
    // forgive a debt the product exists to report.
    for (const allowed of [true, false]) {
      expect(
        carryForward({ carryForwardAllowed: allowed, carryForwardCap: 5, closingBalance: -2.5 }),
        String(allowed),
      ).toEqual({ carried: -2.5, lapsed: 0 });
    }
  });

  it('does nothing at all for a zero balance', () => {
    expect(carryForward({ carryForwardAllowed: true, carryForwardCap: 5, closingBalance: 0 })).toEqual({
      carried: 0,
      lapsed: 0,
    });
  });

  it('treats a cap of zero as carrying nothing, rather than as no cap', () => {
    expect(carryForward({ carryForwardAllowed: true, carryForwardCap: 0, closingBalance: 4 })).toEqual({
      carried: 0,
      lapsed: 4,
    });
  });

  it('always splits the closing balance exactly, over generated inputs', () => {
    for (let i = 0; i < 500; i += 1) {
      const closing = Math.round((i * 7919) % 10_000) / 100 - 20;
      const cap = i % 3 === 0 ? null : (i % 17) / 2;
      const outcome = carryForward({
        carryForwardAllowed: i % 2 === 0,
        carryForwardCap: cap,
        closingBalance: closing,
      });
      // Nothing may be created or destroyed at the boundary.
      expect(Math.round((outcome.carried + outcome.lapsed) * 100) / 100, String(closing)).toBe(
        Math.round(closing * 100) / 100,
      );
    }
  });
});
