import type { ReactNode } from 'react';
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from '@phosphor-icons/react';

import { deltaOf } from '@/lib/period-compare';
import { cn } from '@/lib/utils';

/**
 * A strip of figures for a record or a dashboard: label over value, the
 * change against the comparison period beneath it when one is shown
 * (absolute and percent, or "new" when the base was zero — never an
 * infinite percent), one border around the set. Two across on a phone,
 * four on a desk. A tile with no comparison shows no delta.
 */

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  /** The raw numbers, when a comparison is shown; the delta is derived here so every tile reads it the same way. */
  current?: number;
  previous?: number | null;
  /** The figure's own formatter, for the absolute change. */
  format?: (value: number) => string;
  /** True when a fall is good news (lead time, rejections, shortages). */
  lowerIsBetter?: boolean;
  /** A word under the value: "approx.", "now", the period. */
  note?: string;
}

export function KpiGrid({ tiles, columns = 4, className }: { tiles: readonly KpiTileProps[]; columns?: 3 | 4; className?: string }) {
  return (
    <dl className={cn('divide-border grid grid-cols-2 divide-x divide-y border', columns === 3 ? 'sm:grid-cols-3 sm:[&>*:nth-child(n+4)]:border-t' : 'sm:grid-cols-4 sm:[&>*:nth-child(n+5)]:border-t', 'sm:divide-y-0', className)}>
      {tiles.map((tile) => (
        <KpiTile key={tile.label} {...tile} />
      ))}
    </dl>
  );
}

export function KpiTile({ label, value, current, previous, format, lowerIsBetter = false, note }: KpiTileProps) {
  const delta = current !== undefined && previous !== undefined && previous !== null ? deltaOf(current, previous) : null;
  const good = delta === null ? null : delta.direction === 'flat' ? null : (delta.direction === 'up') !== lowerIsBetter;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
      <dt className="text-muted-foreground truncate text-[0.6875rem]">{label}</dt>
      <dd className="truncate text-base font-medium tabular-nums">{value}</dd>
      {delta !== null ? (
        <dd
          className={cn('flex items-center gap-1 text-[0.6875rem] tabular-nums', good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive')}
          aria-label={`Change against the comparison period: ${deltaText(delta.absolute, delta.pct, delta.label, format)}`}
        >
          {delta.direction === 'up' ? <ArrowUpRightIcon /> : delta.direction === 'down' ? <ArrowDownRightIcon /> : <MinusIcon />}
          {deltaText(delta.absolute, delta.pct, delta.label, format)}
        </dd>
      ) : note ? (
        <dd className="text-muted-foreground text-[0.6875rem]">{note}</dd>
      ) : null}
    </div>
  );
}

function deltaText(absolute: number, pct: number | null, label: 'new' | 'none' | null, format?: (value: number) => string): string {
  if (label === 'new') return 'new';
  if (label === 'none') return 'no change';
  const abs = (format ?? ((v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 })))(Math.abs(absolute));
  const sign = absolute > 0 ? '+' : absolute < 0 ? '−' : '';
  return pct === null ? `${sign}${abs}` : `${sign}${abs} (${sign}${String(Math.abs(pct))}%)`;
}
