import {
  LEAVE_MOVEMENT_TYPES,
  closingLeaveBalance,
  isLeaveBalanceConsistent,
  roundLeaveDays,
  type LeaveMovementType,
} from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import {
  LeaveProjectionError,
  assertProjectionIsSound,
  negativeLimitShortfall,
  projectLedger,
  sumSignedMovements,
  type LedgerMovement,
} from './leave-balance.js';

/**
 * REQ-G-03's invariant, checked over generated sequences rather than over
 * examples.
 *
 * Three hand-picked cases prove that three cases work. What has to hold is
 * that *no* sequence of movements can produce a balance whose six numbers do
 * not add up -- and the ledger is append-only, so a sequence that breaks it
 * cannot be repaired, only apologised for. The generator below is deliberately
 * hostile: it emits movement types in any order, negative adjustments, half
 * days, reversals of things that were never availed, and long runs whose float
 * accumulation is where the naive version of `projectLedger` actually failed.
 *
 * No property-testing dependency is added (CLAUDE.md §6). A seeded PRNG and a
 * loop give the same guarantee for this shape of property, and the seed is
 * printed with any failure so a counterexample is reproducible rather than
 * "it went red on CI once".
 */

/** mulberry32: small, seeded, and good enough for generating test data. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Amounts a real ledger can hold: whole days, half days, and the two-decimal
 * results a pro-rated monthly accrual produces. Nothing with three decimals --
 * `numeric(6,2)` cannot store one, so generating them would test rounding
 * behaviour the database never sees.
 */
function randomDays(random: () => number): number {
  const roll = random();
  if (roll < 0.35) return Math.floor(random() * 20) + 1;
  if (roll < 0.6) return Math.floor(random() * 20) + 0.5;
  return roundLeaveDays(random() * 30);
}

function randomMovement(random: () => number): LedgerMovement {
  const movementType = LEAVE_MOVEMENT_TYPES[
    Math.floor(random() * LEAVE_MOVEMENT_TYPES.length)
  ] as LeaveMovementType;

  const magnitude = randomDays(random);

  // The sign convention the ledger is written under, applied by the generator
  // so the property is tested against realistic rows rather than noise.
  switch (movementType) {
    case 'AVAILED':
    case 'LAPSE':
    case 'ENCASHMENT':
      return { movementType, days: -magnitude };
    case 'ADJUSTMENT':
      return { movementType, days: random() < 0.5 ? -magnitude : magnitude };
    default:
      return { movementType, days: magnitude };
  }
}

function randomSequence(random: () => number, maxLength: number): LedgerMovement[] {
  const length = Math.floor(random() * maxLength);
  return Array.from({ length }, () => randomMovement(random));
}

describe('projectLedger holds the REQ-G-03 invariant', () => {
  it('closes at opening + accrued - availed + adjusted + carried forward, over 4000 sequences', () => {
    for (let seed = 1; seed <= 4_000; seed += 1) {
      const random = prng(seed);
      const movements = randomSequence(random, 40);
      const balance = projectLedger(movements);

      // The invariant itself, quoted from the contract rather than restated.
      expect(
        isLeaveBalanceConsistent(balance),
        `seed ${String(seed)}: ${JSON.stringify(balance)}`,
      ).toBe(true);

      // And the independent route: the plain sum of the signed rows. This does
      // not go through the bucket map or the formula, so a mistake in either
      // shows up as a disagreement rather than as two consistent wrong answers.
      expect(sumSignedMovements(movements), `seed ${String(seed)}`).toBe(balance.closing);
    }
  });

  it('stays exact over long runs of half days, where float accumulation bites', () => {
    // 0.1-style error does not appear until enough terms have been added. 601
    // AVAILED half-days summed as raw floats land on -300.49999999999994.
    const movements: LedgerMovement[] = [
      { movementType: 'ACCRUAL', days: 0.1 * 3 },
      ...Array.from({ length: 601 }, (): LedgerMovement => ({ movementType: 'AVAILED', days: -0.5 })),
      ...Array.from({ length: 7 }, (): LedgerMovement => ({ movementType: 'ADJUSTMENT', days: 0.1 })),
    ];

    const balance = projectLedger(movements);
    expect(balance.availed).toBe(300.5);
    expect(balance.adjusted).toBe(0.7);
    expect(balance.accrued).toBe(0.3);
    expect(balance.closing).toBe(-299.5);
    expect(isLeaveBalanceConsistent(balance)).toBe(true);
  });

  it('projects an empty ledger as a zero balance rather than throwing', () => {
    const balance = projectLedger([]);
    expect(balance).toEqual({
      opening: 0,
      accrued: 0,
      availed: 0,
      adjusted: 0,
      carriedForward: 0,
      closing: 0,
    });
  });

  it('maps each movement type into exactly one bucket', () => {
    const cases: readonly [LeaveMovementType, keyof ReturnType<typeof projectLedger>, number][] = [
      ['OPENING', 'opening', 5],
      ['ACCRUAL', 'accrued', 5],
      ['CARRY_FORWARD', 'carriedForward', 5],
      ['ADJUSTMENT', 'adjusted', -5],
      ['ENCASHMENT', 'adjusted', -5],
      ['LAPSE', 'adjusted', -5],
    ];

    for (const [movementType, bucket, days] of cases) {
      const balance = projectLedger([{ movementType, days }]);
      expect(balance[bucket], movementType).toBe(days);
      expect(balance.closing, movementType).toBe(days);
    }

    // AVAILED and REVERSAL are the pair that meets the sign convention: the
    // ledger stores them signed, the balance stores the magnitude taken.
    const availed = projectLedger([{ movementType: 'AVAILED', days: -3 }]);
    expect(availed.availed).toBe(3);
    expect(availed.closing).toBe(-3);

    const reversed = projectLedger([
      { movementType: 'AVAILED', days: -3 },
      { movementType: 'REVERSAL', days: 3 },
    ]);
    expect(reversed.availed).toBe(0);
    expect(reversed.closing).toBe(0);
  });

  it('cancels back to exactly the balance before, for any generated leave', () => {
    // REQ-G-10: "cancellation reverses the ledger entries". The property that
    // matters is not that a reversal is written but that the balance returns
    // to what it was -- including when the reversal is one of several.
    for (let seed = 5_000; seed < 5_500; seed += 1) {
      const random = prng(seed);
      const before = randomSequence(random, 15);
      const baseline = projectLedger(before);

      const taken = randomDays(random);
      const after = projectLedger([
        ...before,
        { movementType: 'AVAILED', days: -taken },
        { movementType: 'REVERSAL', days: taken },
      ]);

      expect(after.closing, `seed ${String(seed)}`).toBe(baseline.closing);
      expect(after.availed, `seed ${String(seed)}`).toBe(baseline.availed);
    }
  });

  /**
   * Why the approval framework has to apply a decision exactly once.
   *
   * The join made in REQ-I-01 moved the AVAILED write from a leave endpoint to
   * a handler the framework calls, and the framework's compare-and-swap is what
   * guarantees it calls it once. This states what the guarantee is worth: a
   * second AVAILED for the same request still satisfies the invariant -- the
   * six numbers add up perfectly -- so nothing downstream can detect it. The
   * balance is simply wrong, on an append-only table, with no way back.
   *
   * That is the argument for `leave_ledger_request_movement_uq` (migration
   * 0014) and for the `written !== 1` refusal in `LeaveService`. Neither is
   * defence against a symptom, because there is no symptom.
   */
  it('cannot detect a doubled deduction from the invariant alone, which is why it must be impossible', () => {
    for (let seed = 6_000; seed < 6_400; seed += 1) {
      const random = prng(seed);
      const before = randomSequence(random, 12);
      const taken = randomDays(random);

      const once = projectLedger([...before, { movementType: 'AVAILED', days: -taken }]);
      const twice = projectLedger([
        ...before,
        { movementType: 'AVAILED', days: -taken },
        { movementType: 'AVAILED', days: -taken },
      ]);

      // Both are internally consistent. Only one is true.
      expect(isLeaveBalanceConsistent(once), `seed ${String(seed)}`).toBe(true);
      expect(isLeaveBalanceConsistent(twice), `seed ${String(seed)}`).toBe(true);
      expect(twice.availed, `seed ${String(seed)}`).toBe(roundLeaveDays(once.availed + taken));
      expect(twice.closing, `seed ${String(seed)}`).toBe(roundLeaveDays(once.closing - taken));
    }
  });

});

describe('assertProjectionIsSound', () => {
  it('accepts a projection that agrees with its rows', () => {
    const movements: LedgerMovement[] = [
      { movementType: 'OPENING', days: 12 },
      { movementType: 'AVAILED', days: -2.5 },
    ];
    expect(() => {
      assertProjectionIsSound(movements, projectLedger(movements));
    }).not.toThrow();
  });

  it('refuses a balance that does not come from the rows it claims', () => {
    const movements: LedgerMovement[] = [{ movementType: 'OPENING', days: 12 }];
    const tampered = { ...projectLedger(movements), closing: 13 };
    expect(() => {
      assertProjectionIsSound(movements, tampered);
    }).toThrow(LeaveProjectionError);
  });
});

describe('negativeLimitShortfall (REQ-G-08)', () => {
  it('allows a balance to go negative up to the limit, and no further', () => {
    // Limit 5: closing may reach -5 but not -5.5.
    expect(negativeLimitShortfall({ closingBefore: 0, daysRequested: 5, negativeBalanceLimit: 5 })).toBe(0);
    expect(
      negativeLimitShortfall({ closingBefore: 0, daysRequested: 5.5, negativeBalanceLimit: 5 }),
    ).toBe(0.5);
  });

  it('treats a limit of zero as "no negative balance at all"', () => {
    expect(negativeLimitShortfall({ closingBefore: 2, daysRequested: 2, negativeBalanceLimit: 0 })).toBe(0);
    expect(
      negativeLimitShortfall({ closingBefore: 2, daysRequested: 2.5, negativeBalanceLimit: 0 }),
    ).toBe(0.5);
  });

  it('reports the shortfall from an already negative balance', () => {
    expect(
      negativeLimitShortfall({ closingBefore: -4, daysRequested: 3, negativeBalanceLimit: 5 }),
    ).toBe(2);
  });

  it('does not let a half day slip past on floating point', () => {
    // 0.1 + 0.2 arithmetic in the caller would put `after` at -5.000000000001
    // and reject an application that exactly reaches the limit.
    expect(
      negativeLimitShortfall({ closingBefore: 0.3, daysRequested: 5.3, negativeBalanceLimit: 5 }),
    ).toBe(0);
  });
});

describe('closingLeaveBalance', () => {
  it('is the formula the database check constraint enforces', () => {
    expect(
      closingLeaveBalance({ opening: 10, accrued: 2, availed: 3.5, adjusted: -1, carriedForward: 4 }),
    ).toBe(11.5);
  });
});
