import { describe, expect, it } from 'vitest';

import { occurrenceInMonth, parseCalendarDate } from './calendar-date.js';
import { matchesWeeklyOff, parseWeeklyOffConfig } from './weekly-off.js';

/**
 * The calendar half of the day engine, and the boundary where a jsonb column
 * becomes a policy. `compute-day.test.ts` exercises these through whole days;
 * this file goes at them directly, mostly with input they are not expecting.
 */

const PATTERN_ID = '01900000-0000-7000-8000-00000000f001';

describe('parseCalendarDate', () => {
  it('reads a well-formed date and its ISO weekday', () => {
    expect(parseCalendarDate('2026-03-10')).toEqual({
      year: 2026,
      month: 3,
      day: 10,
      isoWeekday: 2,
    });
    // Sunday is 7, not 0. Getting this wrong would make every Sunday pattern
    // silently match nothing.
    expect(parseCalendarDate('2026-03-08').isoWeekday).toBe(7);
    expect(parseCalendarDate('2026-03-09').isoWeekday).toBe(1);
  });

  it('handles a leap day', () => {
    expect(parseCalendarDate('2028-02-29').day).toBe(29);
  });

  it.each([
    ['an unpadded month', '2026-3-10'],
    ['a two-digit year', '26-03-10'],
    ['a timestamp', '2026-03-10T00:00:00Z'],
    ['empty', ''],
    ['prose', 'yesterday'],
  ])('rejects %s', (_label, value) => {
    expect(() => parseCalendarDate(value)).toThrow(/YYYY-MM-DD/u);
  });

  it.each([
    ['a day the month does not have', '2026-02-30'],
    ['a leap day in a non-leap year', '2026-02-29'],
    ['month zero', '2026-00-10'],
    ['month thirteen', '2026-13-01'],
    ['day zero', '2026-03-00'],
  ])('rejects %s rather than rolling it over', (_label, value) => {
    // Date.UTC would happily turn 2026-02-30 into 2 March, and the day engine
    // would then compute somebody's attendance for the wrong date.
    expect(() => parseCalendarDate(value)).toThrow(/not a real calendar date/u);
  });
});

describe('occurrenceInMonth', () => {
  it.each([
    [1, 1],
    [7, 1],
    [8, 2],
    [14, 2],
    [15, 3],
    [21, 3],
    [22, 4],
    [28, 4],
    [29, 5],
  ])('day %i of the month is occurrence %i of its weekday', (day, expected) => {
    const date = parseCalendarDate(`2026-03-${String(day).padStart(2, '0')}`);
    expect(occurrenceInMonth(date)).toBe(expected);
  });
});

describe('parseWeeklyOffConfig', () => {
  it('accepts the two shapes REQ-C-03 describes', () => {
    expect(parseWeeklyOffConfig({ weekdays: [7] }, PATTERN_ID)).toEqual({ weekdays: [7] });
    expect(parseWeeklyOffConfig({ weekdays: [7], saturdaysOfMonth: [2, 4] }, PATTERN_ID)).toEqual({
      weekdays: [7],
      saturdaysOfMonth: [2, 4],
    });
  });

  it.each([
    ['null', null],
    ['a string', 'sundays'],
    ['an array', [7]],
    ['no weekdays key', {}],
    ['weekday zero', { weekdays: [0] }],
    ['weekday eight', { weekdays: [8] }],
    ['a fractional weekday', { weekdays: [1.5] }],
    ['a weekday as text', { weekdays: ['7'] }],
    ['a sixth Saturday', { weekdays: [7], saturdaysOfMonth: [6] }],
    ['an unknown key', { weekdays: [7], alternateFridays: true }],
  ])('refuses %s rather than reading it as "no days off"', (_label, value) => {
    // The failure mode this prevents: a pattern nobody can read becomes an
    // empty pattern, and a month of people are marked ABSENT on their day off
    // with nothing in the log to say why.
    expect(() => parseWeeklyOffConfig(value, PATTERN_ID)).toThrow(/malformed/u);
  });

  it('names the offending row so it can be found', () => {
    expect(() => parseWeeklyOffConfig({ weekdays: [9] }, PATTERN_ID)).toThrow(PATTERN_ID);
  });
});

describe('matchesWeeklyOff', () => {
  it('matches a fixed weekday', () => {
    const config = parseWeeklyOffConfig({ weekdays: [6, 7] }, PATTERN_ID);
    expect(matchesWeeklyOff(config, '2026-03-07')).toBe(true);
    expect(matchesWeeklyOff(config, '2026-03-08')).toBe(true);
    expect(matchesWeeklyOff(config, '2026-03-09')).toBe(false);
  });

  it('applies the alternate-Saturday rule only to Saturdays', () => {
    const config = parseWeeklyOffConfig(
      { weekdays: [7], saturdaysOfMonth: [2, 4] },
      PATTERN_ID,
    );

    // March 2026: Saturdays fall on the 7th, 14th, 21st and 28th.
    expect(matchesWeeklyOff(config, '2026-03-07')).toBe(false);
    expect(matchesWeeklyOff(config, '2026-03-14')).toBe(true);
    expect(matchesWeeklyOff(config, '2026-03-21')).toBe(false);
    expect(matchesWeeklyOff(config, '2026-03-28')).toBe(true);

    // The 11th is a Wednesday. Without the weekday guard, `occurrenceInMonth`
    // would say "the 2nd Wednesday" and this would read as an off day.
    expect(matchesWeeklyOff(config, '2026-03-11')).toBe(false);
  });

  it('treats every Saturday off as a weekday rule, not a Saturday rule', () => {
    const config = parseWeeklyOffConfig({ weekdays: [6] }, PATTERN_ID);
    expect(matchesWeeklyOff(config, '2026-03-07')).toBe(true);
    expect(matchesWeeklyOff(config, '2026-03-14')).toBe(true);
  });

  it('matches nothing when the pattern says nothing', () => {
    const config = parseWeeklyOffConfig({ weekdays: [] }, PATTERN_ID);
    expect(matchesWeeklyOff(config, '2026-03-07')).toBe(false);
    expect(matchesWeeklyOff(config, '2026-03-08')).toBe(false);
  });

  it('can mark a fifth Saturday off', () => {
    // August 2026 has five Saturdays: 1, 8, 15, 22, 29.
    const config = parseWeeklyOffConfig({ weekdays: [], saturdaysOfMonth: [5] }, PATTERN_ID);
    expect(parseCalendarDate('2026-08-29').isoWeekday).toBe(6);
    expect(matchesWeeklyOff(config, '2026-08-29')).toBe(true);
    expect(matchesWeeklyOff(config, '2026-08-22')).toBe(false);
  });
});
