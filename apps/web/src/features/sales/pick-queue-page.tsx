import { BarcodeIcon, LockKeyIcon, ScanIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { FulfilmentBadge } from './fulfilment-badge';
import { PackDialog } from './pack-dialog';
import { trimZeros, type PickQueueEntry } from './types';
import { useSalesOrder } from './use-estimates';
import { usePickQueue } from './use-fulfilment';

/**
 * REQ-AA-06…AA-10: the pick queue, oldest order first, worked on a phone.
 * A row is an order with something left to pack; tapping it opens the pick
 * list as a bottom sheet with the Pack button under the thumb. The route
 * carries the order (`/sales/pick-queue/:id`), so a picker can be sent a
 * link, and a short pack returns the balance here (REQ-AA-07, D-26).
 */

const COLUMNS: RecordColumn<PickQueueEntry>[] = [
  { key: 'number', header: 'Order', cell: (row) => <span className="font-medium tabular-nums">{row.number}</span> },
  { key: 'customer', header: 'Customer', cell: (row) => row.customerName },
  { key: 'date', header: 'Ordered', cell: (row) => formatDate(row.date), className: 'tabular-nums' },
  { key: 'balance', header: 'To pack', cell: (row) => `${trimZeros(row.balanceQty)} across ${String(row.balanceLines)} line${row.balanceLines === 1 ? '' : 's'}`, numeric: true },
  { key: 'fulfilment', header: 'State', cell: (row) => <FulfilmentBadge state={row.fulfilment} /> },
  {
    key: 'waiting',
    header: 'Waiting on',
    // REQ-X-26: an open shortage requirement is why a line is not packable yet.
    cell: (row) => (row.waitingOnRequirements > 0 ? `${String(row.waitingOnRequirements)} requirement${row.waitingOnRequirements === 1 ? '' : 's'}` : EMPTY_VALUE),
    secondary: true,
  },
];

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the pick queue" className="border">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} aria-hidden className="flex min-h-11 items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
          <Skeleton className="h-3 w-24 shrink-0" />
          <Skeleton className="hidden h-3 w-40 shrink-0 sm:block" />
          <Skeleton className="ml-auto h-3 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function PickQueuePage() {
  const canViewSelf = usePermission(PERMISSIONS.SALES_DOCUMENT_VIEW_SELF);
  const canViewAll = usePermission(PERMISSIONS.SALES_DOCUMENT_VIEW_ALL);
  const canView = canViewSelf || canViewAll;
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const openId = params.id ?? null;

  const queue = usePickQueue({ enabled: canView });
  const open = useSalesOrder(canView ? openId : null);
  const rows = queue.data ?? [];

  function closeDialog() {
    void navigate('/sales/pick-queue', { replace: true });
  }

  if (!canView) {
    return (
      <>
        <PageHeader description="The pick queue: confirmed orders with something left to pack, oldest first." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockKeyIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot view the pick queue</EmptyTitle>
            <EmptyDescription>This needs sales.document.view.self or sales.document.view.all — the Sales role carries it.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        description="Confirmed orders with something left to pack, oldest first. Tap one to pack it; a short pack keeps the balance here."
        action={
          // D-47: the scan is one tap from the screens a person holds a box on.
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/sales/scan" />}>
            <ScanIcon data-icon="inline-start" />
            Scan a slip
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        {queue.isPending ? <ListSkeleton /> : null}
        {queue.isError ? (
          <QueryErrorAlert
            error={queue.error}
            subject="the pick queue"
            onRetry={() => {
              void queue.refetch();
            }}
          />
        ) : null}

        {queue.isSuccess && rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarcodeIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing to pick</EmptyTitle>
              <EmptyDescription>Every confirmed order is packed. New orders appear here as sales confirms them.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {rows.length > 0 ? (
          <RecordTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.documentId}
            mobilePrimary={(row) => `${row.number} · ${row.customerName}`}
            mobileStatus={(row) => <FulfilmentBadge state={row.fulfilment} />}
            mobileSupporting={(row) =>
              `${trimZeros(row.balanceQty)} to pack across ${String(row.balanceLines)} line${row.balanceLines === 1 ? '' : 's'}${
                row.waitingOnRequirements > 0 ? ` · waiting on ${String(row.waitingOnRequirements)} requirement${row.waitingOnRequirements === 1 ? '' : 's'}` : ''
              }`
            }
            onRowActivate={(row) => {
              void navigate(`/sales/pick-queue/${row.documentId}`);
            }}
          />
        ) : null}
      </div>

      <PackDialog
        open={openId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeDialog();
        }}
        order={open.data ?? null}
        loading={openId !== null && open.isPending}
        loadError={open.error}
        onRetry={() => {
          void open.refetch();
        }}
      />
    </>
  );
}
