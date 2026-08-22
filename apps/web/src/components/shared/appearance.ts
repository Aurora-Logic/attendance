import type { Appearance } from '@vyuha/shared';

/**
 * The workspace's appearance, applied to the document: four custom
 * properties and two data attributes on <html> that index.css derives
 * every accent and neutral from. This is the one place the product sets a
 * style from JavaScript, and it sets variables, not styles -- every colour
 * still lives in index.css, in both modes.
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  root.style.setProperty('--accent-h', String(appearance.accentHue));
  root.style.setProperty('--accent-c', String(appearance.accentChroma));
  root.dataset.base = appearance.base;
  root.dataset.density = appearance.density;
}
