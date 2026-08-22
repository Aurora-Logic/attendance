import { z } from 'zod';

/**
 * Workspace appearance (owner, 22 Aug 2026): the accent and the base are
 * the organisation's, light and dark are each person's. The accent is a
 * hue and a chroma at the theme's fixed lightness, so any hue keeps the
 * contrast the theme was measured at; the base is the temperature of the
 * neutrals; density scales spacing, not type.
 */
/**
 * The five neutral ramps shadcn ships, by their own names.
 *
 * These replace the hand-rolled `cool` and `warm`, which were the same idea
 * with names nobody could map onto anything. A designer asked for "zinc" gets
 * zinc; the hue and chroma below are read off Tailwind's own `theme.css`
 * rather than eyeballed, so `stone` here is the same stone a Tailwind class
 * would give.
 */
export const APPEARANCE_BASES = ['stone', 'zinc', 'neutral', 'gray', 'slate'] as const;
export type AppearanceBase = (typeof APPEARANCE_BASES)[number];
export const APPEARANCE_BASE_LABELS: Record<AppearanceBase, string> = {
  stone: 'Stone',
  zinc: 'Zinc',
  neutral: 'Neutral',
  gray: 'Gray',
  slate: 'Slate',
};

/**
 * What a base stored before this change resolves to now.
 *
 * `cool` and `warm` are in at least one organisation's settings row, and an
 * enum that no longer contains them would fail the schema on read -- the
 * appearance would not load, and the screen that fixes it is the one that
 * would not render. Mapped to their nearest shadcn ramp by hue: `cool` was
 * hue 264, which is `gray`; `warm` was hue 70, nearest `stone` at 58.
 *
 * Kept rather than migrated in SQL because it costs nothing and a settings
 * row written by an older build can still arrive from a backup restore.
 */
const RETIRED_BASES: Record<string, AppearanceBase> = {
  cool: 'gray',
  warm: 'stone',
};

/** The stored value, or its replacement, or the default. Never throws. */
export function resolveAppearanceBase(stored: string | null | undefined): AppearanceBase {
  if (stored === null || stored === undefined) return 'stone';
  if ((APPEARANCE_BASES as readonly string[]).includes(stored)) return stored as AppearanceBase;
  return RETIRED_BASES[stored] ?? 'stone';
}

/**
 * Hue and chroma multiplier per ramp, from Tailwind v4's `theme.css`.
 *
 * `chroma` is a multiplier, not a chroma: `index.css` builds every neutral as
 * `calc(<step> * var(--base-k))`, where the steps were authored against stone.
 * So stone is 1 by definition and the others are their chroma over stone's --
 * zinc 0.016/0.013, gray 0.027/0.013, slate 0.046/0.013. Neutral is 0, which
 * is the point of neutral: no hue at all.
 */
export const APPEARANCE_BASE_TOKENS: Record<AppearanceBase, { hue: number; chroma: number }> = {
  stone: { hue: 58, chroma: 1 },
  zinc: { hue: 286, chroma: 1.23 },
  neutral: { hue: 0, chroma: 0 },
  gray: { hue: 264, chroma: 2.08 },
  slate: { hue: 257, chroma: 3.54 },
};

export const APPEARANCE_DENSITIES = ['comfortable', 'compact'] as const;
export type AppearanceDensity = (typeof APPEARANCE_DENSITIES)[number];
export const APPEARANCE_DENSITY_LABELS: Record<AppearanceDensity, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
};

export interface AccentPreset {
  readonly id: string;
  readonly label: string;
  readonly hue: number;
  readonly chroma: number;
}

/** Eight accents in fixed order; the first is the theme as shipped. */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: 'indigo', label: 'Indigo', hue: 277, chroma: 0.24 },
  { id: 'blue', label: 'Blue', hue: 255, chroma: 0.2 },
  { id: 'teal', label: 'Teal', hue: 190, chroma: 0.13 },
  { id: 'green', label: 'Green', hue: 150, chroma: 0.15 },
  { id: 'amber', label: 'Amber', hue: 70, chroma: 0.16 },
  { id: 'rose', label: 'Rose', hue: 15, chroma: 0.2 },
  { id: 'violet', label: 'Violet', hue: 305, chroma: 0.22 },
  { id: 'slate', label: 'Slate', hue: 260, chroma: 0.06 },
];

export const appearanceSchema = z.object({
  accentHue: z.number().min(0).max(360),
  accentChroma: z.number().min(0.02).max(0.3),
  /*
   * Preprocessed rather than a bare enum, so a base written by an older build
   * resolves instead of failing the whole object. Putting it here rather than
   * at each read site means no caller has to remember: the settings endpoint,
   * the shell's boot fetch and a restored backup all get the same answer.
   *
   * Forgiving on write too, which is deliberate. This is a display preference,
   * not a boundary worth a 400 -- a client that sends `cool` gets `gray` and a
   * page that looks right, rather than an error about a value it did not know
   * was retired.
   */
  base: z.preprocess(
    (value) => resolveAppearanceBase(typeof value === 'string' ? value : null),
    z.enum(APPEARANCE_BASES),
  ),
  density: z.enum(APPEARANCE_DENSITIES),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = { accentHue: 277, accentChroma: 0.24, base: 'stone', density: 'comfortable' };

/** The preset a hue and chroma correspond to, if any; a custom hue has none. */
export function presetFor(appearance: Pick<Appearance, 'accentHue' | 'accentChroma'>): AccentPreset | null {
  return ACCENT_PRESETS.find((preset) => Math.abs(preset.hue - appearance.accentHue) < 0.5 && Math.abs(preset.chroma - appearance.accentChroma) < 0.005) ?? null;
}
