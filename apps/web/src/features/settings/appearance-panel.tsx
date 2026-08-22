import { useEffect } from 'react';
import { ArrowCounterClockwiseIcon, CheckIcon } from '@phosphor-icons/react';

import { applyAppearance } from '@/components/shared/appearance';
import { SectionHeading } from '@/components/shared/section-heading';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import {
  ACCENT_PRESETS,
  APPEARANCE_BASES,
  APPEARANCE_BASE_LABELS,
  APPEARANCE_DENSITIES,
  APPEARANCE_DENSITY_LABELS,
  DEFAULT_APPEARANCE,
  presetFor,
  type Appearance,
  type AppearanceBase,
} from '@vyuha/shared';

import { EnforcementNote } from './policy-fields';

/**
 * The workspace's colour and density, with the page as the preview: every
 * change is applied to the document at once, and Save or Discard on the
 * page settles it. Eight accents in fixed order, and a hue for any other,
 * all at the lightness the theme was measured at; three bases; two
 * densities. No hex field: a picker that can choose any colour can choose
 * one the text cannot sit on.
 */
const CUSTOM_CHROMA = 0.22;

/** Static classes, one per preset, so a swatch is a class and not a style. */
const SWATCH: Record<string, string> = {
  indigo: 'bg-[oklch(0.457_0.24_277)]',
  blue: 'bg-[oklch(0.457_0.2_255)]',
  teal: 'bg-[oklch(0.457_0.13_190)]',
  green: 'bg-[oklch(0.457_0.15_150)]',
  amber: 'bg-[oklch(0.457_0.16_70)]',
  rose: 'bg-[oklch(0.457_0.2_15)]',
  violet: 'bg-[oklch(0.457_0.22_305)]',
  slate: 'bg-[oklch(0.457_0.06_260)]',
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
const BASE_SWATCH: Record<AppearanceBase, string> = {
  stone: 'bg-[oklch(0.92_0.013_58)]',
  zinc: 'bg-[oklch(0.92_0.016_286)]',
  neutral: 'bg-[oklch(0.92_0_0)]',
  gray: 'bg-[oklch(0.92_0.027_264)]',
  slate: 'bg-[oklch(0.92_0.046_257)]',
};

export function AppearancePanel({ value, saved, enforcedBy, onChange }: { value: Appearance; saved: Appearance; enforcedBy: string | null | undefined; onChange: (next: Partial<Appearance>) => void }) {
  // The page is the preview. On unmount -- the tab left, the page left --
  // the saved appearance comes back, so an unsaved draft never outlives the
  // screen that made it.
  useEffect(() => {
    applyAppearance(document.documentElement, value);
  }, [value]);
  useEffect(
    () => () => {
      applyAppearance(document.documentElement, saved);
    },
    [saved],
  );

  const preset = presetFor(value);
  const isShipped = JSON.stringify(value) === JSON.stringify(DEFAULT_APPEARANCE);

  return (
    <div className="flex flex-col gap-6 border p-4">
      <SectionHeading
        title="Appearance"
        note="The accent and the base are the workspace's; light and dark are each person's. The page shows the change as you make it."
        action={
          <Button variant="ghost" size="sm" disabled={isShipped} onClick={() => { onChange(DEFAULT_APPEARANCE); }}>
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            As shipped
          </Button>
        }
      />

      <FieldGroup className="gap-6">
        <Field>
          <FieldLabel>Accent</FieldLabel>
          <div role="radiogroup" aria-label="Accent" className="flex flex-wrap gap-2">
            {ACCENT_PRESETS.map((candidate) => {
              const selected = preset?.id === candidate.id;
              return (
                <Button
                  key={candidate.id}
                  type="button"
                  variant="outline"
                  role="radio"
                  aria-checked={selected}
                  aria-label={candidate.label}
                  className={cn('gap-2 pl-1.5', selected && 'border-foreground')}
                  onClick={() => {
                    onChange({ accentHue: candidate.hue, accentChroma: candidate.chroma });
                  }}
                >
                  <span aria-hidden className={cn('flex size-5 items-center justify-center', SWATCH[candidate.id])}>
                    {selected ? <CheckIcon className="size-3 text-white" /> : null}
                  </span>
                  {candidate.label}
                </Button>
              );
            })}
          </div>
          <FieldDescription>
            {preset ? `${preset.label}, at the lightness the theme was measured at.` : `A custom hue at ${String(Math.round(value.accentHue))}°; the lightness and contrast are the theme's.`}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="appearance-hue">Any other hue</FieldLabel>
          <div className="flex items-center gap-3">
            <span aria-hidden className="bg-primary size-5 shrink-0" />
            <Slider
              id="appearance-hue"
              aria-label="Accent hue"
              min={0}
              max={360}
              step={1}
              value={[Math.round(value.accentHue)]}
              onValueChange={(next: number | readonly number[]) => {
                const hue = typeof next === 'number' ? next : next[0];
                if (typeof hue === 'number') onChange({ accentHue: hue, accentChroma: preset ? CUSTOM_CHROMA : value.accentChroma });
              }}
              className="max-w-md"
            />
            <span className="w-10 text-right text-xs tabular-nums">{String(Math.round(value.accentHue))}°</span>
          </div>
          <FieldDescription>Drag to a brand hue. The swatch is the accent the page is wearing now.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Base</FieldLabel>
          <ToggleGroup
            variant="outline"
            aria-label="Base"
            value={[value.base]}
            onValueChange={(next: string[]) => {
              const base = next[0];
              if (APPEARANCE_BASES.includes(base as AppearanceBase)) onChange({ base: base as AppearanceBase });
            }}
          >
            {APPEARANCE_BASES.map((base) => (
              <ToggleGroupItem key={base} value={base} className="gap-2 pl-1.5">
                <span aria-hidden className={cn('size-4 border', BASE_SWATCH[base])} />
                {APPEARANCE_BASE_LABELS[base]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>The temperature of every surface, border and muted word, in both modes.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Density</FieldLabel>
          <ToggleGroup
            variant="outline"
            aria-label="Density"
            value={[value.density]}
            onValueChange={(next: string[]) => {
              const density = next[0];
              if (density === 'comfortable' || density === 'compact') onChange({ density });
            }}
          >
            {APPEARANCE_DENSITIES.map((density) => (
              <ToggleGroupItem key={density} value={density}>
                {APPEARANCE_DENSITY_LABELS[density]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>Compact tightens spacing by a fifth; type stays its size and touch targets stay 44px.</FieldDescription>
        </Field>
      </FieldGroup>

      <EnforcementNote by={enforcedBy} />
    </div>
  );
}
