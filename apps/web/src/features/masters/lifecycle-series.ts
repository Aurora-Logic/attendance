import { heatGridOf, type HeatGrid } from '@/components/shared/heat-grid';
import type { HeatCell, ItemAnalytics, ItemMonthPoint, PartyAnalytics, PartyMonthPoint } from '@vyuha/shared';

/**
 * Pure builders from the analytics the API answers to what the lifecycle
 * pages draw (vyuha-charts skill §2): no React, no fetching, every
 * threshold an insight depends on named here and tested.
 *
 * The questions, so the forms follow (dataviz: the job picks the form):
 * - "Is this item moving, and is it leaving as fast as it is ordered?" — a
 *   trend of ordered and dispatched per month, the comparison range dashed
 *   beside it, aligned month for month.
 * - "Who buys it / who supplies it?" — a ranking, eight at most; the table
 *   carries the rest.
 * - "When does each customer buy?" — a customer × month grid.
 * - "How much of what was ordered has left?" — one rate, a radial.
 */

export interface TrendPoint {
  readonly month: string;
  /** "Aug 26". */
  readonly label: string;
  readonly a: number;
  readonly b: number;
  readonly aPrev: number | null;
  readonly bPrev: number | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function monthLabel(month: string): string {
  const [y = '', m = ''] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

/**
 * Two measures over the months, with the comparison range's months laid
 * beside them by position (the first month against the first month),
 * because "same period last year" is read month against month and a
 * previous period of equal length lines up the same way.
 */
export function trendSeries<T extends { month: string }>(monthly: readonly T[], comparison: readonly T[] | null, a: (p: T) => number, b: (p: T) => number): TrendPoint[] {
  return monthly.map((point, index) => {
    const prev = comparison?.[index];
    return { month: point.month, label: monthLabel(point.month), a: a(point), b: b(point), aPrev: prev === undefined ? null : a(prev), bPrev: prev === undefined ? null : b(prev) };
  });
}

export const itemTrend = (analytics: Pick<ItemAnalytics, 'monthly' | 'monthlyComparison'>): TrendPoint[] =>
  trendSeries<ItemMonthPoint>(analytics.monthly, analytics.monthlyComparison, (p) => p.ordered, (p) => p.dispatched);

export const partyTrend = (analytics: Pick<PartyAnalytics, 'monthly' | 'monthlyComparison'>): TrendPoint[] =>
  trendSeries<PartyMonthPoint>(analytics.monthly, analytics.monthlyComparison, (p) => p.revenue, (p) => p.collected);

export const vendorTrend = (analytics: Pick<PartyAnalytics, 'monthly' | 'monthlyComparison'>): TrendPoint[] =>
  trendSeries<PartyMonthPoint>(analytics.monthly, analytics.monthlyComparison, (p) => p.purchasedValue, (p) => p.received);

export interface RankPoint {
  readonly label: string;
  readonly value: number;
  readonly id: string | null;
}

export const MAX_RANKED = 8;

/** Top N by the value given, in the order the API ranked them; ties keep arrival order. */
export function rankingSeries<T extends { name: string; id: string | null }>(rows: readonly T[], value: (row: T) => number): RankPoint[] {
  return rows
    .map((row) => ({ label: row.name, value: value(row), id: row.id }))
    .filter((p) => p.value > 0)
    .slice(0, MAX_RANKED);
}

export function heatGridFromCells(cells: readonly HeatCell[]): HeatGrid {
  return heatGridOf(cells.map((c) => ({ category: c.row, month: c.month, value: c.value, rowId: c.rowId ?? '' })));
}

/** Enough months to read a trend from (the skill: a line through four points says nothing). */
export const MIN_TREND_MONTHS = 3;

export function trendReadable(points: readonly TrendPoint[]): boolean {
  return points.filter((p) => p.a > 0 || p.b > 0).length >= MIN_TREND_MONTHS;
}

// --------------------------------------------------------------- insights

/** Below this, the order book is not leaving the building. */
export const FULFILMENT_WORRY_PCT = 90;
/** One customer above this share is a dependency, not a relationship. */
export const CONCENTRATION_PCT = 50;
/** Under a month of cover at the period's pace is a stock-out in waiting. */
export const COVER_LOW_MONTHS = 1;
/** More than this and the shelf is carrying cash. */
export const COVER_HIGH_MONTHS = 6;
/** A vendor this far above the best rate is worth a call. */
export const PRICE_VARIANCE_PCT = 10;
/** A p90 this far past the median means the tail, not the average, is the complaint. */
export const LEAD_TAIL_FACTOR = 2;
/** Above this, partial shipments are the rule for this customer. */
export const PARTIAL_WORRY_PCT = 30;
/** Collected below this share of what was billed, in the period, is worth a look (approximate without bill-wise). */
export const COLLECTION_WORRY_PCT = 50;
/** One customer above this share of the period's revenue is concentration. */
export const REVENUE_SHARE_WORRY_PCT = 25;

function qty(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function itemInsights(analytics: Pick<ItemAnalytics, 'kpis' | 'vendors' | 'customers'>): string[] {
  const { kpis } = analytics;
  const out: string[] = [];
  if (kpis.ordered.value > 0 && kpis.fulfilmentPct.value < FULFILMENT_WORRY_PCT) {
    out.push(`Only ${String(kpis.fulfilmentPct.value)}% of what was ordered in the period has left; ${qty(kpis.ordered.value - kpis.dispatched.value)} is still to dispatch.`);
  }
  if (kpis.customers.value >= 2 && kpis.topCustomerSharePct.value > CONCENTRATION_PCT) {
    const top = analytics.customers[0];
    out.push(`${top?.name ?? 'One customer'} takes ${String(kpis.topCustomerSharePct.value)}% of the period's quantity: this item depends on one buyer.`);
  }
  if (kpis.monthsOfCover !== null) {
    if (kpis.monthsOfCover < COVER_LOW_MONTHS) out.push(`Under a month of cover on the shelf at the period's pace (${String(kpis.monthsOfCover)} months).`);
    else if (kpis.monthsOfCover > COVER_HIGH_MONTHS) out.push(`${String(kpis.monthsOfCover)} months of cover on the shelf at the period's pace: stock is ahead of demand.`);
  }
  if (kpis.shortages.value > 0) {
    out.push(`${String(kpis.shortages.value)} shortage requirement${kpis.shortages.value === 1 ? '' : 's'} raised in the period: orders waited on stock.`);
  }
  const dear = analytics.vendors.filter((v) => v.variancePct !== null && v.variancePct > PRICE_VARIANCE_PCT);
  for (const vendor of dear.slice(0, 2)) {
    out.push(`${vendor.name}'s last rate is ${String(vendor.variancePct ?? 0)}% above the best rate another vendor gave.`);
  }
  const late = analytics.vendors.filter((v) => v.leadTimeDays !== null && v.promisedDays !== null && v.leadTimeDays > v.promisedDays);
  for (const vendor of late.slice(0, 2)) {
    out.push(`${vendor.name} delivers in ${String(vendor.leadTimeDays ?? 0)} days against ${String(vendor.promisedDays ?? 0)} promised.`);
  }
  return out;
}

export function partyInsights(analytics: Pick<PartyAnalytics, 'customer' | 'vendor'>): string[] {
  const out: string[] = [];
  const c = analytics.customer;
  if (c !== null) {
    if (c.dormant && c.daysSinceLastOrder !== null && c.medianOrderGapDays !== null) {
      out.push(`No order for ${String(c.daysSinceLastOrder)} days against a usual gap of ${String(c.medianOrderGapDays)}: this customer has gone quiet.`);
    }
    if (c.orders.value > 0 && c.fulfilmentPct.value < FULFILMENT_WORRY_PCT) {
      out.push(`Only ${String(c.fulfilmentPct.value)}% of what this customer ordered in the period has left.`);
    }
    if (c.partialShipmentPct.value > PARTIAL_WORRY_PCT) {
      out.push(`${String(c.partialShipmentPct.value)}% of dispatched orders went in more than one consignment or were short-closed.`);
    }
    if (c.leadTimeP90Days.value > 0 && c.leadTimeMedianDays.value > 0 && c.leadTimeP90Days.value >= LEAD_TAIL_FACTOR * c.leadTimeMedianDays.value) {
      out.push(`Typical dispatch takes ${String(c.leadTimeMedianDays.value)} days, but one in ten waits ${String(c.leadTimeP90Days.value)}: the tail is the complaint.`);
    }
    if (c.revenueSharePct.value > REVENUE_SHARE_WORRY_PCT) {
      out.push(`${String(c.revenueSharePct.value)}% of the period's revenue comes from this one customer.`);
    }
    if (c.revenue.value > 0 && (c.collected.value / c.revenue.value) * 100 < COLLECTION_WORRY_PCT) {
      out.push(`Collected ${String(Math.round((c.collected.value / c.revenue.value) * 100))}% of what was billed in the period (approximate: bill-wise data would make this exact).`);
    }
  }
  const v = analytics.vendor;
  if (v !== null) {
    if (v.promisedDays !== null && v.leadTimeMedianDays.value > v.promisedDays) {
      out.push(`Delivers in ${String(v.leadTimeMedianDays.value)} days against ${String(v.promisedDays)} promised.`);
    }
    if (v.rejectedPct.value > 0) {
      out.push(`${String(v.rejectedPct.value)}% of what arrived was rejected at the gate.`);
    }
  }
  return out;
}
