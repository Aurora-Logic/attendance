/**
 * The heatmap's arithmetic, shared by the reports and the lifecycles: a
 * category × month grid from flat points, and which of five ramp steps a
 * cell takes — quantiles of the grid's own maximum, never the palette
 * cycled (dataviz skill: sequential is one hue, light to dark).
 */

export interface HeatPoint {
  readonly category: string;
  readonly month: string;
  readonly value: number;
  readonly rowId?: string | null;
}

export interface HeatGrid {
  readonly months: readonly string[];
  readonly rows: readonly { readonly category: string; readonly rowId: string; readonly cells: readonly (number | null)[] }[];
  readonly max: number;
}

/**
 * Months come out sorted so August follows July whatever order the rows
 * arrived in; categories keep their arrival order (the caller's ranking).
 * A cell is null where the pair never met.
 */
export function heatGridOf(points: readonly HeatPoint[]): HeatGrid {
  const months = [...new Set(points.map((point) => point.month).filter((month) => month !== ''))].sort();
  const byCategory = new Map<string, { rowId: string; values: Map<string, number> }>();
  for (const point of points) {
    const entry = byCategory.get(point.category) ?? { rowId: point.rowId ?? '', values: new Map<string, number>() };
    entry.values.set(point.month, (entry.values.get(point.month) ?? 0) + point.value);
    byCategory.set(point.category, entry);
  }
  let max = 0;
  const rows = [...byCategory.entries()].map(([category, entry]) => {
    const cells = months.map((month) => {
      const value = entry.values.get(month);
      if (value !== undefined && value > max) max = value;
      return value ?? null;
    });
    return { category, rowId: entry.rowId, cells };
  });
  return { months, rows, max };
}

/** Which of the five ramp steps a cell takes: quantiles of the grid's own maximum. */
export function heatmapStep(value: number | null, max: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (value === null || value <= 0 || max <= 0) return 0;
  const share = value / max;
  if (share > 0.8) return 5;
  if (share > 0.6) return 4;
  if (share > 0.4) return 3;
  if (share > 0.2) return 2;
  return 1;
}
