import { describe, expect, it } from 'vitest';

import { code128 } from './barcode';

/** The encoding a scanner will read, checked by hand against the spec. */
describe('code128', () => {
  it('encodes ABC as start-B, 33 34 35, checksum 1, stop', () => {
    // 104 + 33×1 + 34×2 + 35×3 = 310; 310 mod 103 = 1.
    expect(code128('ABC').symbols).toEqual([104, 33, 34, 35, 1, 106]);
  });

  it('is eleven modules per symbol plus the thirteen-module stop', () => {
    const { width, bars } = code128('DN-0042');
    // start + 7 characters + checksum = 9 symbols × 11, + stop 13.
    expect(width).toBe(9 * 11 + 13);
    // Every symbol is three bars; the stop is four.
    expect(bars).toHaveLength(9 * 3 + 4);
    expect(bars.every(([, w]) => w >= 1 && w <= 4)).toBe(true);
  });

  it('refuses what subset B cannot carry', () => {
    expect(() => code128('')).toThrow();
    expect(() => code128('नमस्ते')).toThrow();
  });
});
