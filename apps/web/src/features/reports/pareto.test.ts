import { describe, expect, it } from 'vitest';

import { countToReach, paretoInsight, paretoSeries } from './report-series';

/**
 * Owner, 22 Aug 2026: "X out of Y customers make up half the revenue."
 *
 * The sentence is the whole point of a Pareto, so it is computed here from
 * named thresholds and tested, rather than composed in JSX from whatever the
 * chart happens to have (vyuha-charts §3).
 */
const row = (name: string, share: number, cumulative: number) => ({
  id: name,
  cells: { name, sharePct: String(share), cumulativePct: String(cumulative) },
});

describe('the Pareto curve', () => {
  it('reads the running total the report already computed, in the order it ranked', () => {
    const points = paretoSeries([row('Asha', 40, 40), row('Behar', 30, 70), row('Chetan', 30, 100)], 'name');
    expect(points.map((p) => p.category)).toEqual(['Asha', 'Behar', 'Chetan']);
    expect(points.map((p) => p.cumulativePct)).toEqual([40, 70, 100]);
  });

  it('counts the row that crosses the line, not the one after it', () => {
    const points = paretoSeries([row('a', 40, 40), row('b', 30, 70), row('c', 20, 90), row('d', 10, 100)], 'name');
    // 40 is not yet half; 70 is. Two customers make up half.
    expect(countToReach(points, 50)).toBe(2);
    expect(countToReach(points, 80)).toBe(3);
    expect(countToReach(points, 100)).toBe(4);
  });

  it('says so when the page never reaches the target', () => {
    const points = paretoSeries([row('a', 10, 10), row('b', 10, 20), row('c', 10, 30), row('d', 10, 40)], 'name');
    expect(countToReach(points, 50)).toBeNull();
    expect(paretoInsight(points, 'customers', 'revenue')).toBeNull();
  });

  it('writes the sentence the owner asked for', () => {
    const points = paretoSeries(
      [row('a', 30, 30), row('b', 25, 55), row('c', 15, 70), row('d', 12, 82), row('e', 10, 92), row('f', 8, 100)],
      'name',
    );
    expect(paretoInsight(points, 'customers', 'revenue')).toBe('2 of 6 customers make up half the revenue; 4 make up 80%.');
  });

  it('does not claim a concentration from a handful of rows', () => {
    const points = paretoSeries([row('a', 60, 60), row('b', 40, 100)], 'name');
    // Arithmetically "1 of 2 make up half"; practically it says nothing.
    expect(paretoInsight(points, 'items', 'revenue')).toBeNull();
  });

  it('drops the second clause when half and most are the same row', () => {
    const points = paretoSeries([row('a', 85, 85), row('b', 5, 90), row('c', 5, 95), row('d', 5, 100)], 'name');
    expect(paretoInsight(points, 'vendors', 'spend')).toBe('1 of 4 vendors make up half the spend.');
  });
});
