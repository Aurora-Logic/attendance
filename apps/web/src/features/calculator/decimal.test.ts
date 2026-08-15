import { describe, expect, it } from 'vitest';

import {
  DISPLAY_DIGITS,
  add,
  divide,
  fromText,
  multiply,
  negate,
  normalise,
  overflows,
  round,
  subtract,
  toDisplay,
  toText,
} from './decimal';

/** `a op b` as text, the way the calculator would show it. */
function calc(a: string, op: (x: ReturnType<typeof fromText>, y: ReturnType<typeof fromText>) => ReturnType<typeof fromText> | null, b: string): string {
  const result = op(fromText(a), fromText(b));
  return result === null ? 'error' : toText(result);
}

describe('the cases binary floating point gets wrong', () => {
  // Each of these is a value a double cannot hold. The right-hand side is what
  // `Number` actually produces, quoted so a reader can see why this module
  // exists rather than having to trust the claim.
  it('0.1 + 0.2 is 0.3, not 0.30000000000000004', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(calc('0.1', add, '0.2')).toBe('0.3');
  });

  it('1.1 * 3 is 3.3, not 3.3000000000000003', () => {
    expect(1.1 * 3).not.toBe(3.3);
    expect(calc('1.1', multiply, '3')).toBe('3.3');
  });

  it('0.3 - 0.1 is 0.2, not 0.19999999999999998', () => {
    expect(0.3 - 0.1).not.toBe(0.2);
    expect(calc('0.3', subtract, '0.1')).toBe('0.2');
  });

  it('0.07 * 100 is 7, not 7.000000000000001', () => {
    expect(0.07 * 100).not.toBe(7);
    expect(calc('0.07', multiply, '100')).toBe('7');
  });

  it('4.35 * 100 is 435, not 434.99999999999994', () => {
    expect(4.35 * 100).not.toBe(435);
    expect(calc('4.35', multiply, '100')).toBe('435');
  });

  it('0.1 added ten times is exactly 1', () => {
    let total = fromText('0');
    for (let i = 0; i < 10; i += 1) total = add(total, fromText('0.1'));
    expect(toText(total)).toBe('1');

    let drifting = 0;
    for (let i = 0; i < 10; i += 1) drifting += 0.1;
    expect(drifting).not.toBe(1);
  });

  it('8.7 hours minus 8.5 hours is 0.2, not 0.20000000000000018', () => {
    // The shape of the complaint the requirement anticipates: somebody
    // checking hours against a payslip.
    expect(8.7 - 8.5).not.toBe(0.2);
    expect(calc('8.7', subtract, '8.5')).toBe('0.2');
  });

  it('does not drift over a long chain of mixed operations', () => {
    let value = fromText('0');
    for (let i = 0; i < 100; i += 1) value = add(value, fromText('0.07'));
    value = subtract(value, fromText('7'));
    expect(toText(value)).toBe('0');
  });
});

describe('divide', () => {
  it('is exact when the division is exact', () => {
    expect(calc('1', divide, '8')).toBe('0.125');
    expect(calc('10', divide, '4')).toBe('2.5');
  });

  it('rounds half away from zero, not to even', () => {
    // A desk calculator answers 3 for 2.5, and -3 for -2.5.
    expect(toText(round(fromText('2.5'), 0))).toBe('3');
    expect(toText(round(fromText('-2.5'), 0))).toBe('-3');
    expect(toText(round(fromText('3.5'), 0))).toBe('4');
  });

  it('carries guard digits so a repeating division does not lose the last place', () => {
    const third = divide(fromText('1'), fromText('3'));
    expect(third).not.toBeNull();
    expect(toText(third ?? fromText('0'))).toBe('0.33333333333333');
  });

  it('answers null for a division by zero rather than Infinity', () => {
    expect(divide(fromText('1'), fromText('0'))).toBeNull();
    expect(divide(fromText('0'), fromText('0'))).toBeNull();
  });

  it('keeps the sign', () => {
    expect(calc('-1', divide, '8')).toBe('-0.125');
    expect(calc('1', divide, '-8')).toBe('-0.125');
    expect(calc('-1', divide, '-8')).toBe('0.125');
  });
});

describe('fromText and toText', () => {
  it('round-trips what the keypad can produce', () => {
    for (const text of ['0', '5', '-5', '0.5', '-0.5', '12.34', '1000000']) {
      expect(toText(fromText(text))).toBe(text);
    }
  });

  it('reads a bare fraction and a trailing zero', () => {
    expect(toText(fromText('.5'))).toBe('0.5');
    expect(toText(fromText('0.50'))).toBe('0.5');
    expect(toText(fromText('-0.50'))).toBe('-0.5');
  });

  it('refuses anything the keypad could not have produced', () => {
    expect(() => fromText('1e5')).toThrow();
    expect(() => fromText('1,5')).toThrow();
    expect(() => fromText('abc')).toThrow();
  });
});

describe('normalise', () => {
  it('makes 0.30 and 0.3 the same value', () => {
    expect(normalise({ units: 30n, scale: 2 })).toEqual({ units: 3n, scale: 1 });
  });

  it('does not turn 100 into 1', () => {
    expect(normalise({ units: 100n, scale: 0 })).toEqual({ units: 100n, scale: 0 });
  });

  it('collapses a signed zero', () => {
    expect(toText(normalise({ units: -0n, scale: 3 }))).toBe('0');
  });
});

describe('the display window', () => {
  it('fits a fraction into the digits that are left', () => {
    const third = divide(fromText('1'), fromText('3'));
    expect(toDisplay(third ?? fromText('0'))).toBe('0.333333333333');

    const big = divide(fromText('10000'), fromText('3'));
    expect(toDisplay(big ?? fromText('0'))).toBe('3333.33333333');
  });

  it('calls a whole part wider than the display an overflow', () => {
    const wide = multiply(fromText('999999999999'), fromText('999999999999'));
    expect(overflows(wide)).toBe(true);
    expect(overflows(fromText('999999999999'))).toBe(false);
    expect(String(DISPLAY_DIGITS)).toBe('12');
  });

  it('does not call a long fraction an overflow', () => {
    const third = divide(fromText('1'), fromText('3'));
    expect(overflows(third ?? fromText('0'))).toBe(false);
  });
});

describe('negate', () => {
  it('flips the sign without changing the magnitude', () => {
    expect(toText(negate(fromText('12.5')))).toBe('-12.5');
    expect(toText(negate(fromText('-12.5')))).toBe('12.5');
    expect(toText(negate(fromText('0')))).toBe('0');
  });
});
