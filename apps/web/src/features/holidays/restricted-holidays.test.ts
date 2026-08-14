import { describe, expect, it } from 'vitest';

import {
  allowanceSentence,
  poolBlocker,
  recomputeSentence,
  restrictedHolidayPoolSchema,
  sortedOptions,
  type RestrictedHolidayPool,
} from './restricted-holidays';

/**
 * REQ-H-03. The cases worth pinning are the three different "nothing to choose
 * from" states, which a single empty state would blur into one, and the
 * recompute outcomes — a locked period refusing the recompute is the one that
 * would otherwise pass unnoticed.
 */

function pool(overrides: Partial<RestrictedHolidayPool> = {}): RestrictedHolidayPool {
  return {
    employeeId: 'e1',
    calendarId: 'c1',
    year: 2026,
    allowance: 2,
    used: 0,
    remaining: 2,
    options: [
      { id: 'h1', date: '2026-03-04', name: 'Holi', restricted: true, elected: false },
      { id: 'h2', date: '2026-11-08', name: 'Diwali', restricted: true, elected: false },
    ],
    ...overrides,
  };
}

describe('poolBlocker', () => {
  it('separates the three nothings', () => {
    expect(poolBlocker(pool({ calendarId: null }))).toBe('NO_CALENDAR');
    expect(poolBlocker(pool({ allowance: 0 }))).toBe('NOT_ENABLED');
    expect(poolBlocker(pool({ options: [] }))).toBe('NONE_LISTED');
  });

  it('checks the calendar before the allowance', () => {
    // An employee with no calendar and no allowance must be told about the
    // calendar: setting an allowance on a calendar they do not follow changes
    // nothing for them.
    expect(poolBlocker(pool({ calendarId: null, allowance: 0 }))).toBe('NO_CALENDAR');
  });

  it('is null when the pool can be used, and while it is still loading', () => {
    expect(poolBlocker(pool())).toBeNull();
    expect(poolBlocker(undefined)).toBeNull();
  });

  it('does not block on a spent allowance', () => {
    // Nothing left to take is not the same as nothing to show: the taken ones
    // still have to render, with a way to withdraw one.
    expect(poolBlocker(pool({ used: 2, remaining: 0 }))).toBeNull();
  });
});

describe('sortedOptions', () => {
  it('puts the pool in date order', () => {
    const unordered = pool({
      options: [
        { id: 'b', date: '2026-11-08', name: 'Diwali', restricted: true, elected: false },
        { id: 'a', date: '2026-03-04', name: 'Holi', restricted: true, elected: true },
      ],
    });
    expect(sortedOptions(unordered).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the pool it was given', () => {
    const source = pool({
      options: [
        { id: 'b', date: '2026-11-08', name: 'Diwali', restricted: true, elected: false },
        { id: 'a', date: '2026-03-04', name: 'Holi', restricted: true, elected: false },
      ],
    });
    sortedOptions(source);
    expect(source.options.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('is empty while the pool is loading', () => {
    expect(sortedOptions(undefined)).toEqual([]);
  });
});

describe('allowanceSentence', () => {
  it('always states both numbers', () => {
    expect(allowanceSentence(pool({ used: 1, remaining: 1 }))).toBe('1 of 2 taken. 1 left.');
  });

  it('says plainly when the allowance is spent', () => {
    expect(allowanceSentence(pool({ used: 2, remaining: 0 }))).toBe('2 of 2 taken. None left this year.');
  });
});

describe('recomputeSentence', () => {
  it('reports the count', () => {
    expect(recomputeSentence({ considered: 1, recomputed: 1, locked: 0, failed: 0 })).toBe(
      '1 attendance day recomputed.',
    );
    expect(recomputeSentence({ considered: 3, recomputed: 3, locked: 0, failed: 0 })).toBe(
      '3 attendance days recomputed.',
    );
  });

  it('says a locked period was left alone rather than claiming success', () => {
    expect(recomputeSentence({ considered: 1, recomputed: 0, locked: 1, failed: 0 })).toMatch(
      /locked period/,
    );
  });

  it('does not hide a failed recompute behind a zero', () => {
    expect(recomputeSentence({ considered: 1, recomputed: 0, locked: 0, failed: 1 })).toMatch(
      /could not be recomputed/,
    );
  });

  it('is honest when there was nothing to do', () => {
    expect(recomputeSentence({ considered: 0, recomputed: 0, locked: 0, failed: 0 })).toBe(
      'No attendance day needed recomputing.',
    );
  });
});

describe('restrictedHolidayPoolSchema', () => {
  it('accepts the documented shape, including an employee with no calendar', () => {
    expect(restrictedHolidayPoolSchema.safeParse(pool()).success).toBe(true);
    expect(
      restrictedHolidayPoolSchema.safeParse({ ...pool(), calendarId: null, options: [] }).success,
    ).toBe(true);
  });

  it('rejects a pool with no remaining, rather than defaulting it', () => {
    // `remaining` is the number the button is enabled from. Defaulting a
    // missing one to zero would silently disable election for everybody; to
    // anything else it would enable it past the allowance.
    const { remaining: _remaining, ...withoutRemaining } = pool();
    expect(restrictedHolidayPoolSchema.safeParse(withoutRemaining).success).toBe(false);
  });

  it('rejects an option missing its elected flag', () => {
    const broken = pool({
      options: [{ id: 'h1', date: '2026-03-04', name: 'Holi', restricted: true } as never],
    });
    expect(restrictedHolidayPoolSchema.safeParse(broken).success).toBe(false);
  });
});
