import { describe, expect, it } from 'vitest';

import {
  refusalMessage,
  refuseElection,
  remainingAllowance,
  type ElectionContext,
} from './election-policy.js';

/**
 * REQ-H-03: "employee chooses up to N per year from a pool; the choice consumes
 * an allowance and marks the day HOLIDAY for them only."
 *
 * Each refusal below is one clause of that sentence being enforced. The last
 * clause -- what the elected day becomes -- belongs to the day engine and is
 * covered by its own suite ("a restricted holiday the employee elected is a
 * holiday").
 */

const CALENDAR = '01900000-0000-7000-8000-00000000c001';

function context(overrides: Partial<ElectionContext> = {}): ElectionContext {
  return {
    restricted: true,
    employeeCalendarId: CALENDAR,
    holidayCalendarId: CALENDAR,
    allowance: 2,
    used: 0,
    alreadyElected: false,
    ...overrides,
  };
}

describe('remainingAllowance', () => {
  it('is what is left', () => {
    expect(remainingAllowance(2, 1)).toBe(1);
  });

  it('floors at zero rather than going negative', () => {
    // Reachable if an allowance is lowered after elections were made. A
    // negative here would render as "-1 left", which reads as a bug rather
    // than as a full pool.
    expect(remainingAllowance(1, 3)).toBe(0);
  });
});

describe('refuseElection (REQ-H-03)', () => {
  it('allows the first pick against a live allowance', () => {
    expect(refuseElection(context())).toBeNull();
  });

  it('allows the last pick', () => {
    expect(refuseElection(context({ allowance: 2, used: 1 }))).toBeNull();
  });

  it('refuses a public holiday, which is already everyone’s', () => {
    expect(refuseElection(context({ restricted: false }))).toBe('NOT_RESTRICTED');
  });

  it('refuses a holiday from a calendar the employee does not follow (REQ-H-02)', () => {
    expect(refuseElection(context({ employeeCalendarId: 'another-calendar' }))).toBe(
      'NOT_ON_CALENDAR',
    );
  });

  it('refuses when the employee follows no calendar at all', () => {
    expect(refuseElection(context({ employeeCalendarId: null }))).toBe('NOT_ON_CALENDAR');
  });

  it('distinguishes "not switched on" from "all used up"', () => {
    // The two are one subtraction apart and produce very different advice: one
    // is a setting HR can change, the other is the employee's own choice.
    expect(refuseElection(context({ allowance: 0 }))).toBe('NOT_ENABLED');
    expect(refuseElection(context({ allowance: 2, used: 2 }))).toBe('ALLOWANCE_EXHAUSTED');
  });

  it('refuses a day already taken before it counts the allowance', () => {
    // Otherwise re-picking the same day on a full allowance would report
    // "no allowance left" and send the reader looking for a setting.
    expect(refuseElection(context({ allowance: 2, used: 2, alreadyElected: true }))).toBe(
      'ALREADY_ELECTED',
    );
  });

  it('still refuses once the allowance has been lowered below what was taken', () => {
    expect(refuseElection(context({ allowance: 1, used: 3 }))).toBe('ALLOWANCE_EXHAUSTED');
  });

  it('has a sentence for every refusal', () => {
    const reasons = [
      'NOT_RESTRICTED',
      'NOT_ON_CALENDAR',
      'NOT_ENABLED',
      'ALLOWANCE_EXHAUSTED',
      'ALREADY_ELECTED',
    ] as const;
    for (const reason of reasons) {
      expect(refusalMessage(reason, context()).length).toBeGreaterThan(10);
    }
  });
});
