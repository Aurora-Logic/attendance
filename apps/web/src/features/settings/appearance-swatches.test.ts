import { ACCENT_PRESETS, APPEARANCE_BASES } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { SWATCH } from './appearance-swatches';

/**
 * A swatch is a promise about what clicking it will do. These assert the
 * promise is kept, which no type can: the class is a string and the preset is
 * a pair of numbers, and nothing but this connects them.
 */

/** `bg-[oklch(0.457_0.24_277)]` to `{ lightness, chroma, hue }`. */
function parse(cls: string): { lightness: number; chroma: number; hue: number } | null {
  const m = /oklch\(([\d.]+)_([\d.]+)_([\d.]+)\)/u.exec(cls);
  if (m === null) return null;
  return { lightness: Number(m[1]), chroma: Number(m[2]), hue: Number(m[3]) };
}

describe('accent swatches', () => {
  it('has one for every preset', () => {
    // The failure: add a preset, forget the class, ship an invisible tile.
    for (const preset of ACCENT_PRESETS) {
      expect(SWATCH[preset.id], `no swatch for ${preset.id}`).toBeDefined();
    }
  });

  it('shows the colour it will actually apply', () => {
    // A swatch that previews one hue and sets another is worse than no
    // preview -- the person picks what they saw and gets something else.
    for (const preset of ACCENT_PRESETS) {
      const parsed = parse(SWATCH[preset.id] ?? '');
      expect(parsed, `unparseable swatch for ${preset.id}`).not.toBeNull();
      if (parsed === null) continue;
      expect(parsed.hue, `${preset.id} hue`).toBeCloseTo(preset.hue, 1);
      expect(parsed.chroma, `${preset.id} chroma`).toBeCloseTo(preset.chroma, 3);
    }
  });

  it('previews every accent at the lightness the theme pins them to', () => {
    // index.css builds --primary as oklch(0.457 ...). A swatch at any other
    // lightness would be a different colour from the one the page takes.
    for (const preset of ACCENT_PRESETS) {
      expect(parse(SWATCH[preset.id] ?? '')?.lightness, preset.id).toBe(0.457);
    }
  });

  it('offers no preset the schema would reject', () => {
    // accentChroma is bounded 0.02-0.3; a preset outside it would be a button
    // that fails on save.
    for (const preset of ACCENT_PRESETS) {
      expect(preset.chroma, `${preset.id} chroma`).toBeGreaterThanOrEqual(0.02);
      expect(preset.chroma, `${preset.id} chroma`).toBeLessThanOrEqual(0.3);
      expect(preset.hue, `${preset.id} hue`).toBeGreaterThanOrEqual(0);
      expect(preset.hue, `${preset.id} hue`).toBeLessThanOrEqual(360);
    }
  });

  it('gives every preset a distinct id, so selection cannot be ambiguous', () => {
    const ids = ACCENT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(18);
    expect(APPEARANCE_BASES.length).toBe(5);
  });
});
