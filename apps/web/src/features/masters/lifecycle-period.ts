import type { LifecycleAnalyticsQuery } from '@vyuha/shared';

import { comparisonRange, periodForGranularity, type CompareMode, type DateRangeStrings } from '@/lib/period-compare';

/**
 * The period and comparison a lifecycle page shows, kept in the URL so a
 * link carries them (data-analyst skill §3). Defaults to the financial
 * year to date; the comparison range is computed here, with the same
 * FY-aware arithmetic the reports use, and sent to the API as dates so
 * the two cannot disagree.
 */

export const COMPARE_LABELS: Record<CompareMode, string> = { off: 'No comparison', previous: 'Previous period', lastYear: 'Same period last year' };

export interface LifecyclePeriod {
  readonly range: DateRangeStrings;
  readonly compare: CompareMode;
  readonly comparison: DateRangeStrings | null;
  readonly query: LifecycleAnalyticsQuery;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function isCompare(value: string | null): value is CompareMode {
  return value === 'off' || value === 'previous' || value === 'lastYear';
}

export function readLifecyclePeriod(params: URLSearchParams, today: string): LifecyclePeriod {
  const fallback = periodForGranularity('year', today);
  const from = params.get('from');
  const to = params.get('to');
  const range: DateRangeStrings = from !== null && to !== null && DATE.test(from) && DATE.test(to) && from <= to ? { from, to } : fallback;
  const compareParam = params.get('compare');
  const compare: CompareMode = isCompare(compareParam) ? compareParam : 'off';
  const comparison = compare === 'off' ? null : comparisonRange(range, compare);
  return {
    range,
    compare,
    comparison,
    query: comparison === null ? { from: range.from, to: range.to } : { from: range.from, to: range.to, compareFrom: comparison.from, compareTo: comparison.to },
  };
}

export function writeLifecyclePeriod(params: URLSearchParams, next: { range?: DateRangeStrings; compare?: CompareMode }): URLSearchParams {
  const out = new URLSearchParams(params);
  if (next.range !== undefined) {
    out.set('from', next.range.from);
    out.set('to', next.range.to);
  }
  if (next.compare !== undefined) {
    if (next.compare === 'off') out.delete('compare');
    else out.set('compare', next.compare);
  }
  return out;
}
