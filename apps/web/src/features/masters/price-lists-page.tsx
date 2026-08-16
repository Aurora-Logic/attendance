import { useEffect, useState } from 'react';
import { ArrowsClockwiseIcon, LockKeyIcon, TagIcon } from '@phosphor-icons/react';
import { useSearchParams } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { RecordPagination } from '@/components/shared/record-pagination';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SearchField } from '@/components/shared/search-field';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { EMPTY_VALUE, formatRelativeAge } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { usePriceLists, type PriceListEntry } from './use-price-lists';

/**
 * REQ-R-03: rates per stock item per price level — the per-party-group list.
 * The rate renders exactly as Tally holds it; nothing here sums or converts.
 */

const COLUMNS: RecordColumn<PriceListEntry>[] = [
  { key: 'item', header: 'Item', cell: (row) => <span className="font-medium">{row.stockItemName}</span> },
  { key: 'level', header: 'Price level', cell: (row) => row.priceLevel },
  { key: 'rate', header: 'Rate', cell: (row) => row.rate, numeric: true },
  { key: 'unit', header: 'Per', cell: (row) => row.unit ?? EMPTY_VALUE, secondary: true },
  {
    key: 'pulled',
    header: 'As of',
    cell: (row) => formatRelativeAge(row.lastPulledAt),
    className: 'tabular-nums',
    secondary: true,
  },
];

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading price lists" className="border">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-44 shrink-0" />
          <Skeleton className="hidden h-3 w-24 shrink-0 sm:block" />
          <Skeleton className="ml-auto h-3 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function PriceListsPage() {
  const canView = usePermission(PERMISSIONS.MASTERS_TALLY_VIEW);
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [draft, setDraft] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (syncedQ !== q) {
    setSyncedQ(q);
    if (draft.trim() !== q) setDraft(q);
  }
  useEffect(() => {
    if (draft.trim() === q) return undefined;
    const timer = window.setTimeout(() => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const value = draft.trim();
          if (value) next.set('q', value);
          else next.delete('q');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [draft, q, setSearchParams]);

  const query = usePriceLists({ page, ...(q ? { q } : {}) }, { enabled: canView });
  const rows = query.data?.data ?? [];
  const meta = query.data?.meta ?? null;

  if (!canView) {
    return (
      <>
        <PageHeader description="Price lists, pulled from TallyPrime." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockKeyIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot view the Tally masters</EmptyTitle>
            <EmptyDescription>
              This needs the masters.tally.view permission — rates are commercial terms, so the
              list is not shown more widely.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        description="Rates per item per price level, pulled from TallyPrime. Read-only: prices change in Tally and arrive here on the next sync."
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            <ArrowsClockwiseIcon data-icon="inline-start" />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            id="price-list-search"
            label="Search price lists"
            value={draft}
            onValueChange={setDraft}
            placeholder="Item name"
          />
        </div>

        {query.isPending ? <ListSkeleton /> : null}

        {query.isError ? (
          <QueryErrorAlert
            error={query.error}
            subject="price lists"
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : null}

        {query.isSuccess && rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TagIcon />
              </EmptyMedia>
              <EmptyTitle>{q ? 'No rate matches that' : 'No price lists yet'}</EmptyTitle>
              <EmptyDescription>
                {q
                  ? 'Try a different item name.'
                  : 'Rates arrive with the pull, where the company maintains price levels in Tally. Companies without price lists simply have nothing here.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {rows.length > 0 ? (
          <>
            <RecordTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              mobilePrimary={(row) => row.stockItemName}
              mobileSupporting={(row) =>
                `${row.priceLevel} · ${row.rate}${row.unit === null ? '' : ` / ${row.unit}`}`
              }
            />
            {meta !== null && meta.total > meta.pageSize ? (
              <RecordPagination page={meta.page} pageSize={meta.pageSize} total={meta.total} />
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
