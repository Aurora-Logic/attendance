import { describe, expect, it } from 'vitest';

import { compactCount, compactIndian } from './chart-labels';

/**
 * The formatters decide whether a label fits on a bar cap, which is the whole
 * reason the labels can be always-on rather than hover-only. A wrong answer
 * here is a number wider than its bar.
 */

describe('compactIndian', () => {
  it('uses the scale the reader speaks: thousands, lakh, crore', () => {
    expect(compactIndian(450)).toBe('450');
    expect(compactIndian(45_000)).toBe('45k');
    expect(compactIndian(1_250_000)).toBe('12.5L');
    expect(compactIndian(34_000_000)).toBe('3.4Cr');
  });

  it('drops a trailing .0 rather than printing 12.0L', () => {
    expect(compactIndian(1_200_000)).toBe('12L');
    expect(compactIndian(10_000_000)).toBe('1Cr');
  });

  it('crosses each boundary at the right place', () => {
    // 99,999 is still thousands; 1,00,000 is one lakh. Off by one here and
    // every figure near a boundary reads in the wrong unit.
    expect(compactIndian(99_999)).toBe('100k');
    expect(compactIndian(100_000)).toBe('1L');
    expect(compactIndian(9_999_999)).toBe('100L');
    expect(compactIndian(10_000_000)).toBe('1Cr');
  });

  it('marks a negative with a minus sign, not a hyphen', () => {
    expect(compactIndian(-250_000)).toBe('−2.5L');
  });

  it('is short enough to sit on a bar cap', () => {
    // The property that matters. Six characters is about 40px at 11px type,
    // which fits a 44px bar; anything longer would overlap its neighbour.
    for (const value of [0, 7, 999, 45_000, 1_250_000, 99_900_000, -34_000_000]) {
      expect(compactIndian(value).length).toBeLessThanOrEqual(6);
    }
  });
});

describe('compactCount', () => {
  it('never abbreviates a small count', () => {
    // "7 late arrivals" must not render as "7.0" or "0k".
    expect(compactCount(0)).toBe('0');
    expect(compactCount(7)).toBe('7');
    expect(compactCount(999)).toBe('999');
  });

  it('falls back to the short scale once a count gets long', () => {
    expect(compactCount(1_500)).toBe('1.5k');
    expect(compactCount(240_000)).toBe('2.4L');
  });
});
