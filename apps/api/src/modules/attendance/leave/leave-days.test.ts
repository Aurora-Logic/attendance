import { describe, expect, it } from 'vitest';

import { MAX_LEAVE_RANGE_DAYS, expandLeaveDays } from './leave-days.js';

/**
 * REQ-G-06 and REQ-G-07.
 *
 * The calendar the cases below are written against, chosen because it contains
 * every shape the rule has to handle in one week:
 *
 *   Thu 2026-03-12  working
 *   Fri 2026-03-13  working
 *   Sat 2026-03-14  weekly off
 *   Sun 2026-03-15  weekly off
 *   Mon 2026-03-16  HOLIDAY
 *   Tue 2026-03-17  working
 *   Wed 2026-03-18  working
 */

const HOLIDAYS = new Set(['2026-03-16']);
const WEEKLY_OFFS = new Set(['2026-03-14', '2026-03-15', '2026-03-21', '2026-03-22']);

function expand(options: {
  from: string;
  to: string;
  countsSandwichDays?: boolean;
  fromPortion?: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';
  toPortion?: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';
}) {
  return expandLeaveDays({
    fromDate: options.from,
    toDate: options.to,
    fromPortion: options.fromPortion ?? 'FULL',
    toPortion: options.toPortion ?? 'FULL',
    isHoliday: (date) => HOLIDAYS.has(date),
    isWeeklyOff: (date) => WEEKLY_OFFS.has(date),
    countsSandwichDays: options.countsSandwichDays ?? false,
  });
}

describe('a leave spanning a weekend and a holiday', () => {
  it('consumes only the working days when the type does not count sandwich days', () => {
    // Thu 12th to Wed 18th: seven calendar days, two weekly offs and a holiday
    // in the middle, so four working days are consumed.
    const result = expand({ from: '2026-03-12', to: '2026-03-18' });

    expect(result.calendarDays).toBe(7);
    expect(result.totalDays).toBe(4);
    expect(result.workingDays).toBe(4);
    expect(result.weeklyOffsSkipped).toBe(2);
    expect(result.holidaysSkipped).toBe(1);
    expect(result.sandwichDaysCounted).toBe(0);

    // The skipped days are still recorded, marked uncounted -- the day engine
    // reads `is_counted` and a missing row would leave those dates unexplained.
    expect(result.days).toHaveLength(7);
    expect(result.days.filter((day) => !day.isCounted).map((day) => day.date)).toEqual([
      '2026-03-14',
      '2026-03-15',
      '2026-03-16',
    ]);
  });

  it('consumes all seven when the type does count sandwich days', () => {
    const result = expand({ from: '2026-03-12', to: '2026-03-18', countsSandwichDays: true });

    expect(result.totalDays).toBe(7);
    expect(result.sandwichDaysCounted).toBe(3);
    expect(result.weeklyOffsSkipped).toBe(0);
    expect(result.holidaysSkipped).toBe(0);
    expect(result.days.every((day) => day.isCounted)).toBe(true);
  });

  it('does not count a trailing weekend even for a sandwich type, because it is not sandwiched', () => {
    // Fri 13th to Sun 15th. The weekend is at the end of the range, so there is
    // no leave day after it to sandwich it against.
    const result = expand({ from: '2026-03-13', to: '2026-03-15', countsSandwichDays: true });

    expect(result.totalDays).toBe(1);
    expect(result.sandwichDaysCounted).toBe(0);
    expect(result.weeklyOffsSkipped).toBe(2);
  });

  it('does not count a leading weekend for a sandwich type either', () => {
    const result = expand({ from: '2026-03-14', to: '2026-03-17', countsSandwichDays: true });

    expect(result.totalDays).toBe(1);
    expect(result.sandwichDaysCounted).toBe(0);
    expect(result.weeklyOffsSkipped).toBe(2);
    expect(result.holidaysSkipped).toBe(1);
  });

  it('counts nothing when the whole range is non-working, whatever the flag says', () => {
    for (const countsSandwichDays of [false, true]) {
      const result = expand({ from: '2026-03-14', to: '2026-03-16', countsSandwichDays });
      expect(result.totalDays, String(countsSandwichDays)).toBe(0);
      expect(result.workingDays, String(countsSandwichDays)).toBe(0);
      expect(result.days.every((day) => !day.isCounted)).toBe(true);
    }
  });

  it('reports a day that is both a holiday and a weekly off once', () => {
    const result = expandLeaveDays({
      fromDate: '2026-03-14',
      toDate: '2026-03-14',
      fromPortion: 'FULL',
      toPortion: 'FULL',
      isHoliday: () => true,
      isWeeklyOff: () => true,
      countsSandwichDays: false,
    });

    expect(result.calendarDays).toBe(1);
    expect(result.holidaysSkipped).toBe(1);
    expect(result.weeklyOffsSkipped).toBe(0);
  });
});

describe('half days (REQ-G-06)', () => {
  it('counts a single-day half-day application as 0.5, not 0', () => {
    const result = expand({
      from: '2026-03-12',
      to: '2026-03-12',
      fromPortion: 'FIRST_HALF',
      toPortion: 'FIRST_HALF',
    });

    expect(result.totalDays).toBe(0.5);
    expect(result.halfDays).toBe(1);
    expect(result.days[0]?.portion).toBe('FIRST_HALF');
  });

  it('halves both boundaries of a multi-day range independently', () => {
    const result = expand({
      from: '2026-03-12',
      to: '2026-03-18',
      fromPortion: 'SECOND_HALF',
      toPortion: 'FIRST_HALF',
    });

    // Four working days, two of them halved.
    expect(result.totalDays).toBe(3);
    expect(result.halfDays).toBe(2);
    expect(result.days[0]?.portion).toBe('SECOND_HALF');
    expect(result.days.at(-1)?.portion).toBe('FIRST_HALF');
  });

  it('leaves a sandwiched day whole even when a boundary is halved', () => {
    const result = expand({
      from: '2026-03-13',
      to: '2026-03-17',
      countsSandwichDays: true,
      fromPortion: 'SECOND_HALF',
    });

    // Fri half + Sat + Sun + Mon holiday + Tue = 4.5.
    expect(result.totalDays).toBe(4.5);
    const sandwiched = result.days.filter((day) => day.nonWorking !== null);
    expect(sandwiched).toHaveLength(3);
    expect(sandwiched.every((day) => day.portion === 'FULL')).toBe(true);
  });
});

describe('range validation', () => {
  it('refuses a range that ends before it starts', () => {
    expect(() => expand({ from: '2026-03-18', to: '2026-03-12' })).toThrow(/ends before it starts/u);
  });

  it('refuses a range longer than a year rather than expanding it', () => {
    expect(() => expand({ from: '2026-01-01', to: '2028-01-01' })).toThrow(
      new RegExp(`may not exceed ${String(MAX_LEAVE_RANGE_DAYS)} days`, 'u'),
    );
  });

  it('refuses a date that is not a real calendar date', () => {
    expect(() => expand({ from: '2026-02-30', to: '2026-02-30' })).toThrow(
      /not a real calendar date/u,
    );
  });

  it('crosses a month and a year end without dropping a day', () => {
    const result = expandLeaveDays({
      fromDate: '2026-12-30',
      toDate: '2027-01-02',
      fromPortion: 'FULL',
      toPortion: 'FULL',
      isHoliday: () => false,
      isWeeklyOff: () => false,
      countsSandwichDays: false,
    });

    expect(result.days.map((day) => day.date)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(result.totalDays).toBe(4);
  });

  it('handles the leap day', () => {
    const result = expandLeaveDays({
      fromDate: '2028-02-28',
      toDate: '2028-03-01',
      fromPortion: 'FULL',
      toPortion: 'FULL',
      isHoliday: () => false,
      isWeeklyOff: () => false,
      countsSandwichDays: false,
    });

    expect(result.days.map((day) => day.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });
});
