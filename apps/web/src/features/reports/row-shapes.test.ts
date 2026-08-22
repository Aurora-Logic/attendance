import { REPORT_DEFINITIONS, type ReportKey } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { toRowViews } from './types';

/**
 * Every report must have a row shape.
 *
 * `toRowViews` looks its shape up in a partial record and throws when there is
 * none, and `api.ts` turns that throw into the screen's error state -- so a
 * report added to `REPORT_DEFINITIONS` without a shape here compiles, ships,
 * and fails only when someone opens it. `ageing` did exactly that: the report
 * existed on the API and returned rows, and every screen reading it showed an
 * error instead. This test is the compile-time check the partial record cannot
 * give us.
 */
describe('report row shapes', () => {
  const keys = Object.keys(REPORT_DEFINITIONS) as ReportKey[];

  it('covers every report in REPORT_DEFINITIONS', () => {
    const missing = keys.filter((key) => {
      try {
        toRowViews(key, []);
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });
});
