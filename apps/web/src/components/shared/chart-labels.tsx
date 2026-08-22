import type { ComponentProps } from 'react';
import type { LabelList } from 'recharts';

/**
 * Values printed on the marks, so a chart can be read without a mouse.
 *
 * The `dataviz` rule this follows: "Columns to value on the cap. Lines to value
 * at the end", and "label selectively -- never a number on every point". Those
 * are not in tension. A column chart has one mark per category and a cap with
 * free space above it, so every column can carry its value; a line has a point
 * every few pixels, so only the end gets one and the axis carries the rest.
 *
 * Two rules hold for both:
 *
 * **Text wears text tokens, never the series colour.** A light categorical hue
 * is illegible as text on the surface, and identity already comes from the
 * coloured mark underneath.
 *
 * **A label that will not fit is not shown.** At 360px twelve columns are about
 * 25px each and no useful number fits between them, so the labels are hidden
 * below `sm` and the tooltip carries the values there. Hiding beats the
 * alternatives -- clipping crops digits, and rotating makes a phone chart into
 * a puzzle.
 */

/**
 * Indian short scale, because these are rupee figures read by people in Nashik.
 *
 * `12,45,600` on a bar cap is wider than the bar. `12.5L` is not, and is how
 * the number would be said out loud. Thousands stay as `45k` rather than
 * `0.5L`, which nobody says.
 */
export function compactIndian(value: number): string {
  const sign = value < 0 ? '−' : '';
  const n = Math.abs(value);
  if (n >= 10_000_000) return `${sign}${trim(n / 10_000_000)}Cr`;
  if (n >= 100_000) return `${sign}${trim(n / 100_000)}L`;
  if (n >= 1_000) return `${sign}${trim(n / 1_000)}k`;
  return `${sign}${String(Math.round(n))}`;
}

/** One decimal, and not a trailing `.0` -- `12L` reads better than `12.0L`. */
function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/u, '');
}

/** A whole count: attendance days, late arrivals, headcount. Never abbreviated
 *  below a thousand, because "7 late arrivals" must not render as "7.0". */
export function compactCount(value: number): string {
  return value >= 1_000 ? compactIndian(value) : String(Math.round(value));
}

const SHARED = {
  position: 'top',
  offset: 6,
  fill: 'var(--muted-foreground)',
  fontSize: 11,
  // `hidden sm:block` on an SVG text node: `display:none` applies to SVG the
  // same way it does to HTML, so this is the honest way to drop labels on a
  // phone rather than letting them overlap.
  className: 'hidden tabular-nums sm:block',
} as const;

/**
 * Every column's value, on its cap. Spread onto a `LabelList` that is a direct
 * child of `Bar` -- Recharts matches on child type, so a wrapper component
 * would be ignored and the labels would silently not render.
 */
export function valueCaps(
  dataKey: string,
  format: (value: number) => string = compactCount,
): Partial<ComponentProps<typeof LabelList>> {
  return {
    ...SHARED,
    dataKey,
    formatter: (value: unknown) => (typeof value === 'number' ? format(value) : ''),
  };
}

/**
 * The last point of a line, and only the last.
 *
 * `dataviz`: a value beside every dot is chaos and goes unread. The endpoint is
 * the one the reader is looking for -- where the series got to.
 */
export function endpointLabel<T extends object>(
  dataKey: keyof T & string,
  data: readonly T[],
  format: (value: number) => string = compactCount,
): Partial<ComponentProps<typeof LabelList>> {
  const last = data.length - 1;
  return {
    ...SHARED,
    dataKey,
    // Keyed on the index Recharts hands in, not on a counter this closure
    // increments. A counter assumes the formatter is called once per point in
    // order; Recharts re-renders and re-measures, so it is called more often
    // than that and the label would wander to whichever point happened to be
    // counted last.
    content: (props: unknown) => {
      const { x, y, index } = props as { x?: number; y?: number; index?: number };
      if (x === undefined || y === undefined || index !== last) return null;
      const row = data[index];
      if (row === undefined) return null;
      const value: unknown = row[dataKey];
      if (typeof value !== 'number') return null;
      return (
        <text
          x={x}
          y={y - 8}
          textAnchor="end"
          className="hidden tabular-nums sm:block"
          fill="var(--muted-foreground)"
          fontSize={11}
        >
          {format(value)}
        </text>
      );
    },
  };
}

/**
 * Every bar's value, at its tip -- the horizontal-layout twin of `valueCaps`.
 *
 * `dataviz` states them as two rules because they are two geometries: "Bars to
 * value at the tip. Columns to value on the cap." A horizontal bar grows
 * rightwards, so `position: top` puts the number above the bar rather than
 * after it, where it either collides with the bar above or falls outside the
 * plot and is never drawn at all.
 *
 * The chart needs right margin to receive it -- a tip label on the longest bar
 * sits past the end of the axis, and without room it is clipped.
 */
export function valueTips(
  dataKey: string,
  format: (value: number) => string = compactCount,
): Partial<ComponentProps<typeof LabelList>> {
  return {
    ...SHARED,
    position: 'right',
    offset: 8,
    dataKey,
    formatter: (value: unknown) => (typeof value === 'number' ? format(value) : ''),
  };
}

/**
 * The stack's total, on the cap of the whole column.
 *
 * Interior stacked segments get no inline label, and that is not a shortcut.
 * `dataviz`: a segment has no free end, so the label must sit *inside* the
 * fill, and it may only do that when it fits with padding and contrasts with
 * the fill. Neither holds here -- this theme's ramp runs from `oklch(0.81)` to
 * `oklch(0.586)`, so one ink is either invisible on the light steps or on the
 * dark ones, and a short segment has no room regardless. Clipping digits is
 * worse than no label.
 *
 * So the column carries the number that answers the chart's question -- how
 * many altogether -- in text tokens on the surface where it is always legible,
 * and the split stays in the legend and the tooltip. Spread onto a `LabelList`
 * inside the **last** `Bar` of the stack: it is positioned by that segment's
 * top, which is the top of the stack.
 */
export function stackTotal<T extends object>(
  data: readonly T[],
  keys: readonly (keyof T & string)[],
  format: (value: number) => string = compactCount,
): Partial<ComponentProps<typeof LabelList>> {
  return {
    ...SHARED,
    position: 'top',
    // `content` rather than `dataKey`, because the total is not a column in the
    // data and adding one would mean editing every series builder to serve a
    // presentational need.
    content: (props: unknown) => {
      // `x` is the bar's left edge and `width` its thickness -- Recharts does
      // not hand back a centre. With textAnchor="middle" the label would sit a
      // half-bar to the left of where it belongs without this.
      const { x, y, width, index } = props as {
        x?: number; y?: number; width?: number; index?: number;
      };
      if (x === undefined || y === undefined || width === undefined || index === undefined) {
        return null;
      }
      const row = data[index];
      if (row === undefined) return null;
      const total = keys.reduce<number>((sum, key) => {
        const value: unknown = row[key];
        return sum + (typeof value === 'number' ? value : 0);
      }, 0);
      if (total === 0) return null;
      return (
        <text
          x={x + width / 2}
          y={y - 6}
          textAnchor="middle"
          className="hidden tabular-nums sm:block"
          fill="var(--muted-foreground)"
          fontSize={11}
        >
          {format(total)}
        </text>
      );
    },
  };
}
