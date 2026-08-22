import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The chart ramp must follow the appearance.
 *
 * It shipped as five frozen pinks in both `:root` and `.dark` -- identical
 * values, no relation to `--accent-h`, so a workspace set to teal drew pink
 * bars and dark mode was a copy of light rather than a choice. Nothing caught
 * it because a colour that is merely wrong still renders.
 */
const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

function chartTokens(): { line: string; slot: number }[] {
  return [...css.matchAll(/^\s*--chart-([1-5]):\s*(.+);$/gmu)].map((m) => ({
    slot: Number(m[1]),
    line: m[2] ?? '',
  }));
}

describe('chart colour tokens', () => {
  it('defines all five slots twice — once for light, once for dark', () => {
    const tokens = chartTokens();
    expect(tokens).toHaveLength(10);
    for (const slot of [1, 2, 3, 4, 5]) {
      expect(tokens.filter((t) => t.slot === slot)).toHaveLength(2);
    }
  });

  it('derives every slot from the accent rather than freezing a hue', () => {
    for (const token of chartTokens()) {
      expect(token.line, `--chart-${String(token.slot)} ignores the accent hue`).toContain(
        'var(--accent-h)',
      );
      expect(token.line, `--chart-${String(token.slot)} ignores the accent chroma`).toContain(
        'var(--chart-c)',
      );
    }
  });

  it('clamps the chroma so a low-chroma accent cannot draw a gray chart', () => {
    // slate's accent chroma is 0.044; the data-viz floor is 0.10.
    const clamp = /--chart-c:\s*clamp\(([\d.]+),\s*var\(--accent-c\),\s*([\d.]+)\)/u.exec(css);
    expect(clamp).not.toBeNull();
    expect(Number(clamp?.[1])).toBeGreaterThanOrEqual(0.1);
  });

  it('steps light and dark in opposite directions rather than copying one into the other', () => {
    const lightness = (slot: number): number[] =>
      chartTokens()
        .filter((t) => t.slot === slot)
        .map((t) => Number(/oklch\(([\d.]+)/u.exec(t.line)?.[1] ?? Number.NaN));

    const [lightFirst, darkFirst] = lightness(1);
    const [lightLast, darkLast] = lightness(5);
    // Light goes dark as the slot climbs; dark goes light. Identical ramps were
    // the bug.
    expect(lightLast).toBeLessThan(lightFirst ?? 0);
    expect(darkLast).toBeGreaterThan(darkFirst ?? 1);
  });
});
