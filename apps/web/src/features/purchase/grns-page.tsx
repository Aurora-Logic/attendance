import { useState } from 'react';
import { LockKeyIcon, PackageIcon, XCircleIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { PageHeader } from '@/components/shared/page-header';
import { RecordPagination } from '@/components/shared/record-pagination';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SearchField } from '@/components/shared/search-field';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { SyncStateBadge } from '@/features/sales/sales-order-sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { EMPTY_VALUE, formatRelativeAge } from '@/lib/format';
import { ShortcutLayer } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { AllocationForm } from './allocation-form';
import { formatQty, type Grn } from './types';
import { useGrn, useGrns } from './use-purchase';

/**
 * Goods receipts (REQ-X-19…X-22): each one a Receipt Note in Tally, with
 * what still waits on a person — a receipt short of the orders behind it
 * (REQ-X-27) — worn as a badge so it is not found by opening every row.
 * The list is the newest two hundred; the page window is cut here.
 */

const PAGE_SIZE = 25;

function PendingBadge({ grn }: { grn: Grn }) {
  if (grn.pendingAllocations.length === 0) return null;
  return <Badge variant="destructive">{String(grn.pendingAllocations.length)} pending allocation{grn.pendingAllocations.length === 1 ? '' : 's'}</Badge>;
}

const COLUMNS: RecordColumn<Grn>[] = [
  { key: 'number', header: 'Number', cell: (row) => <span className="font-medium tabular-nums">{row.number}</span> },
  { key: 'po', header: 'Purchase order', cell: (row) => <span className="tabular-nums">{row.purchaseOrderNumber}</span> },
  { key: 'vendor', header: 'Vendor', cell: (row) => row.vendorName },
  { key: 'received', header: 'Received', cell: (row) => formatRelativeAge(row.receivedAt), className: 'tabular-nums' },
  { key: 'sync', header: 'Tally', cell: (row) => <SyncStateBadge record={row} /> },
  { key: 'pending', header: 'Allocation', cell: (row) => <PendingBadge grn={row} /> },
  { key: 'by', header: 'Received by', cell: (row) => row.receivedByName ?? EMPTY_VALUE, secondary: true },
];

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading goods receipts" className="border">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} aria-hidden className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
          <Skeleton className="h-3 w-24 shrink-0" />
          <Skeleton className="hidden h-3 w-40 shrink-0 sm:block" />
          <Skeleton className="ml-auto h-3 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function GrnsPage() {
  const canView = usePermission(PERMISSIONS.PURCHASE_DOCUMENT_VIEW);
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const po = searchParams.get('po') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const openId = params.id ?? null;

  const query = useGrns({ ...(po ? { purchaseOrderId: po } : {}) }, { enabled: canView });
  const open = useGrn(canView ? openId : null);

  const needle = q.trim().toLowerCase();
  const all = (query.data ?? []).filter((row) => needle === '' || [row.number, row.purchaseOrderNumber, row.vendorName].some((text) => text.toLowerCase().includes(needle)));
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function closeSheet() {
    const search = window.location.search;
    void navigate(`/purchase/grns${search}`, { replace: true });
  }

  if (!canView) {
    return (
      <>
        <PageHeader description="Goods receipts: what arrived against each purchase order, and whether Tally has the Receipt Note." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockKeyIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot view goods receipts</EmptyTitle>
            <EmptyDescription>This needs purchase.document.view — the Purchase role carries it.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  const filtered = needle !== '' || po !== '';

  return (
    <>
      <PageHeader description="Each receipt pushes to Tally as a Receipt Note; the accountant books the bill against it. A receipt short of the orders waiting on it asks for an allocation here." />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField id="grn-search" label="Search goods receipts" value={q} onValueChange={setQ} placeholder="GRN, PO or vendor" />
          {po ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.delete('po');
                    next.delete('page');
                    return next;
                  },
                  { replace: true },
                );
              }}
            >
              <ACTION_ICONS.clearFilters data-icon="inline-start" />
              One purchase order — clear
            </Button>
          ) : null}
        </div>

        {query.isPending ? <ListSkeleton /> : null}
        {query.isError ? (
          <QueryErrorAlert
            error={query.error}
            subject="goods receipts"
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : null}

        {query.isSuccess && all.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageIcon />
              </EmptyMedia>
              <EmptyTitle>{filtered ? 'No receipt matches that' : 'Nothing received yet'}</EmptyTitle>
              <EmptyDescription>{filtered ? 'Clear the search or the purchase order filter.' : 'Receipts are recorded from a confirmed purchase order: open it and press Receive.'}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {rows.length > 0 ? (
          <>
            <RecordTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              mobilePrimary={(row) => `${row.number} · ${row.purchaseOrderNumber}`}
              mobileStatus={(row) => (
                <>
                  <PendingBadge grn={row} />
                  <SyncStateBadge record={row} />
                </>
              )}
              mobileSupporting={(row) => `${row.vendorName} · ${formatRelativeAge(row.receivedAt)}`}
              onRowActivate={(row) => {
                void navigate(`/purchase/grns/${row.id}${window.location.search}`);
              }}
            />
            {all.length > PAGE_SIZE ? <RecordPagination page={page} pageSize={PAGE_SIZE} total={all.length} /> : null}
          </>
        ) : null}
      </div>

      {openId !== null && open.isError ? (
        <QueryErrorAlert
          error={open.error}
          subject="that goods receipt"
          onRetry={() => {
            void open.refetch();
          }}
        />
      ) : null}

      <GrnSheet
        grn={openId !== null ? (open.data ?? null) : null}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeSheet();
        }}
      />
    </>
  );
}

// ------------------------------------------------------------------ sheet

function GrnSheet({ grn, onOpenChange }: { grn: Grn | null; onOpenChange: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={grn !== null} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="gap-0 sm:max-w-2xl max-md:max-h-[92vh]">
        {grn ? (
          <GrnSheetBody
            key={grn.id}
            grn={grn}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function GrnSheetBody({ grn, onClose }: { grn: Grn; onClose: () => void }) {
  return (
    <ShortcutLayer id={`modal:grn-${grn.id}`}>
      <SheetHeader className="shrink-0 border-b">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          Goods receipt {grn.number}
          <SyncStateBadge record={grn} />
          <PendingBadge grn={grn} />
        </SheetTitle>
        <SheetDescription>
          Against{' '}
          <Link to={`/purchase/orders/${grn.purchaseOrderId}`} className="underline-offset-4 hover:underline">
            {grn.purchaseOrderNumber}
          </Link>{' '}
          from {grn.vendorName}, {formatRelativeAge(grn.receivedAt)}
          {grn.receivedByName ? ` by ${grn.receivedByName}` : ''}.
          {grn.syncState === 'PUSHED' ? ` In Tally as Receipt Note #${grn.remoteVoucherNumber ?? '?'}.` : grn.syncState === 'QUEUED' ? ' Queued for Tally as a Receipt Note.' : ''}
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {grn.lastError ? (
          <Alert variant="destructive">
            <XCircleIcon />
            <AlertTitle>{grn.syncState === 'FAILED' ? 'Tally rejected it' : 'Tally has since changed it'}</AlertTitle>
            <AlertDescription>
              <p className="font-mono text-xs">{grn.lastError}</p>
              <p className="mt-1">{grn.syncState === 'FAILED' ? 'Tally\u2019s own words (REQ-T-01).' : 'Seen on the pull (D-38). The stock is on the shelf either way.'}</p>
            </AlertDescription>
          </Alert>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Vendor invoice</dt>
            <dd className="font-medium">{grn.vendorInvoiceRef ?? EMPTY_VALUE}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Received by</dt>
            <dd className="font-medium">{grn.receivedByName ?? EMPTY_VALUE}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Notes</dt>
            <dd className="font-medium">{grn.notes ?? EMPTY_VALUE}</dd>
          </div>
        </dl>

        <Separator />

        <section className="flex flex-col gap-2">
          <SectionHeading title="Lines" note="Received goes into stock through the Receipt Note; rejected does not, and keeps the PO line open (REQ-X-21)." />
          <ol className="flex flex-col divide-y border">
            {grn.lines.map((line) => (
              <li key={line.purchaseOrderLineId} className="flex flex-col gap-1 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm font-medium">{line.description}</span>
                  <span className="text-xs tabular-nums">
                    <span className="font-medium">{formatQty(line.receivedQty)}</span> received
                    {Number(line.rejectedQty) > 0 ? (
                      <>
                        {' · '}
                        <span className="text-destructive font-medium">{formatQty(line.rejectedQty)}</span> rejected
                      </>
                    ) : null}
                  </span>
                </div>
                {line.rejectionReason ? <p className="text-muted-foreground text-xs">Rejected: {line.rejectionReason}</p> : null}
              </li>
            ))}
          </ol>
        </section>

        {grn.pendingAllocations.length > 0 ? (
          <>
            <Separator />
            <section className="flex flex-col gap-2">
              <SectionHeading title="Pending allocation" note="Less arrived than the orders behind these lines need. Who gets it is decided here, not by arrival order (REQ-X-27, D-30)." />
              <AllocationForm grn={grn} />
            </section>
          </>
        ) : null}
      </div>

      <SheetFooter className="shrink-0 flex-row flex-wrap justify-end gap-2 border-t">
        <Button variant="outline" onClick={onClose}>
          <ACTION_ICONS.close data-icon="inline-start" />
          Close
        </Button>
      </SheetFooter>
    </ShortcutLayer>
  );
}
