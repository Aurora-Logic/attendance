import { weeklyOffPatternConfigSchema } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { parseWeeklyOffConfig, weeklyOffConfigSchema } from '../day-engine/weekly-off.js';

/**
 * Two schemas describe `weekly_off_patterns.config`: the one the day engine
 * validates with on every read (`weekly-off.ts`) and the one the contract
 * package exports for the form that writes it (`packages/shared/src/shifts.ts`).
 *
 * They must accept exactly the same set. If the writing schema were the looser
 * of the two, the endpoint would happily store a pattern the engine then
 * refuses to read -- and the symptom would not be an error on save, it would be
 * every employee on that pattern failing to compute, in a job, at 02:00. If the
 * reading schema were looser, the form would refuse a pattern that is
 * perfectly usable.
 *
 * `weekly-off.ts` says of itself that this is validated "on read rather than
 * trusted". That is a comment, and a comment is not a control. This file makes
 * the drift a failing test, the same way `enum-parity.test.ts` does for the
 * Postgres enums.
 */

const FIXTURES: readonly { readonly label: string; readonly value: unknown }[] = [
  { label: 'Sundays off', value: { weekdays: [7] } },
  { label: 'five-day week', value: { weekdays: [6, 7] } },
  { label: 'no weekly off at all', value: { weekdays: [] } },
  { label: 'alternate Saturdays', value: { weekdays: [7], saturdaysOfMonth: [2, 4] } },
  { label: 'every occurrence of Saturday', value: { weekdays: [7], saturdaysOfMonth: [1, 2, 3, 4, 5] } },
  { label: 'empty saturday rule', value: { weekdays: [7], saturdaysOfMonth: [] } },

  { label: 'weekday zero', value: { weekdays: [0] } },
  { label: 'weekday eight', value: { weekdays: [8] } },
  { label: 'fractional weekday', value: { weekdays: [1.5] } },
  { label: 'weekday as text', value: { weekdays: ['7'] } },
  { label: 'weekdays missing', value: { saturdaysOfMonth: [2] } },
  { label: 'weekdays not an array', value: { weekdays: 7 } },
  { label: 'saturday occurrence zero', value: { weekdays: [], saturdaysOfMonth: [0] } },
  { label: 'saturday occurrence six', value: { weekdays: [], saturdaysOfMonth: [6] } },
  { label: 'an unknown key', value: { weekdays: [7], holidays: [1] } },
  { label: 'null', value: null },
  { label: 'an array', value: [1, 2] },
  { label: 'a string', value: 'weekdays' },
  { label: 'a number', value: 7 },
  { label: 'undefined', value: undefined },
  { label: 'empty object', value: {} },
  { label: 'more than seven weekdays', value: { weekdays: [1, 2, 3, 4, 5, 6, 7, 1] } },
];

describe('the weekly-off config schema (REQ-C-03)', () => {
  it.each(FIXTURES)('agrees between the engine and the contract on $label', ({ value }) => {
    const engine = weeklyOffConfigSchema.safeParse(value);
    const contract = weeklyOffPatternConfigSchema.safeParse(value);

    expect(contract.success).toBe(engine.success);
    if (engine.success && contract.success) {
      // Not only the verdict: the parsed value has to match too, or a default
      // applied on one side would be stored and then read back differently.
      expect(contract.data).toEqual(engine.data);
    }
  });

  it('names the pattern when it refuses one', () => {
    // The row id is the only thing that turns "a config is malformed" into
    // something somebody can go and fix.
    expect(() => parseWeeklyOffConfig({ weekdays: [9] }, 'pattern-42')).toThrow(/pattern-42/u);
  });

  it('accepts what the fixtures say it should, so the parity is not vacuous', () => {
    // A parity test between two schemas that both reject everything would
    // pass. This asserts the accepted half is non-empty and the rejected half
    // is too.
    const accepted = FIXTURES.filter((f) => weeklyOffConfigSchema.safeParse(f.value).success);
    expect(accepted.length).toBeGreaterThan(3);
    expect(FIXTURES.length - accepted.length).toBeGreaterThan(3);
  });
});
