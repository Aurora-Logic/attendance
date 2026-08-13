import { leaveTypeInputSchema } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { COMP_OFF_TYPE_CODE } from './leave.service.js';
import { SEED_LEAVE_TYPES } from './leave-seed-types.js';

/**
 * REQ-G-02's five seed types, checked against the contract that will create
 * them.
 *
 * The point is not that the constants are spelled correctly. It is that the
 * placeholders can actually be posted to `POST /leave/types` on the day
 * somebody wires them into `seed/`: a seed row that fails validation is a seed
 * that dies halfway, leaving an organisation with two of its five types and no
 * obvious reason why.
 */

describe('the REQ-G-02 seed types', () => {
  it('names all five', () => {
    expect(SEED_LEAVE_TYPES.map((type) => type.code)).toEqual(['CL', 'SL', 'EL', 'LWP', 'CO']);
  });

  it('every one of them validates as leave type input', () => {
    for (const type of SEED_LEAVE_TYPES) {
      const { placeholderNote: _note, ...input } = type;
      const parsed = leaveTypeInputSchema.safeParse(input);
      expect(parsed.success, `${type.code}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('includes the comp-off type the REQ-G-11 grant looks up by code', () => {
    const compOff = SEED_LEAVE_TYPES.find((type) => type.code === COMP_OFF_TYPE_CODE);
    expect(compOff).toBeDefined();
    // A comp-off balance comes from worked days, never from a schedule.
    expect(compOff?.accrualMethod).toBe('NONE');
    expect(compOff?.annualEntitlement).toBe(0);
  });

  it('labels every placeholder as one, so nothing here reads as agreed policy', () => {
    // OPEN-QUESTIONS item 4: entitlement, carry-forward cap, negative limit,
    // notice days and the document rule are all unanswered.
    for (const type of SEED_LEAVE_TYPES) {
      expect(type.placeholderNote.length, type.code).toBeGreaterThan(0);
    }
    const placeholders = SEED_LEAVE_TYPES.filter((type) =>
      type.placeholderNote.includes('OPEN-QUESTIONS item 4'),
    );
    // Four of the five. Comp-off's zero entitlement is a rule, not a guess.
    expect(placeholders).toHaveLength(4);
  });

  it('does not let unpaid leave block on a balance it can never have', () => {
    const lwp = SEED_LEAVE_TYPES.find((type) => type.code === 'LWP');
    expect(lwp?.accrualMethod).toBe('NONE');
    // REQ-G-08 spells 0 as "no negative balance allowed", so unpaid leave
    // needs a limit rather than the absence of one.
    expect(lwp?.negativeBalanceLimit).toBeGreaterThan(0);
  });
});
