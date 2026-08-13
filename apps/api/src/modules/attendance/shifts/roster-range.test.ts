import { describe, expect, it } from 'vitest';

import {
  affectedWindow,
  computedWindow,
  eachDate,
  inclusiveDayCount,
  monthsInRange,
  parseDate,
  rangesOverlap,
  todayIn,
} from './roster-range.js';

/**
 * The date arithmetic REQ-C-04 to REQ-C-06 rest on.
 *
 * `rangesOverlap` gets the most attention because it is the one function here
 * that has a second implementation: the SQL in `RosterRepository.findOverlapping`
 * and, underneath both, the `daterange(..., '[]') &&` inside
 * `shift_assignments_no_overlap`. Three copies of one rule is two chances to
 * disagree, so the truth table below is exhaustive over the shapes that can
 * differ, and `shifts.endpoints.test.ts` runs the same pairs through Postgres
 * to prove the answers match rather than merely being self-consistent.
 */

describe('rangesOverlap (REQ-C-04)', () => {
  const cases: [string, { from: string; to: string | null }, { from: string; to: string | null }, boolean][] = [
    ['identical', { from: '2026-03-10', to: '2026-03-20' }, { from: '2026-03-10', to: '2026-03-20' }, true],
    ['disjoint, left first', { from: '2026-03-01', to: '2026-03-05' }, { from: '2026-03-06', to: '2026-03-10' }, false],
    ['disjoint, right first', { from: '2026-03-06', to: '2026-03-10' }, { from: '2026-03-01', to: '2026-03-05' }, false],
    // The inclusive end is the case a half-open range gets wrong, and it is
    // the one a roster hits every time somebody ends a cover on the day the
    // next one starts.
    ['touching at the end date', { from: '2026-03-01', to: '2026-03-10' }, { from: '2026-03-10', to: '2026-03-20' }, true],
    ['adjacent by one day', { from: '2026-03-01', to: '2026-03-09' }, { from: '2026-03-10', to: '2026-03-20' }, false],
    ['contained', { from: '2026-03-01', to: '2026-03-31' }, { from: '2026-03-10', to: '2026-03-12' }, true],
    ['containing', { from: '2026-03-10', to: '2026-03-12' }, { from: '2026-03-01', to: '2026-03-31' }, true],
    ['single day inside', { from: '2026-03-15', to: '2026-03-15' }, { from: '2026-03-01', to: '2026-03-31' }, true],
    ['single day outside', { from: '2026-04-15', to: '2026-04-15' }, { from: '2026-03-01', to: '2026-03-31' }, false],
    ['open-ended left swallows a later range', { from: '2026-03-01', to: null }, { from: '2027-01-01', to: '2027-01-31' }, true],
    ['open-ended left, earlier range', { from: '2026-03-01', to: null }, { from: '2026-01-01', to: '2026-02-28' }, false],
    ['open-ended right swallows a later range', { from: '2026-01-01', to: '2026-02-28' }, { from: '2026-03-01', to: null }, false],
    ['both open-ended', { from: '2026-03-01', to: null }, { from: '2030-01-01', to: null }, true],
    ['open-ended meeting its own start', { from: '2026-03-13', to: '2026-03-13' }, { from: '2026-03-13', to: null }, true],
  ];

  it.each(cases)('%s', (_label, left, right, expected) => {
    expect(rangesOverlap(left, right)).toBe(expected);
    // Overlap is symmetric. An implementation that got one direction right and
    // the other wrong would pass half a suite written only one way round.
    expect(rangesOverlap(right, left)).toBe(expected);
  });
});

describe('inclusiveDayCount (REQ-C-05 employee-days)', () => {
  it.each([
    ['one day', '2026-03-10', '2026-03-10', 1],
    ['two days', '2026-03-10', '2026-03-11', 2],
    ['a whole March', '2026-03-01', '2026-03-31', 31],
    ['across a month boundary', '2026-03-30', '2026-04-02', 4],
    // 2028 is a leap year; a naive month-length table gets this one wrong and
    // the preview under-counts by a day.
    ['across a leap day', '2028-02-27', '2028-03-01', 4],
    ['across a year boundary', '2026-12-30', '2027-01-02', 4],
    ['reversed is zero, never negative', '2026-03-11', '2026-03-10', 0],
  ])('%s', (_label, from, to, expected) => {
    expect(inclusiveDayCount(from, to)).toBe(expected);
  });

  /**
   * India observes no daylight saving, but the count must not depend on that.
   * Doing this arithmetic in local time would drop or double a day wherever a
   * clock change fell inside the range, which is a day of somebody's
   * attendance appearing or vanishing from a preview.
   */
  it('counts calendar days across a DST transition', () => {
    // 29 March 2026 is when the clocks go forward in most of Europe.
    expect(inclusiveDayCount('2026-03-28', '2026-03-30')).toBe(3);
    expect(eachDate('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });
});

describe('parseDate', () => {
  it('rejects a date that is not a real day', () => {
    expect(() => parseDate('2026-02-30', 'from')).toThrow(/not a real calendar date/u);
    expect(() => parseDate('2026-13-01', 'from')).toThrow(/not a real calendar date/u);
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(() => parseDate('10-03-2026', 'from')).toThrow(/YYYY-MM-DD/u);
    expect(() => parseDate('2026-3-1', 'from')).toThrow(/YYYY-MM-DD/u);
  });

  it('accepts a leap day that exists', () => {
    expect(parseDate('2028-02-29', 'from')).toEqual({ year: 2028, month: 2, day: 29 });
  });
});

describe('affectedWindow (REQ-C-06)', () => {
  it('spans the old range and the new one', () => {
    // Narrowing: the days between the new end and the old one are uncovered
    // and must still be recomputed, which is what the union buys.
    expect(
      affectedWindow([
        { from: '2026-03-01', to: '2026-03-31' },
        { from: '2026-03-01', to: '2026-03-10' },
      ]),
    ).toEqual({ from: '2026-03-01', to: '2026-03-31' });
  });

  it('stays open-ended if either range is', () => {
    expect(
      affectedWindow([
        { from: '2026-03-05', to: '2026-03-10' },
        { from: '2026-03-01', to: null },
      ]),
    ).toEqual({ from: '2026-03-01', to: null });
  });

  it('is null for no ranges', () => {
    expect(affectedWindow([])).toBeNull();
  });
});

describe('computedWindow (REQ-E-01 bounds the recompute)', () => {
  const today = '2026-08-13';

  it('caps an open-ended range at today', () => {
    expect(computedWindow({ from: '2026-08-01', to: null }, today)).toEqual({
      from: '2026-08-01',
      to: today,
    });
  });

  it('caps a future end at today', () => {
    expect(computedWindow({ from: '2026-08-01', to: '2027-01-01' }, today)).toEqual({
      from: '2026-08-01',
      to: today,
    });
  });

  it('leaves a past range alone', () => {
    expect(computedWindow({ from: '2026-01-01', to: '2026-01-31' }, today)).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('is null when the whole range is in the future', () => {
    // Nothing has been computed, so nothing is stale and no lock applies.
    expect(computedWindow({ from: '2026-09-01', to: null }, today)).toBeNull();
  });
});

describe('monthsInRange (the period-lock check)', () => {
  it('lists every month a range touches, inclusive', () => {
    expect(monthsInRange('2026-11-28', '2027-02-02')).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ]);
  });

  it('returns the single month for a one-day range', () => {
    expect(monthsInRange('2026-03-10', '2026-03-10')).toEqual([{ year: 2026, month: 3 }]);
  });
});

describe('todayIn', () => {
  /**
   * The date boundary is the office's, not the server's. At 23:00 UTC it is
   * already tomorrow in Kolkata, and a recompute window that used the server's
   * date would skip the day that had just begun there.
   */
  it('reads the date in the named zone, not the process zone', () => {
    const lateUtc = new Date('2026-03-10T23:00:00Z');
    expect(todayIn('UTC', lateUtc)).toBe('2026-03-10');
    expect(todayIn('Asia/Kolkata', lateUtc)).toBe('2026-03-11');
    expect(todayIn('America/Los_Angeles', lateUtc)).toBe('2026-03-10');
  });
});
