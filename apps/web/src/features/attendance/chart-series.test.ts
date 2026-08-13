import { describe, expect, it } from 'vitest';

import type { AttendanceStatus } from '@vyuha/shared';

import {
  axisTicks,
  dateRange,
  hasValues,
  hourTicks,
  isExpectedWorkday,
  shortDate,
  statusBand,
  statusBands,
  timekeepingByDay,
  workedByDay,
} from './chart-series';
import type { AttendanceDay } from './types';

/**
 * The shaping functions, exercised with what the server can actually send:
 * dates outside the asked-for range, dates inside it with no row, negative
 * minutes, and a reversed range. Each of those has a defined answer here
 * because each of them silently produces a wrong-looking chart otherwise.
 */

function day(partial: Partial<AttendanceDay> & { date: string }): AttendanceDay {
  return {
    employee: { id: 'e1', name: 'Someone' },
    shiftName: 'General',
    scheduledIn: '09:00',
    scheduledOut: '18:00',
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
    otMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    status: 'PRESENT',
    flags: [],
    ...partial,
  };
}

describe('dateRange', () => {
  it('is inclusive at both ends', () => {
    expect(dateRange('2026-08-01', '2026-08-03')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('returns a single date when from equals to', () => {
    expect(dateRange('2026-08-01', '2026-08-01')).toEqual(['2026-08-01']);
  });

  it('returns nothing for a reversed range rather than throwing', () => {
    expect(dateRange('2026-08-03', '2026-08-01')).toEqual([]);
  });

  it('returns nothing for an unparseable date', () => {
    expect(dateRange('not-a-date', '2026-08-01')).toEqual([]);
  });

  it('caps a range longer than a year', () => {
    expect(dateRange('2020-01-01', '2026-01-01')).toHaveLength(366);
  });
});

describe('statusBand', () => {
  it('counts a half day and a duty day as work', () => {
    expect(statusBand('HALF_DAY')).toBe('work');
    expect(statusBand('ON_DUTY')).toBe('work');
    expect(statusBand('PRESENT')).toBe('work');
  });

  it('keeps a holiday out of absent', () => {
    expect(statusBand('HOLIDAY')).toBe('other');
    expect(statusBand('WEEKLY_OFF')).toBe('other');
    expect(statusBand('ABSENT')).toBe('absent');
  });

  it('has an answer for every status in the contract', () => {
    const statuses: AttendanceStatus[] = [
      'HOLIDAY',
      'WEEKLY_OFF',
      'ON_LEAVE',
      'PRESENT',
      'HALF_DAY',
      'ON_DUTY',
      'PENDING',
      'ABSENT',
    ];
    for (const status of statuses) expect(statusBand(status)).toBeDefined();
  });
});

describe('isExpectedWorkday', () => {
  it('excludes only the days nobody was expected', () => {
    expect(isExpectedWorkday('HOLIDAY')).toBe(false);
    expect(isExpectedWorkday('WEEKLY_OFF')).toBe(false);
    expect(isExpectedWorkday('ABSENT')).toBe(true);
    expect(isExpectedWorkday('ON_LEAVE')).toBe(true);
  });
});

describe('statusBands', () => {
  const dates = ['2026-08-01', '2026-08-02', '2026-08-03'];

  it('produces a zero point for a date with no row', () => {
    const points = statusBands([day({ date: '2026-08-01' })], dates);
    expect(points).toHaveLength(3);
    expect(points[1]).toEqual({ date: '2026-08-02', work: 0, leave: 0, absent: 0, other: 0 });
  });

  it('drops a row for a date outside the range', () => {
    const points = statusBands(
      [day({ date: '2026-09-30', status: 'ABSENT' }), day({ date: '2026-08-02' })],
      dates,
    );
    expect(points.map((point) => point.date)).toEqual(dates);
    expect(points.reduce((sum, point) => sum + point.absent, 0)).toBe(0);
    expect(points[1]?.work).toBe(1);
  });

  it('tallies several people on one date', () => {
    const points = statusBands(
      [
        day({ date: '2026-08-01', status: 'PRESENT' }),
        day({ date: '2026-08-01', status: 'HALF_DAY' }),
        day({ date: '2026-08-01', status: 'ABSENT' }),
        day({ date: '2026-08-01', status: 'HOLIDAY' }),
        day({ date: '2026-08-01', status: 'ON_LEAVE' }),
      ],
      dates,
    );
    expect(points[0]).toEqual({ date: '2026-08-01', work: 2, leave: 1, absent: 1, other: 1 });
  });

  it('returns nothing when asked for no dates', () => {
    expect(statusBands([day({ date: '2026-08-01' })], [])).toEqual([]);
  });
});

describe('workedByDay', () => {
  it('clamps a negative worked figure to zero', () => {
    const points = workedByDay([day({ date: '2026-08-01', workedMinutes: -30 })], ['2026-08-01']);
    expect(points[0]?.workedMinutes).toBe(0);
  });

  it('keeps overtime separate from worked minutes', () => {
    const points = workedByDay(
      [day({ date: '2026-08-01', workedMinutes: 540, otMinutes: 60 })],
      ['2026-08-01'],
    );
    expect(points[0]).toEqual({ date: '2026-08-01', workedMinutes: 540, otMinutes: 60 });
  });
});

describe('timekeepingByDay', () => {
  it('sums both ends of the day per date', () => {
    const points = timekeepingByDay(
      [
        day({ date: '2026-08-01', lateMinutes: 12, earlyExitMinutes: 0 }),
        day({ date: '2026-08-01', lateMinutes: 3, earlyExitMinutes: 45 }),
      ],
      ['2026-08-01'],
    );
    expect(points[0]).toEqual({ date: '2026-08-01', lateMinutes: 15, earlyExitMinutes: 45 });
  });

  it('treats a negative lateMinutes as not late rather than as early', () => {
    const points = timekeepingByDay(
      [day({ date: '2026-08-01', lateMinutes: -20 })],
      ['2026-08-01'],
    );
    expect(points[0]?.lateMinutes).toBe(0);
  });
});

describe('hasValues', () => {
  it('is false for a series of zeroes', () => {
    expect(hasValues([{ a: 0 }, { a: 0 }], ['a'])).toBe(false);
  });

  it('is true when any key on any point carries a value', () => {
    expect(hasValues([{ a: 0, b: 0 }, { a: 0, b: 2 }], ['a', 'b'])).toBe(true);
  });

  it('is false for an empty series', () => {
    expect(hasValues([], ['a'])).toBe(false);
  });
});

describe('axisTicks', () => {
  it('always keeps the first and last date', () => {
    const dates = dateRange('2026-08-01', '2026-08-30');
    const ticks = axisTicks(dates, 5);
    expect(ticks[0]).toBe('2026-08-01');
    expect(ticks.at(-1)).toBe('2026-08-30');
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it('returns every date when there are fewer than the cap', () => {
    expect(axisTicks(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('handles an empty list and a nonsense cap', () => {
    expect(axisTicks([], 5)).toEqual([]);
    expect(axisTicks(['a', 'b', 'c'], 1)).toEqual(['a']);
  });
});

describe('hourTicks', () => {
  it('lands every tick on a whole number of hours', () => {
    const { ticks } = hourTicks(545);
    expect(ticks.every((tick) => tick % 60 === 0)).toBe(true);
  });

  it('never returns a zero domain for an empty chart', () => {
    expect(hourTicks(0).domainMax).toBeGreaterThan(0);
    expect(hourTicks(-100).domainMax).toBeGreaterThan(0);
  });

  it('widens the step past twelve hours', () => {
    expect(hourTicks(800).ticks).toContain(720);
  });
});

describe('shortDate', () => {
  it('writes a date the way an axis has room for', () => {
    expect(shortDate('2026-08-13')).toBe('13 Aug');
  });

  it('hands back anything it cannot parse rather than printing Invalid Date', () => {
    expect(shortDate('nonsense')).toBe('nonsense');
  });
});
