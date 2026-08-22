import { DEFAULT_APPEARANCE } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { applyAppearance } from './appearance';

describe('applyAppearance', () => {
  it('writes the four variables and two attributes index.css derives the theme from', () => {
    const root = document.createElement('html');
    applyAppearance(root, { accentHue: 190, accentChroma: 0.13, base: 'cool', density: 'compact' });
    expect(root.style.getPropertyValue('--accent-h')).toBe('190');
    expect(root.style.getPropertyValue('--accent-c')).toBe('0.13');
    expect(root.dataset.base).toBe('cool');
    expect(root.dataset.density).toBe('compact');
    applyAppearance(root, DEFAULT_APPEARANCE);
    expect(root.style.getPropertyValue('--accent-h')).toBe('277');
    expect(root.dataset.base).toBe('stone');
  });
});
