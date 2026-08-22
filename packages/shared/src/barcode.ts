/**
 * Code 128, subset B — the barcode on the packing slip (D-47). Pure: text in,
 * bar positions out, so the encoding is unit-tested without an SVG. The
 * pattern table is the standard one: six module widths per symbol, bar and
 * space alternating, start-B 104, stop 106 (seven widths), checksum mod 103.
 */

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

const START_B = 104;
const STOP = 106;

export interface BarcodeBars {
  /** [x, width] in modules, bars only; spaces are the gaps between them. */
  readonly bars: readonly (readonly [number, number])[];
  /** Total width in modules, quiet zones excluded. */
  readonly width: number;
  /** The symbol values encoded, start through stop — what a reader decodes. */
  readonly symbols: readonly number[];
}

/** Subset B covers printable ASCII 32–127; anything else is refused rather than silently misencoded. */
export function code128(text: string): BarcodeBars {
  if (text.length === 0) throw new Error('A barcode needs at least one character.');
  const values = [START_B];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Code 128 B cannot encode "${char}".`);
    values.push(code - 32);
  }
  let sum = START_B;
  for (let i = 1; i < values.length; i += 1) sum += (values[i] ?? 0) * i;
  values.push(sum % 103, STOP);

  const bars: [number, number][] = [];
  let x = 0;
  for (const value of values) {
    const pattern = PATTERNS[value] ?? '';
    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) bars.push([x, width]);
      x += width;
    }
  }
  return { bars, width: x, symbols: values };
}
