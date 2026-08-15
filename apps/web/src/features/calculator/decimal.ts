/**
 * Exact decimal arithmetic for REQ-N-03.
 *
 * ## Why not `number`
 *
 * A binary double cannot represent 0.1, so `0.1 + 0.2` is
 * 0.30000000000000004 and `1.1 * 3` is 3.3000000000000003. A calculator that
 * prints either of those in front of somebody reconciling hours against a
 * payslip has destroyed its own credibility, and rounding the display to hide
 * it only moves the error: the wrong value is still what the next operation
 * uses, and it compounds.
 *
 * ## What this is instead
 *
 * A value is an integer and a scale: `{ units: 3n, scale: 1 }` is 0.3. Addition
 * aligns scales and adds integers, multiplication adds scales -- both exact,
 * because `bigint` has no width. Only division can be inexact, and it is the
 * one operation that states its precision and rounds explicitly.
 *
 * `bigint` is a language builtin, so this costs no dependency (CLAUDE.md §6).
 *
 * Nothing here is money. It is a general four-function calculator; CLAUDE.md §3
 * rule 7 forbids payroll maths, and there is none, no currency and no rounding
 * rule borrowed from one.
 */

export interface Decimal {
  readonly units: bigint;
  /** Decimal places. Never negative. */
  readonly scale: number;
}

export const ZERO: Decimal = { units: 0n, scale: 0 };

/**
 * Digits a Casio-sized display holds.
 *
 * The cap is real rather than cosmetic: an entry longer than this is refused at
 * the keypad, and a result wider than this is an overflow rather than a number
 * printed in a way that cannot be read back.
 */
export const DISPLAY_DIGITS = 12;

/**
 * Working precision for division, two digits wider than the display.
 *
 * The guard digits are what a physical calculator carries too: they keep a
 * chained calculation from losing a unit in the last displayed place, and they
 * never surface, because the display rounds to `DISPLAY_DIGITS`.
 */
export const DIVISION_SCALE = DISPLAY_DIGITS + 2;

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** Drops trailing zeros so 0.30 and 0.3 are the same value and print the same. */
export function normalise(value: Decimal): Decimal {
  let { units, scale } = value;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return { units, scale };
}

function align(a: Decimal, b: Decimal): { a: bigint; b: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  return {
    a: a.units * pow10(scale - a.scale),
    b: b.units * pow10(scale - b.scale),
    scale,
  };
}

export function add(a: Decimal, b: Decimal): Decimal {
  const aligned = align(a, b);
  return normalise({ units: aligned.a + aligned.b, scale: aligned.scale });
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const aligned = align(a, b);
  return normalise({ units: aligned.a - aligned.b, scale: aligned.scale });
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  return normalise({ units: a.units * b.units, scale: a.scale + b.scale });
}

export function isZero(value: Decimal): boolean {
  return value.units === 0n;
}

export function negate(value: Decimal): Decimal {
  return { units: -value.units, scale: value.scale };
}

/**
 * Exact division where it divides exactly, and half-away-from-zero to
 * `DIVISION_SCALE` where it does not.
 *
 * Half away from zero rather than banker's rounding: this is a desk calculator,
 * and the answer somebody expects from 2.5 is 3, not 2. Returns null for a
 * division by zero, which is a state the caller has to show rather than a
 * number it can print.
 */
export function divide(a: Decimal, b: Decimal, scale: number = DIVISION_SCALE): Decimal | null {
  if (b.units === 0n) return null;

  const exponent = scale + b.scale - a.scale;
  let numerator = a.units;
  let denominator = b.units;
  if (exponent >= 0) numerator *= pow10(exponent);
  else denominator *= pow10(-exponent);

  const negative = numerator < 0n !== denominator < 0n;
  const top = absBigInt(numerator);
  const bottom = absBigInt(denominator);
  const quotient = top / bottom;
  const remainder = top % bottom;
  const rounded = remainder * 2n >= bottom ? quotient + 1n : quotient;

  return normalise({ units: negative ? -rounded : rounded, scale });
}

/** Rounds to `places`, half away from zero. Used only to fit the display. */
export function round(value: Decimal, places: number): Decimal {
  if (value.scale <= places) return value;

  const factor = pow10(value.scale - places);
  const negative = value.units < 0n;
  const magnitude = absBigInt(value.units);
  const quotient = magnitude / factor;
  const remainder = magnitude % factor;
  const rounded = remainder * 2n >= factor ? quotient + 1n : quotient;

  return normalise({ units: negative ? -rounded : rounded, scale: places });
}

/** Digits left of the point, ignoring the sign. `0` has one. */
function integerDigits(value: Decimal): number {
  const magnitude = absBigInt(value.units).toString();
  const whole = magnitude.length - value.scale;
  return whole > 0 ? whole : 1;
}

/** True when the whole part alone is wider than the display can hold. */
export function overflows(value: Decimal): boolean {
  return integerDigits(value) > DISPLAY_DIGITS;
}

/**
 * The value as a `Decimal` again, from a typed entry like `-12.30` or `.5`.
 *
 * Throws rather than returning a wrong value: every caller builds the string
 * itself one keypress at a time, so a string this cannot read is a bug in the
 * keypad rather than input from a person.
 */
export function fromText(text: string): Decimal {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/u.exec(text);
  if (match === null) throw new Error(`"${text}" is not a decimal entry.`);

  const [, sign = '', whole = '', fraction = ''] = match;
  const digits = `${whole}${fraction}`;
  const units = digits === '' ? 0n : BigInt(digits);
  return normalise({ units: sign === '-' ? -units : units, scale: fraction.length });
}

/** The plain decimal text, with no separators and no exponent. */
export function toText(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = absBigInt(value.units).toString();

  if (value.scale === 0) return `${negative ? '-' : ''}${digits}`;

  const padded = digits.padStart(value.scale + 1, '0');
  const whole = padded.slice(0, padded.length - value.scale);
  const fraction = padded.slice(padded.length - value.scale);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * What the display shows: the value rounded to whatever the remaining places
 * allow, so a twelve-digit window is filled rather than overrun.
 *
 * A leading `0.` costs nothing, because that zero is a placeholder rather than
 * a digit somebody read off the display.
 */
export function toDisplay(value: Decimal): string {
  const wholePart = absBigInt(value.units) / pow10(value.scale);
  const allowed =
    wholePart === 0n ? DISPLAY_DIGITS : Math.max(0, DISPLAY_DIGITS - wholePart.toString().length);
  return toText(round(normalise(value), allowed));
}

/** Digits typed so far, ignoring the sign and the point. */
export function typedDigitCount(text: string): number {
  return text.replaceAll(/[^\d]/gu, '').length;
}
