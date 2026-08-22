import { describe, expect, it } from 'vitest';

import type { ItemAnalytics, PartyAnalytics } from '@vyuha/shared';

import { heatGridFromCells, itemInsights, itemTrend, monthLabel, partyInsights, rankingSeries, trendReadable, trendSeries } from './lifecycle-series';

const month = (m: string, ordered: number, dispatched: number) => ({ month: m, ordered, dispatched, revenue: 0, purchased: 0, received: 0 });
const k = (value: number, previous: number | null = null) => ({ value, previous });

function itemKpis(over: Partial<ItemAnalytics['kpis']> = {}): ItemAnalytics['kpis'] {
  return {
    ordered: k(100), dispatched: k(100), fulfilmentPct: k(100), orders: k(4), customers: k(3), repeatBuyers: k(1), topCustomerSharePct: k(40),
    revenue: k(0), billedQty: k(0), realisedRate: k(0), purchased: k(0), received: k(0), purchaseRate: k(0), shortages: k(0),
    openOrders: 0, closingQty: 50, monthsOfCover: 3, lastSoldAt: null, lastSoldRate: null, lastPurchasedAt: null, lastPurchaseRate: null, marginProxyPct: null,
    ...over,
  };
}

describe('trendSeries', () => {
  it('lays the comparison beside the period by position, and is empty for an empty period', () => {
    const points = trendSeries([month('2026-04', 10, 8), month('2026-05', 12, 12)], [month('2025-04', 5, 5)], (p) => p.ordered, (p) => p.dispatched);
    expect(points).toEqual([
      { month: '2026-04', label: 'Apr 26', a: 10, b: 8, aPrev: 5, bPrev: 5 },
      { month: '2026-05', label: 'May 26', a: 12, b: 12, aPrev: null, bPrev: null },
    ]);
    expect(trendSeries([], null, () => 0, () => 0)).toEqual([]);
    expect(monthLabel('2026-12')).toBe('Dec 26');
  });

  it('needs three live months before a trend is read', () => {
    expect(trendReadable(itemTrend({ monthly: [month('2026-04', 1, 0)], monthlyComparison: null }))).toBe(false);
    expect(trendReadable(itemTrend({ monthly: [month('2026-04', 1, 0), month('2026-05', 0, 0), month('2026-06', 2, 1), month('2026-07', 3, 3)], monthlyComparison: null }))).toBe(true);
  });
});

describe('rankingSeries and the heat grid', () => {
  it('keeps the API order, drops zeros, caps at eight', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `C${String(i)}`, quantity: 10 - i }));
    const ranked = rankingSeries(rows, (r) => r.quantity);
    expect(ranked).toHaveLength(8);
    expect(ranked[0]).toEqual({ label: 'C0', value: 10, id: '0' });
    expect(rankingSeries([{ id: null, name: 'Zero', quantity: 0 }], (r) => r.quantity)).toEqual([]);
  });

  it('builds a category × month grid from cells', () => {
    const grid = heatGridFromCells([
      { row: 'Asha', rowId: 'a', month: '2026-05', value: 4 },
      { row: 'Asha', rowId: 'a', month: '2026-04', value: 2 },
      { row: 'Behar', rowId: null, month: '2026-05', value: 1 },
    ]);
    expect(grid.months).toEqual(['2026-04', '2026-05']);
    expect(grid.rows.map((r) => r.cells)).toEqual([[2, 4], [null, 1]]);
    expect(grid.max).toBe(4);
  });
});

describe('itemInsights', () => {
  it('says nothing when everything is fine', () => {
    expect(itemInsights({ kpis: itemKpis(), vendors: [], customers: [] })).toEqual([]);
  });

  it('names fulfilment, concentration, cover, shortages, dear vendors and late vendors by their thresholds', () => {
    const out = itemInsights({
      kpis: itemKpis({ dispatched: k(60), fulfilmentPct: k(60), topCustomerSharePct: k(70), monthsOfCover: 0.4, shortages: k(2) }),
      customers: [{ id: 'a', name: 'Asha Traders', quantity: 70, value: 0, orders: 2, lastAt: '2026-08-01', lastRate: null }],
      vendors: [
        { id: 'v1', name: 'Behar Supply', quantity: 10, value: 0, purchaseOrders: 1, lastAt: '2026-08-01', lastRate: 115, variancePct: 15, leadTimeDays: 9, promisedDays: 5, rejectedPct: null },
        { id: 'v2', name: 'Fair Co', quantity: 10, value: 0, purchaseOrders: 1, lastAt: '2026-08-01', lastRate: 100, variancePct: 0, leadTimeDays: 4, promisedDays: 5, rejectedPct: null },
      ],
    });
    expect(out).toEqual([
      'Only 60% of what was ordered in the period has left; 40 is still to dispatch.',
      "Asha Traders takes 70% of the period's quantity: this item depends on one buyer.",
      "Under a month of cover on the shelf at the period's pace (0.4 months).",
      '2 shortage requirements raised in the period: orders waited on stock.',
      "Behar Supply's last rate is 15% above the best rate another vendor gave.",
      'Behar Supply delivers in 9 days against 5 promised.',
    ]);
  });
});

describe('partyInsights', () => {
  const customer = (over: Partial<NonNullable<PartyAnalytics['customer']>> = {}): NonNullable<PartyAnalytics['customer']> => ({
    revenue: k(100000), invoices: k(4), averageInvoice: k(25000), collected: k(90000), orders: k(4), orderedValue: k(100000), orderedQty: k(40), dispatchedQty: k(40),
    fulfilmentPct: k(100), partialShipmentPct: k(0), leadTimeMedianDays: k(2), leadTimeP90Days: k(3), revenueSharePct: k(10),
    openOrders: 0, lastOrderAt: '2026-08-01', daysSinceLastOrder: 10, medianOrderGapDays: 30, dormant: false,
    ...over,
  });

  it('is quiet for a healthy customer and speaks to the D-46 dormancy rule, the tail and the collection', () => {
    expect(partyInsights({ customer: customer(), vendor: null })).toEqual([]);
    const out = partyInsights({
      customer: customer({ dormant: true, daysSinceLastOrder: 75, medianOrderGapDays: 30, leadTimeMedianDays: k(2), leadTimeP90Days: k(6), collected: k(30000) }),
      vendor: { purchaseOrders: k(1), purchasedValue: k(1), orderedQty: k(1), receivedQty: k(1), receipts: k(1), rejectedPct: k(5), leadTimeMedianDays: k(8), leadTimeP90Days: k(8), promisedDays: 5, openPurchaseOrders: 0, lastPurchaseAt: null },
    });
    expect(out).toEqual([
      'No order for 75 days against a usual gap of 30: this customer has gone quiet.',
      'Typical dispatch takes 2 days, but one in ten waits 6: the tail is the complaint.',
      'Collected 30% of what was billed in the period (approximate: bill-wise data would make this exact).',
      'Delivers in 8 days against 5 promised.',
      '5% of what arrived was rejected at the gate.',
    ]);
  });
});
