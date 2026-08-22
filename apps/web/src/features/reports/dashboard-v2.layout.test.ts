import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The layout facts that made four charts invisible.
 *
 * The pie, the donut, the radar and the radial bars all rendered as empty
 * cards -- correct header, correct insight, correct total, nothing in
 * between. `CardContent` carried `flex justify-center`, and ChartContainer
 * measures itself through a Recharts ResponsiveContainer: a flex child with
 * no basis resolves to zero width.
 *
 * jsdom has no layout, so it cannot catch this by rendering. The source can.
 */
const source = readFileSync(resolve(__dirname, 'dashboard-v2.tsx'), 'utf8');

describe('dashboard chart layout', () => {
  it('never puts a flex container around a chart', () => {
    const cardContents = [...source.matchAll(/<CardContent([^>]*)>/gu)].map((m) => m[1] ?? '');
    const flexed = cardContents.filter((attributes) => /\bflex\b/u.test(attributes));
    expect(flexed, 'a flex CardContent collapses ChartContainer to zero width').toEqual([]);
  });

  it('centres a square chart with mx-auto instead', () => {
    // Every aspect-square container is one of the round charts, and each one
    // needs the margin rule that replaced the flex.
    const squares = [...source.matchAll(/className="([^"]*aspect-square[^"]*)"/gu)].map((m) => m[1] ?? '');
    expect(squares.length).toBeGreaterThan(0);
    for (const className of squares) {
      expect(className, `"${className}" is not centred`).toContain('mx-auto');
    }
  });

  it('gives a bar carrying a name inside it room for the text', () => {
    // 12px is thinner than the 11px label that sits in it, which wrapped the
    // name to two clipped lines.
    const labelled = /const BAR_LABELLED = (\d+);/u.exec(source);
    expect(labelled).not.toBeNull();
    expect(Number(labelled?.[1])).toBeGreaterThanOrEqual(20);
  });

  it('keeps every bar square', () => {
    const radii = [...source.matchAll(/radius=\{([^}]*)\}/gu)].map((m) => m[1] ?? '');
    for (const radius of radii) {
      expect(radius, 'the theme is square; a rounded bar is the only curve on the page').toBe(
        'SHARP',
      );
    }
    expect(/const SHARP = 0;/u.test(source)).toBe(true);
  });
});
