import { z } from 'zod';

/**
 * Workspace appearance (owner, 22 Aug 2026): the accent and the base are
 * the organisation's, light and dark are each person's. The accent is a
 * hue and a chroma at the theme's fixed lightness, so any hue keeps the
 * contrast the theme was measured at; the base is the temperature of the
 * neutrals; density scales spacing, not type.
 */
export const APPEARANCE_BASES = ['stone', 'cool', 'warm'] as const;
export type AppearanceBase = (typeof APPEARANCE_BASES)[number];
export const APPEARANCE_BASE_LABELS: Record<AppearanceBase, string> = {
  stone: 'Stone',
  cool: 'Cool',
  warm: 'Warm',
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
  base: z.enum(APPEARANCE_BASES),
  density: z.enum(APPEARANCE_DENSITIES),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = { accentHue: 277, accentChroma: 0.24, base: 'stone', density: 'comfortable' };

/** The preset a hue and chroma correspond to, if any; a custom hue has none. */
export function presetFor(appearance: Pick<Appearance, 'accentHue' | 'accentChroma'>): AccentPreset | null {
  return ACCENT_PRESETS.find((preset) => Math.abs(preset.hue - appearance.accentHue) < 0.5 && Math.abs(preset.chroma - appearance.accentChroma) < 0.005) ?? null;
}
