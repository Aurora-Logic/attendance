import type { AppearanceBase } from '@vyuha/shared';

/*
 * The swatch classes, in their own module rather than beside the component.
 * Fast refresh only works when a file exports components alone, and these are
 * shared with the test that asserts each swatch shows the colour it applies.
 */

/** Static classes, one per preset, so a swatch is a class and not a style. */
export const SWATCH: Record<string, string> = {
  pink: 'bg-[oklch(0.457_0.223_4)]',
  rose: 'bg-[oklch(0.457_0.222_17)]',
  red: 'bg-[oklch(0.457_0.213_27.5)]',
  orange: 'bg-[oklch(0.457_0.195_38.4)]',
  amber: 'bg-[oklch(0.457_0.163_49)]',
  yellow: 'bg-[oklch(0.457_0.135_66.4)]',
  lime: 'bg-[oklch(0.457_0.157_131.6)]',
  green: 'bg-[oklch(0.457_0.154_150.1)]',
  emerald: 'bg-[oklch(0.457_0.118_165.6)]',
  teal: 'bg-[oklch(0.457_0.096_186.4)]',
  cyan: 'bg-[oklch(0.457_0.105_223.1)]',
  sky: 'bg-[oklch(0.457_0.134_242.7)]',
  blue: 'bg-[oklch(0.457_0.243_264.4)]',
  indigo: 'bg-[oklch(0.457_0.24_277)]',
  violet: 'bg-[oklch(0.457_0.27_292.6)]',
  purple: 'bg-[oklch(0.457_0.265_301.9)]',
  fuchsia: 'bg-[oklch(0.457_0.253_323.9)]',
  slate: 'bg-[oklch(0.457_0.044_257.3)]',
};

/**
 * A swatch per ramp, at the lightness the page's own surfaces sit at.
 *
 * Built from `APPEARANCE_BASE_TOKENS` by hand rather than interpolated,
 * because Tailwind cannot see a class name assembled at runtime and would
 * purge it -- an arbitrary value has to appear literally in the source. The
 * numbers are the same ones the CSS uses: 0.013 is stone's chroma and the
 * multiplier scales it, so these previews are the ramps rather than an
 * approximation of them.
 */
export const BASE_SWATCH: Record<AppearanceBase, string> = {
  stone: 'bg-[oklch(0.92_0.013_58)]',
  zinc: 'bg-[oklch(0.92_0.016_286)]',
  neutral: 'bg-[oklch(0.92_0_0)]',
  gray: 'bg-[oklch(0.92_0.027_264)]',
  slate: 'bg-[oklch(0.92_0.046_257)]',
};
