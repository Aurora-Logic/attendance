import { describe, expect, it } from 'vitest';

import type { AttendanceDay } from '@/features/attendance/types';

import {
  absenceByWeekday,
  attendanceRate,
  concentration,
  flagVolume,
  headcountByDepartment,
  lateSpread,
  overtimeLeaders,
  periodTotals,
  punchSources,
  repeatLate,
} from './series';
import type { PunchRow, RosterRow } from './use-analytics-data';

/**
 * The shaping functions, given what a server actually sends: dates outside the
 * asked-for range, statuses that must stay out of a denominator, ties, empty
 * inputs, and an overtime figure the server withheld. Each of those otherwise
 * produces a chart that is wrong in a way nobody can see.
 */

function day(partial: Partial<AttendanceDay> & { date: string }): AttendanceDay {
  return {
    employee: { id: 'e1', name: 'Anita Rao' },
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

function punch(partial: Partial<PunchRow> = {}): PunchRow {
  return {
    id: 'p1',
    attendanceDate: '2026-08-12',
    type: 'IN',
    source: 'WEB',
    flags: [],
    ...partial,
  };
}

function person(partial: Partial<RosterRow> = {}): RosterRow {
  return {
    id: 'e1',
    employeeCode: 'VY-0001',
    employmentType: 'PERMANENT',
    status: 'ACTIVE',
    department: { id: 'd1', name: 'Engineering' },
    ...partial,
  };
}

describe('attendanceRate', () => {
  const dates = ['2026-08-03', '2026-08-04'];

  it('is the share of expected people who were at work', () => {
    const points = attendanceRate(
      [
        day({ date: '2026-08-03', status: 'PRESENT' }),
        day({ date: '2026-08-03', status: 'HALF_DAY', employee: { id: 'e2', name: 'B' } }),
        day({ date: '2026-08-03', status: 'ABSENT', employee: { id: 'e3', name: 'C' } }),
        day({ date: '2026-08-03', status: 'ON_LEAVE', employee: { id: 'e4', name: 'D' } }),
      ],
      dates,
    );
    expect(points[0]).toEqual({ date: '2026-08-03', rate: 50, atWork: 2, expected: 4 });
  });

  it('keeps holidays and weekly offs out of the denominator', () => {
    const points = attendanceRate(
      [
        day({ date: '2026-08-03', status: 'PRESENT' }),
        day({ date: '2026-08-03', status: 'HOLIDAY', employee: { id: 'e2', name: 'B' } }),
        day({ date: '2026-08-03', status: 'WEEKLY_OFF', employee: { id: 'e3', name: 'C' } }),
      ],
      dates,
    );
    expect(points[0]).toEqual({ date: '2026-08-03', rate: 100, atWork: 1, expected: 1 });
  });

  it('reports null rather than zero for a day nobody was expected', () => {
    const points = attendanceRate([day({ date: '2026-08-03', status: 'HOLIDAY' })], dates);
    expect(points[0]?.rate).toBeNull();
    expect(points[1]?.rate).toBeNull();
  });

  it('drops a row for a date outside the range', () => {
    const points = attendanceRate([day({ date: '2026-12-25', status: 'ABSENT' })], dates);
    expect(points.every((point) => point.expected === 0)).toBe(true);
  });

  it('rounds to one decimal place', () => {
    const points = attendanceRate(
      [
        day({ date: '2026-08-03', status: 'PRESENT' }),
        day({ date: '2026-08-03', status: 'ABSENT', employee: { id: 'e2', name: 'B' } }),
        day({ date: '2026-08-03', status: 'ABSENT', employee: { id: 'e3', name: 'C' } }),
      ],
      dates,
    );
    expect(points[0]?.rate).toBe(33.3);
  });
});

describe('absenceByWeekday', () => {
  it('reads Monday first and covers all seven days', () => {
    const points = absenceByWeekday([]);
    expect(points.map((point) => point.weekday)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
  });

  it('is a rate, so an uneven number of each weekday does not skew it', () => {
    // Two Mondays, one absent. One Tuesday, one absent.
    const points = absenceByWeekday([
      day({ date: '2026-08-03', status: 'ABSENT' }),
      day({ date: '2026-08-10', status: 'PRESENT' }),
      day({ date: '2026-08-04', status: 'ABSENT' }),
    ]);
    const monday = points.find((point) => point.weekday === 'Mon');
    const tuesday = points.find((point) => point.weekday === 'Tue');
    expect(monday).toEqual({ weekday: 'Mon', rate: 50, absent: 1, expected: 2 });
    expect(tuesday).toEqual({ weekday: 'Tue', rate: 100, absent: 1, expected: 1 });
  });

  it('reports null for a weekday nobody was expected on', () => {
    const points = absenceByWeekday([day({ date: '2026-08-09', status: 'WEEKLY_OFF' })]);
    expect(points.find((point) => point.weekday === 'Sun')?.rate).toBeNull();
  });

  it('ignores an unparseable date rather than throwing', () => {
    expect(() => absenceByWeekday([day({ date: 'not-a-date', status: 'ABSENT' })])).not.toThrow();
  });
});

describe('lateSpread', () => {
  it('puts each late day in exactly one bucket', () => {
    const buckets = lateSpread([
      day({ date: '2026-08-03', lateMinutes: 1 }),
      day({ date: '2026-08-03', lateMinutes: 5 }),
      day({ date: '2026-08-03', lateMinutes: 6 }),
      day({ date: '2026-08-03', lateMinutes: 30 }),
      day({ date: '2026-08-03', lateMinutes: 61 }),
      day({ date: '2026-08-03', lateMinutes: 600 }),
    ]);
    expect(buckets.map((bucket) => bucket.days)).toEqual([2, 1, 1, 0, 2]);
  });

  it('ignores days that were not late, including negative minutes', () => {
    const buckets = lateSpread([
      day({ date: '2026-08-03', lateMinutes: 0 }),
      day({ date: '2026-08-03', lateMinutes: -30 }),
    ]);
    expect(buckets.every((bucket) => bucket.days === 0)).toBe(true);
  });

  it('always returns every bucket so the axis does not renumber', () => {
    expect(lateSpread([])).toHaveLength(5);
  });
});

describe('repeatLate', () => {
  it('counts late days rather than late minutes', () => {
    const points = repeatLate([
      day({ date: '2026-08-03', lateMinutes: 90, employee: { id: 'e1', name: 'One big' } }),
      day({ date: '2026-08-03', lateMinutes: 4, employee: { id: 'e2', name: 'Habitual' } }),
      day({ date: '2026-08-04', lateMinutes: 4, employee: { id: 'e2', name: 'Habitual' } }),
      day({ date: '2026-08-05', lateMinutes: 4, employee: { id: 'e2', name: 'Habitual' } }),
    ]);
    expect(points).toEqual([
      { name: 'Habitual', value: 3 },
      { name: 'One big', value: 1 },
    ]);
  });

  it('breaks ties by name so a refetch cannot reorder the chart', () => {
    const points = repeatLate([
      day({ date: '2026-08-03', lateMinutes: 5, employee: { id: 'e2', name: 'Zara' } }),
      day({ date: '2026-08-03', lateMinutes: 5, employee: { id: 'e1', name: 'Amit' } }),
    ]);
    expect(points.map((point) => point.name)).toEqual(['Amit', 'Zara']);
  });

  it('honours the limit', () => {
    const days = Array.from({ length: 12 }, (_, index) =>
      day({ date: '2026-08-03', lateMinutes: 5, employee: { id: `e${String(index)}`, name: `P${String(index)}` } }),
    );
    expect(repeatLate(days, 3)).toHaveLength(3);
  });

  it('returns nothing when nobody was late', () => {
    expect(repeatLate([day({ date: '2026-08-03' })])).toEqual([]);
  });
});

describe('overtimeLeaders and concentration', () => {
  const days = [
    day({ date: '2026-08-03', otMinutes: 300, employee: { id: 'e1', name: 'Carrier' } }),
    day({ date: '2026-08-03', otMinutes: 100, employee: { id: 'e2', name: 'Some' } }),
    day({ date: '2026-08-04', otMinutes: 100, employee: { id: 'e3', name: 'A bit' } }),
  ];

  it('sums minutes per person, highest first', () => {
    expect(overtimeLeaders(days)).toEqual([
      { name: 'Carrier', value: 300 },
      { name: 'A bit', value: 100 },
      { name: 'Some', value: 100 },
    ]);
  });

  it('reports what share of the total the named people carry', () => {
    expect(concentration(overtimeLeaders(days, 1), days)).toBe(60);
    expect(concentration(overtimeLeaders(days), days)).toBe(100);
  });

  it('returns zero share rather than dividing by zero', () => {
    expect(concentration([], [])).toBe(0);
    expect(concentration([], [day({ date: '2026-08-03', otMinutes: 0 })])).toBe(0);
  });

  it('treats a withheld otMinutes as no overtime rather than as NaN', () => {
    const withheld: AttendanceDay = { ...day({ date: '2026-08-03' }), otMinutes: undefined as unknown as number };
    expect(overtimeLeaders([withheld])).toEqual([]);
    expect(concentration([], [withheld])).toBe(0);
  });
});

describe('punchSources', () => {
  it('names every source in the contract, including the unused ones', () => {
    const points = punchSources([punch({ source: 'MOBILE' })]);
    expect(points.map((point) => point.source)).toEqual(['MOBILE', 'WEB', 'OFFLINE_SYNC']);
    expect(points.find((point) => point.source === 'WEB')?.punches).toBe(0);
  });

  it('counts each punch once', () => {
    const points = punchSources([
      punch({ source: 'WEB' }),
      punch({ source: 'WEB' }),
      punch({ source: 'OFFLINE_SYNC' }),
    ]);
    expect(points.find((point) => point.source === 'WEB')?.punches).toBe(2);
    expect(points.find((point) => point.source === 'OFFLINE_SYNC')?.punches).toBe(1);
  });
});

describe('flagVolume', () => {
  it('counts every flag on every punch, most common first', () => {
    const points = flagVolume([
      punch({ flags: ['outside_window', 'no_location'] }),
      punch({ flags: ['outside_window'] }),
    ]);
    expect(points).toEqual([
      { flag: 'outside_window', punches: 2 },
      { flag: 'no_location', punches: 1 },
    ]);
  });

  it('lists only flags that occurred', () => {
    expect(flagVolume([punch({ flags: [] })])).toEqual([]);
  });

  it('counts a flag this build has never heard of', () => {
    expect(flagVolume([punch({ flags: ['brand_new_flag'] })])).toEqual([
      { flag: 'brand_new_flag', punches: 1 },
    ]);
  });
});

describe('headcountByDepartment', () => {
  it('splits permanent from fixed-term and sorts by size', () => {
    const points = headcountByDepartment([
      person({ id: '1', department: { id: 'd1', name: 'Engineering' } }),
      person({ id: '2', department: { id: 'd1', name: 'Engineering' }, employmentType: 'INTERN' }),
      person({ id: '3', department: { id: 'd2', name: 'Finance' }, employmentType: 'CONTRACT' }),
    ]);
    expect(points).toEqual([
      { department: 'Engineering', permanent: 1, fixedTerm: 1, total: 2 },
      { department: 'Finance', permanent: 0, fixedTerm: 1, total: 1 },
    ]);
  });

  it('excludes inactive people but keeps those on notice', () => {
    const points = headcountByDepartment([
      person({ id: '1', status: 'INACTIVE' }),
      person({ id: '2', status: 'ON_NOTICE' }),
    ]);
    expect(points).toEqual([
      { department: 'Engineering', permanent: 1, fixedTerm: 0, total: 1 },
    ]);
  });

  it('names people with no department rather than dropping them', () => {
    const points = headcountByDepartment([person({ department: null })]);
    expect(points[0]?.department).toBe('Unassigned');
  });

  it('returns nothing for an empty roster', () => {
    expect(headcountByDepartment([])).toEqual([]);
  });
});

describe('periodTotals', () => {
  it('counts distinct people, not rows', () => {
    const totals = periodTotals([
      day({ date: '2026-08-03' }),
      day({ date: '2026-08-04' }),
      day({ date: '2026-08-03', employee: { id: 'e2', name: 'B' } }),
    ]);
    expect(totals.people).toBe(2);
    expect(totals.rows).toBe(3);
  });

  it('excludes holidays from the rate but still counts the row', () => {
    const totals = periodTotals([
      day({ date: '2026-08-03', status: 'PRESENT' }),
      day({ date: '2026-08-04', status: 'HOLIDAY' }),
    ]);
    expect(totals.rows).toBe(2);
    expect(totals.expected).toBe(1);
    expect(totals.attendanceRate).toBe(100);
  });

  it('reports a null rate rather than zero for an empty period', () => {
    expect(periodTotals([]).attendanceRate).toBeNull();
  });

  it('counts a day with any flag as flagged, once', () => {
    const totals = periodTotals([
      day({ date: '2026-08-03', flags: ['late', 'offline_sync'] }),
      day({ date: '2026-08-04', flags: [] }),
    ]);
    expect(totals.flaggedDays).toBe(1);
  });
});
