import type { ReportCellValue, ReportKey } from '@vyuha/shared';

/**
 * Series builders for the report charts: pure functions from a page of
 * report rows (the shell's parsed cells) to plottable points and one
 * insight sentence the series proves (vyuha-charts §3). No React, no
 * fetching; every threshold an insight depends on is named here and
 * tested.
 *
 * A chart reads the rows the table shows — same filters, same period — so
 * the picture and the figures beneath it can never disagree. Each builder
 * states the question it answers; a report whose question a table answers
 * better has no builder.
 */

export interface ChartRow {
  readonly cells: Readonly<Record<string, ReportCellValue>>;
}

/** How many bars fit at 360px with readable labels; beyond it, the table has the rest. */
export const MAX_BARS = 8;

function num(value: ReportCellValue | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function text(value: ReportCellValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** en-IN grouping for an insight figure that is read, never computed on. */
export function inr(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
}

// ---------------------------------------------------------------- sales analysis

export interface ValueBarPoint {
  readonly label: string;
  readonly value: number;
}

/** Which group carries the value? Top groups of the current page, one hue. */
export function salesAnalysisSeries(rows: readonly ChartRow[]): { points: ValueBarPoint[]; insight: string | null } {
  const points = rows
    .map((row) => ({ label: text(row.cells.label), value: num(row.cells.value) }))
    .filter((p) => p.label !== '' && p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_BARS);
  if (points.length < 2) return { points, insight: null };
  const total = rows.reduce((sum, row) => sum + num(row.cells.value), 0);
  const top = points[0];
  if (top === undefined || total <= 0) return { points, insight: null };
  const share = Math.round((top.value / total) * 100);
  // Below a fifth, "leads" would dress an even spread up as a headline.
  const insight = share >= 20 ? `${top.label} carries ${String(share)}% of the value shown.` : null;
  return { points, insight };
}

// ---------------------------------------------------------------- movement

export interface MovementPoint {
  readonly month: string;
  readonly inward: number;
  readonly outward: number;
}

/** Is stock building up or draining, month by month? */
export function movementSeries(rows: readonly ChartRow[]): { points: MovementPoint[]; insight: string | null } {
  const byMonth = new Map<string, { inward: number; outward: number }>();
  for (const row of rows) {
    const month = text(row.cells.month);
    if (month === '') continue;
    const entry = byMonth.get(month) ?? { inward: 0, outward: 0 };
    entry.inward += num(row.cells.inwardQty);
    entry.outward += num(row.cells.outwardQty);
    byMonth.set(month, entry);
  }
  const points = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, entry]) => ({ month, ...entry }));
  const last = points.at(-1);
  if (points.length < 2 || last === undefined) return { points, insight: points.length === 0 ? null : 'Not enough months on this page to read a direction.' };
  const net = last.inward - last.outward;
  const insight =
    net > 0
      ? `${last.month}: stock built up by ${inr(net)} units — more came in than went out.`
      : net < 0
        ? `${last.month}: stock drained by ${inr(-net)} units — sales outran purchases.`
        : `${last.month}: inward and outward balanced exactly.`;
  return { points, insight };
}

// ---------------------------------------------------------------- velocity

export interface VelocityPoint {
  readonly item: string;
  readonly monthly12: number;
  readonly monthly3: number;
}

/** Which items move fastest, and is the pace changing? */
export function velocitySeries(rows: readonly ChartRow[]): { points: VelocityPoint[]; insight: string | null } {
  const points = rows
    .map((row) => ({ item: text(row.cells.item), monthly12: num(row.cells.monthly12), monthly3: num(row.cells.monthly3) }))
    .filter((p) => p.item !== '' && p.monthly12 > 0)
    .sort((a, b) => b.monthly12 - a.monthly12)
    .slice(0, MAX_BARS);
  if (points.length === 0) return { points, insight: null };
  // A quickening item runs a quarter past its year pace; a slowing one a quarter under.
  const rising = points.filter((p) => p.monthly3 > p.monthly12 * 1.25).length;
  const falling = points.filter((p) => p.monthly3 < p.monthly12 * 0.75).length;
  const insight =
    rising === 0 && falling === 0
      ? null
      : `Of the top ${String(points.length)}: ${String(rising)} quickening, ${String(falling)} slowing against their own year.`;
  return { points, insight };
}

// ---------------------------------------------------------------- stock ageing

export interface AgeingPoint {
  readonly item: string;
  readonly bucket0: number;
  readonly bucket31: number;
  readonly bucket61: number;
  readonly bucket90: number;
  readonly valueLocked: number;
}

/** Where is stock sitting old — and how much of the money is in the oldest bucket? */
export function ageingSeries(rows: readonly ChartRow[]): { points: AgeingPoint[]; insight: string | null } {
  const points = rows
    .map((row) => ({
      item: text(row.cells.item),
      bucket0: num(row.cells.bucket0),
      bucket31: num(row.cells.bucket31),
      bucket61: num(row.cells.bucket61),
      bucket90: num(row.cells.bucket90),
      valueLocked: num(row.cells.valueLocked),
    }))
    .filter((p) => p.item !== '' && p.bucket0 + p.bucket31 + p.bucket61 + p.bucket90 > 0)
    .sort((a, b) => b.valueLocked - a.valueLocked)
    .slice(0, MAX_BARS);
  if (points.length === 0) return { points, insight: null };
  const totalQty = points.reduce((sum, p) => sum + p.bucket0 + p.bucket31 + p.bucket61 + p.bucket90, 0);
  const oldQty = points.reduce((sum, p) => sum + p.bucket90, 0);
  const share = totalQty > 0 ? Math.round((oldQty / totalQty) * 100) : 0;
  // A quarter of the shelf over ninety days old is a purchasing question, not noise.
  const insight = share >= 25 ? `${String(share)}% of the stock shown has sat over ninety days.` : null;
  return { points, insight };
}

// ---------------------------------------------------------------- customer lapse

export interface LapsePoint {
  readonly customer: string;
  readonly revenue: number;
  readonly state: 'LAPSED' | 'AT_RISK' | 'ON_RHYTHM';
}

/** How much revenue is going quiet, and whose? */
export function lapseSeries(rows: readonly ChartRow[]): { points: LapsePoint[]; insight: string | null } {
  const points: LapsePoint[] = rows
    .map((row): LapsePoint => {
      const state = text(row.cells.state);
      return {
        customer: text(row.cells.partyName),
        revenue: num(row.cells.revenue12m),
        state: state === 'LAPSED' || state === 'AT_RISK' ? state : 'ON_RHYTHM',
      };
    })
    .filter((p) => p.customer !== '' && p.state !== 'ON_RHYTHM' && p.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, MAX_BARS);
  if (points.length === 0) return { points, insight: null };
  const atRisk = points.reduce((sum, p) => sum + p.revenue, 0);
  const lapsed = points.filter((p) => p.state === 'LAPSED').length;
  return {
    points,
    insight: `₹${inr(atRisk)} of last year's revenue is going quiet — ${String(lapsed)} of these ${String(points.length)} customers have fully lapsed.`,
  };
}

/** The keys that draw a chart; everything else is answered by its table. */
export const CHARTED_REPORTS: readonly ReportKey[] = ['sales-analysis', 'movement-analysis', 'item-velocity', 'stock-ageing', 'customer-lapse'];
