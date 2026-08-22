import { BooksIcon } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { currencySymbol, formatAmount, formatDate } from '@/lib/format';
import type { PartyRole } from '@vyuha/shared';

import { FigureStrip } from './figure-strip';
import { LifecycleTimeline } from './lifecycle-timeline';
import { usePartyLifecycle } from './use-lifecycle';

/**
 * One party's life (owner, 22 Aug 2026): as the customer it is -- estimates,
 * orders, what left and what was delivered, what was invoiced -- and as
 * the vendor it is -- what was ordered from it and what arrived -- with
 * Tally's vouchers beside both, and the dated trail of all of it. Reached
 * by tapping the row on Parties.
 */
const ROLE_LABELS: Record<PartyRole, string> = { customer: 'Customer', vendor: 'Vendor', both: 'Customer and vendor', none: 'Party' };

export function PartyPage() {
  const { id } = useParams<{ id: string }>();
  const lifecycle = usePartyLifecycle(id ?? null);

  if (lifecycle.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading the party" className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (lifecycle.isError) {
    return (
      <QueryErrorAlert
        error={lifecycle.error}
        subject="this party"
        onRetry={() => {
          void lifecycle.refetch();
        }}
      />
    );
  }

  const { party, role, figures, events } = lifecycle.data;
  const money = (value: string) => `${currencySymbol()}${formatAmount(value)}`;
  const facts = [party.alias, party.parentGroup, party.gstin ? `GSTIN ${party.gstin}` : null].filter((f): f is string => f !== null && f !== '');
  const sells = role === 'customer' || role === 'both';
  const buys = role === 'vendor' || role === 'both';

  return (
    <>
      <PageHeader
        eyebrow={ROLE_LABELS[role]}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{party.name}</span>
            {party.absentInTally ? <Badge variant="destructive">Gone from Tally</Badge> : null}
          </span>
        }
        description={facts.join(' · ')}
        action={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/masters/parties" />}>
            <BooksIcon data-icon="inline-start" />
            All parties
          </Button>
        }
      />

      {sells || role === 'none' ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="As a customer" note={figures.lastOrderAt ? `Last order ${formatDate(figures.lastOrderAt)}.` : 'No order yet.'} />
          <FigureStrip
            entries={[
              ['Estimates', String(figures.estimates)],
              ['Orders', String(figures.orders)],
              ['Open orders', String(figures.openOrders)],
              ['Dispatches', String(figures.dispatches)],
              ['Delivered', String(figures.delivered)],
              ['Invoices', String(figures.invoices)],
              ['Ordered', money(figures.orderedValue)],
              ['Invoiced', money(figures.invoicedValue)],
            ]}
          />
        </section>
      ) : null}

      {buys ? (
        <section className="flex flex-col gap-3">
          <SectionHeading title="As a vendor" note={figures.lastPurchaseAt ? `Last purchase order ${formatDate(figures.lastPurchaseAt)}.` : 'No purchase order yet.'} />
          <FigureStrip columns={3} entries={[['Purchase orders', String(figures.purchaseOrders)], ['Receipts', String(figures.receipts)], ['Purchased', money(figures.purchasedValue)]]} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeading title="Held in Tally" note={`Pulled ${formatDate(party.lastPulledAt.slice(0, 10))}.`} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Address</dt>
          <dd className="whitespace-pre-line">{party.address ?? '—'}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="break-all">{party.email ?? '—'}</dd>
          <dt className="text-muted-foreground">Phone</dt>
          <dd className="tabular-nums">{party.phone ?? '—'}</dd>
          <dt className="text-muted-foreground">Credit</dt>
          <dd className="tabular-nums">
            {party.creditLimit ? money(party.creditLimit) : '—'}
            {party.creditDays !== null ? ` · ${String(party.creditDays)} days` : ''}
          </dd>
          <dt className="text-muted-foreground">Opening balance</dt>
          <dd className="tabular-nums">{party.openingBalance ? money(party.openingBalance) : '—'}</dd>
        </dl>
      </section>

      <LifecycleTimeline events={events} />
    </>
  );
}
