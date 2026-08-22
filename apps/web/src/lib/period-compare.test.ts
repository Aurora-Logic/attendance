import { describe, expect, it } from 'vitest';

import { comparisonRange, deltaOf, fyQuarterStart, fyStart, periodForGranularity } from '@/lib/period-compare';

/** The April–March arithmetic, proven (data-analyst skill §3). */

describe('fyStart', () => {
  it('is 1 April of the year for April onwards, and of the year before for Jan–Mar', () => {
    expect(fyStart('2026-08-21')).toBe('2026-04-01');
    expect(fyStart('2026-04-01')).toBe('2026-04-01');
    expect(fyStart('2026-03-31')).toBe('2025-04-01');
  });
});

describe('fyQuarterStart', () => {
  it('knows the four FY quarters', () => {
    expect(fyQuarterStart('2026-08-21')).toBe('2026-07-01');
    expect(fyQuarterStart('2026-04-15')).toBe('2026-04-01');
    expect(fyQuarterStart('2026-12-31')).toBe('2026-10-01');
    expect(fyQuarterStart('2026-02-10')).toBe('2026-01-01');
  });
});

describe('periodForGranularity', () => {
  it('runs each period to the given day, not to its end', () => {
    expect(periodForGranularity('month', '2026-08-21')).toEqual({ from: '2026-08-01', to: '2026-08-21' });
    expect(periodForGranularity('quarter', '2026-08-21')).toEqual({ from: '2026-07-01', to: '2026-08-21' });
    expect(periodForGranularity('year', '2026-08-21')).toEqual({ from: '2026-04-01', to: '2026-08-21' });
  });
});

describe('comparisonRange', () => {
  it('same period last year shifts both ends twelve months, like-for-like to date', () => {
    expect(comparisonRange({ from: '2026-08-01', to: '2026-08-21' }, 'lastYear')).toEqual({ from: '2025-08-01', to: '2025-08-21' });
  });

  it('clamps a month-end shift instead of spilling into the next month', () => {
    expect(comparisonRange({ from: '2024-02-29', to: '2024-02-29' }, 'lastYear')).toEqual({ from: '2023-02-28', to: '2023-02-28' });
  });

  it('previous period steps back by the range’s own length, ending the day before it starts', () => {
    expect(comparisonRange({ from: '2026-08-01', to: '2026-08-21' }, 'previous')).toEqual({ from: '2026-07-11', to: '2026-07-31' });
  });
});

describe('deltaOf', () => {
  it('gives absolute and one-decimal percent with a direction', () => {
    expect(deltaOf(120, 100)).toMatchObject({ absolute: 20, pct: 20, direction: 'up' });
    expect(deltaOf(90, 100)).toMatchObject({ absolute: -10, pct: -10, direction: 'down' });
  });

  it('never turns a zero base into a percentage', () => {
    expect(deltaOf(50, 0)).toMatchObject({ pct: null, label: 'new', direction: 'up' });
    expect(deltaOf(0, 0)).toMatchObject({ pct: null, label: 'none', direction: 'flat' });
  });
});
