import { describe, expect, it } from 'vitest';

import { ageingSeries, genericSeries, lapseSeries, movementSeries, salesAnalysisSeries, shareSeries, velocitySeries, type ChartRow } from './report-series';

/** The builders behind the report charts: thresholds named and proven (vyuha-charts §3, §5). */

function row(cells: Record<string, string | number | null>): ChartRow {
  return { cells };
}

describe('salesAnalysisSeries', () => {
  it('is quiet on empty and on a single bar', () => {
    expect(salesAnalysisSeries([]).points).toEqual([]);
    expect(salesAnalysisSeries([row({ label: 'Asha', value: '100' })]).insight).toBeNull();
  });

  it('names the leader only when it carries at least a fifth', () => {
    const spread = salesAnalysisSeries([row({ label: 'A', value: '19' }), row({ label: 'B', value: '81' })]);
    expect(spread.insight).toContain('B carries 81%');
    const even = salesAnalysisSeries(Array.from({ length: 6 }, (_, i) => row({ label: `C${String(i)}`, value: '10' })));
    expect(even.insight).toBeNull();
  });
});

describe('movementSeries', () => {
  it('says a single month cannot show a direction', () => {
    const one = movementSeries([row({ month: '2026-08', inwardQty: '5', outwardQty: '2' })]);
    expect(one.insight).toContain('Not enough months');
  });

  it('reads the last month as building or draining', () => {
    const built = movementSeries([
      row({ month: '2026-07', inwardQty: '1', outwardQty: '1' }),
      row({ month: '2026-08', inwardQty: '10', outwardQty: '4' }),
    ]);
    expect(built.insight).toContain('built up by 6');
    const drained = movementSeries([
      row({ month: '2026-07', inwardQty: '1', outwardQty: '1' }),
      row({ month: '2026-08', inwardQty: '2', outwardQty: '9' }),
    ]);
    expect(drained.insight).toContain('drained by 7');
  });
});

describe('velocitySeries', () => {
  it('counts quickening and slowing against each item’s own year', () => {
    const series = velocitySeries([
      row({ item: 'Fast', monthly12: '10', monthly3: '20' }),
      row({ item: 'Slow', monthly12: '10', monthly3: '5' }),
      row({ item: 'Steady', monthly12: '10', monthly3: '10' }),
    ]);
    expect(series.insight).toBe('Of the top 3: 1 quickening, 1 slowing against their own year.');
  });

  it('says nothing when every item holds its pace', () => {
    expect(velocitySeries([row({ item: 'A', monthly12: '10', monthly3: '10' })]).insight).toBeNull();
  });
});

describe('ageingSeries', () => {
  it('flags the oldest bucket only from a quarter of the quantity', () => {
    const old = ageingSeries([row({ item: 'A', bucket0: '1', bucket31: '0', bucket61: '0', bucket90: '3', valueLocked: '100' })]);
    expect(old.insight).toContain('75% of the stock shown');
    const young = ageingSeries([row({ item: 'A', bucket0: '9', bucket31: '0', bucket61: '0', bucket90: '1', valueLocked: '100' })]);
    expect(young.insight).toBeNull();
  });
});

describe('lapseSeries', () => {
  it('sums the revenue going quiet and counts the fully lapsed', () => {
    const series = lapseSeries([
      row({ partyName: 'Asha', revenue12m: '60000', state: 'LAPSED' }),
      row({ partyName: 'Behar', revenue12m: '40000', state: 'AT_RISK' }),
      row({ partyName: 'Fine', revenue12m: '99999', state: 'ON_RHYTHM' }),
    ]);
    expect(series.points).toHaveLength(2);
    expect(series.insight).toContain('₹1,00,000');
    expect(series.insight).toContain('1 of these 2');
  });
});

describe('genericSeries', () => {
  const definition = {
    defaultSort: '-amount',
    columns: [
      { key: 'name', header: 'Name', type: 'text' as const },
      { key: 'amount', header: 'Amount', type: 'text' as const },
      { key: 'count', header: 'Count', type: 'number' as const },
      { key: 'asOf', header: 'As of', type: 'instant' as const },
    ],
  };

  it('names the bars from the first text column and sizes them by the sort column first', () => {
    const series = genericSeries(definition, [row({ name: 'A', amount: '100.00', count: 2, asOf: 'x' }), row({ name: 'B', amount: '50.00', count: 1, asOf: 'x' })]);
    expect(series?.categoryLabel).toBe('Name');
    expect(series?.series[0]?.key).toBe('amount');
    expect(series?.points[0]).toMatchObject({ category: 'A', amount: 100 });
  });

  it('refuses a chart where nothing is numeric, and where everything is zero', () => {
    expect(genericSeries({ defaultSort: 'name', columns: [{ key: 'name', header: 'Name', type: 'text' as const }] }, [row({ name: 'A' })])).toBeNull();
    expect(genericSeries(definition, [row({ name: 'A', amount: '0', count: 0 })])).toBeNull();
  });
});

describe('shareSeries', () => {
  it('shares are of everything shown, not of the top five', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ item: `I${String(i)}`, value: '10' }));
    const { points, total } = shareSeries(rows, 'item', 'value');
    expect(total).toBe(100);
    expect(points).toHaveLength(5);
    expect(points[0]?.share).toBe(10);
  });
});
