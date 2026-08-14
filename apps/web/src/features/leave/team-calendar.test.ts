import { describe, expect, it } from 'vitest';

import {
  awayCount,
  entriesByDate,
  leaveCalendarSchema,
  monthBounds,
  warningSentence,
  warningsByDate,
  type LeaveCalendarEntry,
} from './team-calendar';

/**
 * REQ-G-12. The cases here are the ones that would produce a wrong answer
 * silently: a date shifted by a timezone, a person counted twice, a month whose
 * last day depends on the year.
 */

function entry(overrides: Partial<LeaveCalendarEntry> & { date: string }): LeaveCalendarEntry {
  return {
    employee: { id: 'e1', name: 'Asha Rao' },
    department: { id: 'd1', name: 'Operations' },
    leaveType: { id: 't1', name: 'Casual Leave', code: 'CL' },
    portion: 'FULL',
    leaveRequestId: 'r1',
    ...overrides,
  };
}

describe('monthBounds', () => {
  it('spans the whole month', () => {
    expect(monthBounds(new Date(2026, 7, 14))).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('reads the local calendar date, not the UTC one', () => {
    // Late on the last day of a month, in a timezone ahead of UTC, a
    // toISOString() slice would name the following month and the whole screen
    // would ask the server for the wrong range.
    expect(monthBounds(new Date(2026, 7, 31, 23, 30))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('zero-pads single-digit months and days', () => {
    expect(monthBounds(new Date(2026, 2, 5)).from).toBe('2026-03-01');
  });

  it('gets February right in a leap year and a common year', () => {
    expect(monthBounds(new Date(2028, 1, 3)).to).toBe('2028-02-29');
    expect(monthBounds(new Date(2026, 1, 3)).to).toBe('2026-02-28');
  });
});

describe('entriesByDate', () => {
  it('groups by date and sorts each day by employee name', () => {
    const grouped = entriesByDate([
      entry({ date: '2026-08-14', employee: { id: 'b', name: 'Bhavna Iyer' } }),
      entry({ date: '2026-08-14', employee: { id: 'a', name: 'Amit Shah' } }),
      entry({ date: '2026-08-15', employee: { id: 'c', name: 'Chetan Das' } }),
    ]);

    expect([...grouped.keys()].sort()).toEqual(['2026-08-14', '2026-08-15']);
    expect(grouped.get('2026-08-14')?.map((row) => row.employee.name)).toEqual([
      'Amit Shah',
      'Bhavna Iyer',
    ]);
  });

  it('returns an empty map for no entries rather than throwing', () => {
    expect(entriesByDate([]).size).toBe(0);
  });
});

describe('awayCount', () => {
  it('counts people, not entries', () => {
    // Two half-day requests on the same date for the same person. Counting
    // rows would say two people are away and disagree with the server's own
    // warning, which counts the person once.
    const same = [
      entry({ date: '2026-08-14', portion: 'FIRST_HALF', leaveRequestId: 'r1' }),
      entry({ date: '2026-08-14', portion: 'SECOND_HALF', leaveRequestId: 'r2' }),
    ];
    expect(awayCount(same)).toBe(1);
  });

  it('counts distinct people', () => {
    expect(
      awayCount([
        entry({ date: '2026-08-14', employee: { id: 'a', name: 'A' } }),
        entry({ date: '2026-08-14', employee: { id: 'b', name: 'B' } }),
      ]),
    ).toBe(2);
  });

  it('is zero for a day with nobody away', () => {
    expect(awayCount([])).toBe(0);
  });
});

describe('warningsByDate', () => {
  it('keeps every department that breached on one date', () => {
    const byDate = warningsByDate([
      { date: '2026-08-14', department: { id: 'd1', name: 'Operations' }, awayCount: 3, threshold: 3 },
      { date: '2026-08-14', department: { id: 'd2', name: 'Finance' }, awayCount: 4, threshold: 3 },
      { date: '2026-08-20', department: null, awayCount: 5, threshold: 3 },
    ]);

    expect(byDate.get('2026-08-14')).toHaveLength(2);
    expect(byDate.get('2026-08-20')).toHaveLength(1);
    expect(byDate.has('2026-08-15')).toBe(false);
  });
});

describe('warningSentence', () => {
  it('names the department when there is one', () => {
    expect(
      warningSentence({
        date: '2026-08-14',
        department: { id: 'd1', name: 'Operations' },
        awayCount: 3,
        threshold: 3,
      }),
    ).toBe('3 away in Operations, at or over the threshold of 3.');
  });

  it('says so plainly when the pool has no department', () => {
    expect(
      warningSentence({ date: '2026-08-14', department: null, awayCount: 4, threshold: 2 }),
    ).toBe('4 away across the organisation, at or over the threshold of 2.');
  });
});

describe('leaveCalendarSchema', () => {
  it('accepts the shape the endpoint documents', () => {
    const parsed = leaveCalendarSchema.safeParse({
      from: '2026-08-01',
      to: '2026-08-31',
      entries: [
        {
          employee: { id: 'e1', name: 'Asha Rao' },
          department: null,
          leaveType: { id: 't1', name: 'Casual Leave', code: 'CL' },
          date: '2026-08-14',
          portion: 'FULL',
          leaveRequestId: 'r1',
        },
      ],
      warnings: [],
      threshold: 3,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a portion the client has no rendering for', () => {
    const parsed = leaveCalendarSchema.safeParse({
      from: '2026-08-01',
      to: '2026-08-31',
      entries: [
        {
          employee: { id: 'e1', name: 'Asha Rao' },
          department: null,
          leaveType: { id: 't1', name: 'Casual Leave', code: 'CL' },
          date: '2026-08-14',
          portion: 'QUARTER_DAY',
          leaveRequestId: 'r1',
        },
      ],
      warnings: [],
      threshold: 3,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a response missing the threshold, rather than defaulting it to zero', () => {
    // A missing threshold defaulted to 0 would silently mean "no warnings are
    // possible", which is the one wrong answer this screen must never give.
    const parsed = leaveCalendarSchema.safeParse({
      from: '2026-08-01',
      to: '2026-08-31',
      entries: [],
      warnings: [],
    });
    expect(parsed.success).toBe(false);
  });
});
