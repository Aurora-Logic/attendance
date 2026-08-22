import { cn } from '@/lib/utils';

/** The dashboard's strip of figures, for a record page: label over value, a border around the set. */
export function FigureStrip({ entries, columns = 4 }: { entries: readonly (readonly [string, string])[]; columns?: 3 | 4 }) {
  return (
    <dl className={cn('divide-border grid grid-cols-2 divide-x divide-y border', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4', 'sm:divide-y-0 sm:[&>*:nth-child(n+5)]:border-t')}>
      {entries.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 px-3 py-2">
          <dt className="text-muted-foreground text-[0.6875rem]">{label}</dt>
          <dd className="text-base font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
