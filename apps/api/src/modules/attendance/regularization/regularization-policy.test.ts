import { describe, expect, it } from 'vitest';

import {
  earliestRegularizableDate,
  monthBounds,
  refusalMessage,
  refuseRegularization,
  type RegularizationAttempt,
} from './regularization-policy.js';

/**
 * REQ-F-02's two limits, at their edges.
 *
 * The interesting cases here are all off-by-one: the oldest date still inside
 * the window, the count that is exactly the cap, and a month boundary. Each
 * one was falsified before being kept -- flipping `>=` to `>` in the cap check
 * fails "already at the cap", and dropping the `- 1` from the window fails
 * "the oldest day in the window is allowed".
 */

const base: RegularizationAttempt = {
  date: '2026-08-14',
  today: '2026-08-14',
  windowDays: 7,
  maxPerMonth: 3,
  raisedThisMonth: 0,
  dateOfJoining: '2020-01-01',
};

describe('the window (REQ-F-02, days back)', () => {
  it('counts today as one of the days', () => {
    // 7 days back from the 14th reaches the 8th, not the 7th: the 8th to the
    // 14th inclusive is seven dates.
    expect(earliestRegularizableDate({ today: '2026-08-14', windowDays: 7 })).toBe('2026-08-08');
  });

  it('allows the oldest day inside the window', () => {
    expect(refuseRegularization({ ...base, date: '2026-08-08' })).toBeNull();
  });

  it('refuses the day before it', () => {
    expect(refuseRegularization({ ...base, date: '2026-08-07' })).toBe('OUTSIDE_WINDOW');
  });

  it('allows today itself', () => {
    expect(refuseRegularization({ ...base, date: '2026-08-14' })).toBeNull();
  });

  it('treats a window of 1 as today only', () => {
    expect(refuseRegularization({ ...base, windowDays: 1, date: '2026-08-14' })).toBeNull();
    expect(refuseRegularization({ ...base, windowDays: 1, date: '2026-08-13' })).toBe(
      'OUTSIDE_WINDOW',
    );
  });

  it('crosses a month boundary by the calendar, not by arithmetic on the day', () => {
    // 7 days back from 3 March 2026 reaches 25 February. February 2026 has 28
    // days, and nothing here knows that -- `addDays` goes through a UTC
    // instant so the runtime supplies it.
    expect(earliestRegularizableDate({ today: '2026-03-03', windowDays: 7 })).toBe('2026-02-25');
  });

  it('crosses a leap day', () => {
    expect(earliestRegularizableDate({ today: '2028-03-02', windowDays: 4 })).toBe('2028-02-28');
  });
});

describe('a date that is not in the past', () => {
  it('refuses tomorrow as a future date rather than as an old one', () => {
    // The distinction matters to the reader: "outside the window" would send
    // them to the wrong setting.
    expect(refuseRegularization({ ...base, date: '2026-08-15' })).toBe('FUTURE_DATE');
  });

  it('refuses a date before the employee joined', () => {
    expect(
      refuseRegularization({ ...base, date: '2026-08-10', dateOfJoining: '2026-08-12' }),
    ).toBe('BEFORE_JOINING');
  });

  it('puts the future check ahead of the joining check', () => {
    // Both are true for somebody hired next month; the future one is the more
    // useful thing to say.
    expect(
      refuseRegularization({ ...base, date: '2026-09-01', dateOfJoining: '2026-08-20' }),
    ).toBe('FUTURE_DATE');
  });
});

describe('the monthly cap (REQ-F-02, count per month)', () => {
  it('allows the last one under the cap', () => {
    expect(refuseRegularization({ ...base, raisedThisMonth: 2 })).toBeNull();
  });

  it('refuses once the cap is reached', () => {
    expect(refuseRegularization({ ...base, raisedThisMonth: 3 })).toBe('MONTHLY_CAP_REACHED');
  });

  it('refuses beyond the cap, which a repair script could produce', () => {
    expect(refuseRegularization({ ...base, raisedThisMonth: 9 })).toBe('MONTHLY_CAP_REACHED');
  });

  it('treats a cap of zero as the feature being off', () => {
    expect(refuseRegularization({ ...base, maxPerMonth: 0, raisedThisMonth: 0 })).toBe(
      'MONTHLY_CAP_REACHED',
    );
    expect(refusalMessage('MONTHLY_CAP_REACHED', { ...base, maxPerMonth: 0 })).toContain(
      'switched off',
    );
  });

  it('checks the window before the cap', () => {
    // An employee at their cap asking about a date three weeks ago should be
    // told about the date, which is the thing they can do nothing about.
    expect(
      refuseRegularization({ ...base, date: '2026-07-20', raisedThisMonth: 3 }),
    ).toBe('OUTSIDE_WINDOW');
  });
});

describe('the month the cap is counted over', () => {
  it('bounds a 31-day month', () => {
    expect(monthBounds('2026-08-14')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('bounds a 30-day month', () => {
    expect(monthBounds('2026-04-02')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  it('bounds February in a non-leap year', () => {
    expect(monthBounds('2026-02-28')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('bounds February in a leap year', () => {
    expect(monthBounds('2028-02-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('rolls the year over from December', () => {
    expect(monthBounds('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('the message states the settings in force', () => {
  it('quotes the configured window, not the default', () => {
    const message = refusalMessage('OUTSIDE_WINDOW', {
      date: '2026-01-01',
      today: '2026-08-14',
      windowDays: 30,
      maxPerMonth: 3,
    });
    expect(message).toContain('30');
    expect(message).toContain('2026-07-16');
    expect(message).not.toContain(' 7 day');
  });

  it('quotes the configured cap, not the default', () => {
    expect(
      refusalMessage('MONTHLY_CAP_REACHED', {
        date: '2026-08-14',
        today: '2026-08-14',
        windowDays: 7,
        maxPerMonth: 10,
      }),
    ).toContain('10');
  });

  it('has prose for every refusal it can return', () => {
    // A refusal with no message would reach the employee as "undefined".
    const attempt = { date: '2026-08-14', today: '2026-08-14', windowDays: 7, maxPerMonth: 3 };
    for (const refusal of [
      'OUTSIDE_WINDOW',
      'FUTURE_DATE',
      'MONTHLY_CAP_REACHED',
      'PERIOD_LOCKED',
      'ALREADY_PENDING',
      'BEFORE_JOINING',
    ] as const) {
      expect(refusalMessage(refusal, attempt).length).toBeGreaterThan(10);
    }
  });
});
