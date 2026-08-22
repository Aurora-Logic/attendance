import { Fragment } from 'react';
import { CubeIcon } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { currencySymbol, formatAmount, formatDate } from '@/lib/format';
import type { ItemCounterparty } from '@vyuha/shared';

import { FigureStrip } from './figure-strip';
import { LifecycleTimeline } from './lifecycle-timeline';
import { useItemLifecycle } from './use-lifecycle';

/**
 * One stock item's life (owner, 22 Aug 2026): what Tally holds of it, how
 * much was ordered, picked, packed and dispatched, how much bought and
 * received, who buys it and who supplies it, and the dated trail of every
 * document that carried it. Reached by tapping the row on Stock items.
 */
function qty(value: string): string {
  return value.replace(/\.?0+$/u, '') || '0';
}

export function StockItemPage() {
  const { id } = useParams<{ id: string }>();
  const lifecycle = useItemLifecycle(id ?? null);

  if (lifecycle.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading the item" className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-14 w-full" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (lifecycle.isError) {
    return (
      <QueryErrorAlert
        error={lifecycle.error}
        subject="this item"
        onRetry={() => {
          void lifecycle.refetch();
        }}
      />
    );
  }

  const { item, figures, customers, vendors, events } = lifecycle.data;
  const facts = [item.alias, item.parentGroup, `Unit ${item.unit}`, item.gstRate ? `GST ${qty(item.gstRate)}%` : null].filter((f): f is string => f !== null && f !== '');

  return (
    <>
      <PageHeader
        eyebrow="Stock item"
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{item.name}</span>
            {item.absentInTally ? <Badge variant="destructive">Gone from Tally</Badge> : null}
          </span>
        }
        description={facts.join(' · ')}
        action={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/masters/items" />}>
            <CubeIcon data-icon="inline-start" />
            All items
          </Button>
        }
      />

      <FigureStrip
        entries={[
          ['On the shelf', item.closingQty === null ? '—' : `${qty(item.closingQty)} ${item.unit}`],
          ['Ordered', `${qty(figures.ordered)} ${item.unit}`],
          ['Picked', `${qty(figures.picked)} ${item.unit}`],
          ['Packed', `${qty(figures.packed)} ${item.unit}`],
          ['Dispatched', `${qty(figures.dispatched)} ${item.unit}`],
          ['Open orders', String(figures.openOrders)],
          ['Purchased', `${qty(figures.purchased)} ${item.unit}`],
          ['Received', `${qty(figures.received)} ${item.unit}`],
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <Counterparties title="Who buys it" note={figures.lastSoldAt ? `Last sold ${formatDate(figures.lastSoldAt)}.` : 'Not sold yet.'} rows={customers} empty="No confirmed order carries this item." />
        <Counterparties title="Who supplies it" note={figures.lastReceivedAt ? `Last received ${formatDate(figures.lastReceivedAt.slice(0, 10))}.` : 'Not bought yet.'} rows={vendors} empty="No purchase order carries this item." />
      </div>

      <LifecycleTimeline events={events} title="Every document that carried it" />
    </>
  );
}

function Counterparties({ title, note, rows, empty }: { title: string; note: string; rows: readonly ItemCounterparty[]; empty: string }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading title={title} note={note} />
      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CubeIcon />
            </EmptyMedia>
            <EmptyTitle>{empty}</EmptyTitle>
            <EmptyDescription>The figures above will fill in as documents are raised.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup role="list" className="gap-0 border">
          {rows.map((row, index) => (
            <Fragment key={`${row.id ?? row.name}`}>
              {index > 0 ? <ItemSeparator className="my-0" /> : null}
              <Item size="sm" role="listitem" className="min-h-11 rounded-none" render={row.id === null ? undefined : <Link to={`/masters/parties/${row.id}`} />}>
                <ItemContent className="min-w-0 gap-0.5">
                  <ItemTitle className="truncate">{row.name}</ItemTitle>
                  <ItemDescription className="tabular-nums">
                    {qty(row.quantity)} in all · last {formatDate(row.lastAt)}
                    {row.lastRate ? ` at ${currencySymbol()}${formatAmount(row.lastRate)}` : ''}
                  </ItemDescription>
                </ItemContent>
              </Item>
            </Fragment>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}
