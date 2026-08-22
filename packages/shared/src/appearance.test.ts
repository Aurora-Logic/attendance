import { describe, expect, it } from 'vitest';

import { APPEARANCE_BASES, appearanceSchema } from './appearance.js';

describe('appearanceSchema, on a base written by an older build', () => {
  const stored = { accentHue: 277, accentChroma: 0.24, density: 'comfortable' } as const;

  it('resolves a retired base instead of failing the whole object', () => {
    // The failure this prevents: an organisation that picked "cool" gets a 500
    // on every settings read, and the screen that would let them pick again is
    // the screen that will not load.
    const parsed = appearanceSchema.safeParse({ ...stored, base: 'cool' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.base).toBe('gray');
  });

  it('resolves an unrecognised base rather than rejecting it', () => {
    const parsed = appearanceSchema.safeParse({ ...stored, base: 'mauve' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.base).toBe('stone');
  });

  it('leaves a current preset exactly as it was', () => {
    for (const base of APPEARANCE_BASES) {
      const parsed = appearanceSchema.safeParse({ ...stored, base });
      expect(parsed.success && parsed.data.base).toBe(base);
    }
  });

  it('still rejects a bad accent, so the forgiveness is scoped to the base', () => {
    // Preprocessing one field must not turn the object into anything-goes.
    expect(appearanceSchema.safeParse({ ...stored, base: 'stone', accentHue: 999 }).success).toBe(false);
  });
});
