import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PUNCH_SETTINGS,
  PUNCH_SETTING_KEYS,
  photoExpiry,
  resolvePunchSettings,
} from './punch-settings.js';

/**
 * The retention arithmetic behind REQ-L-03. The rest of `resolvePunchSettings`
 * is exercised end to end by `punch.endpoints.test.ts`; what belongs here is
 * the pure arithmetic whose edge cases -- month-end clamping, a malformed row
 * -- an HTTP test would need contrived fixtures to reach.
 */

describe('resolvePunchSettings retention', () => {
  it('defaults to twelve months when no row exists (REQ-L-03)', () => {
    expect(resolvePunchSettings(new Map()).photoRetentionMonths).toBe(12);
    expect(DEFAULT_PUNCH_SETTINGS.photoRetentionMonths).toBe(12);
  });

  it('reads a stored value over the default', () => {
    const settings = resolvePunchSettings(
      new Map([[PUNCH_SETTING_KEYS.photoRetentionMonths, 6]]),
    );
    expect(settings.photoRetentionMonths).toBe(6);
  });

  it('throws on a malformed value rather than silently falling back', () => {
    // A row that says "12 months" as a string is a control that has been
    // turned off without anybody being told; the punch pipeline must refuse
    // to start rather than store photos with a guessed expiry.
    expect(() =>
      resolvePunchSettings(new Map([[PUNCH_SETTING_KEYS.photoRetentionMonths, 'twelve']])),
    ).toThrow(/photo_retention_months/u);
    expect(() =>
      resolvePunchSettings(new Map([[PUNCH_SETTING_KEYS.photoRetentionMonths, 0]])),
    ).toThrow(/photo_retention_months/u);
  });

  it('refuses a retention shorter than the longest dispute window', () => {
    // The floor is 3 months because a regularization window can reach 90
    // days (REQ-F-02): a 2-month retention would purge a photo while the
    // punch it evidences is still disputable.
    expect(() =>
      resolvePunchSettings(new Map([[PUNCH_SETTING_KEYS.photoRetentionMonths, 2]])),
    ).toThrow(/photo_retention_months/u);
    expect(
      resolvePunchSettings(new Map([[PUNCH_SETTING_KEYS.photoRetentionMonths, 3]]))
        .photoRetentionMonths,
    ).toBe(3);
  });
});

describe('photoExpiry', () => {
  it('adds calendar months, preserving the time of day', () => {
    const now = new Date('2026-08-14T10:30:15.250Z');
    expect(photoExpiry(now, 12).toISOString()).toBe('2027-08-14T10:30:15.250Z');
    expect(photoExpiry(now, 1).toISOString()).toBe('2026-09-14T10:30:15.250Z');
  });

  it('rolls over a year boundary', () => {
    expect(photoExpiry(new Date('2026-11-05T00:00:00Z'), 3).toISOString()).toBe(
      '2027-02-05T00:00:00.000Z',
    );
  });

  it('clamps to the end of a shorter target month', () => {
    // 31 October plus four months must not roll into March: the promise is
    // "kept N months", and overshooting quietly lengthens it.
    expect(photoExpiry(new Date('2026-10-31T09:00:00Z'), 4).toISOString()).toBe(
      '2027-02-28T09:00:00.000Z',
    );
    // A leap February keeps its 29th.
    expect(photoExpiry(new Date('2027-10-31T09:00:00Z'), 4).toISOString()).toBe(
      '2028-02-29T09:00:00.000Z',
    );
    expect(photoExpiry(new Date('2026-08-31T09:00:00Z'), 1).toISOString()).toBe(
      '2026-09-30T09:00:00.000Z',
    );
  });
});
