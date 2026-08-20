import { WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';

import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { PaperPage, PaperPageSkeleton } from '@/features/documents/paper-page';
import { grnAsPaper } from '@/features/documents/paper-record';
import { SyncStateBadge } from '@/features/sales/sales-order-sheet';
import { formatRelativeAge } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { AllocationForm } from './allocation-form';
import { useGrn, usePurchaseOrder } from './use-purchase';

/**
 * One goods receipt as the note it prints (REQ-X-20, X-21): what arrived
 * against the purchase order, what was rejected and why, who received it
 * — on the same paper as the order, quantities only. A receipt short of
 * the orders waiting behind it carries the allocation form beneath the
 * paper (REQ-X-27, D-30), the Receipt Note's sync badge the agent's word.
 */
export function GrnPaperPage() {
  const params = useParams<{ id?: string }>();
  const canView = usePermission(PERMISSIONS.PURCHASE_DOCUMENT_VIEW);
  const grn = useGrn(canView ? (params.id ?? null) : null);
  const po = usePurchaseOrder(grn.data?.purchaseOrderId ?? null);

  if (!canView) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningCircleIcon />
          </EmptyMedia>
          <EmptyTitle>You cannot view goods receipts</EmptyTitle>
          <EmptyDescription>This needs purchase.document.view — the Purchase role carries it.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const failed = [grn, po].find((q) => q.isError);
  if (failed !== undefined) {
    return (
      <QueryErrorAlert
        error={failed.error}
        subject="that goods receipt"
        onRetry={() => {
          void failed.refetch();
        }}
      />
    );
  }
  if (grn.data === undefined || po.data === undefined) return <PaperPageSkeleton label="Loading the goods receipt note" />;
  const record = grn.data;
  const pending = record.pendingAllocations.length;

  return (
    <PaperPage
      docType="RECEIPT_NOTE"
      record={grnAsPaper(record, po.data)}
      backTo="/purchase/grns"
      backLabel="Goods receipts"
      title={record.syncState === 'PUSHED' && record.remoteVoucherNumber ? `Goods receipt #${record.remoteVoucherNumber} (${record.number})` : `Goods receipt ${record.number}`}
      badges={
        <>
          <SyncStateBadge record={record} />
          {pending > 0 ? <Badge variant="destructive">{pending} pending allocation{pending === 1 ? '' : 's'}</Badge> : null}
        </>
      }
      printPath={`/print/grns/${record.id}`}
      excel={{ path: `/purchase/grns/${record.id}/export.xlsx`, filename: `GRN-${record.number}.xlsx` }}
      extras={
        <div className="flex flex-col gap-6">
          {record.lastError ? (
            <Alert variant="destructive">
              <XCircleIcon />
              <AlertTitle>{record.syncState === 'FAILED' ? 'Tally rejected it' : 'Tally has since changed it'}</AlertTitle>
              <AlertDescription>
                <p className="font-mono text-xs">{record.lastError}</p>
                <p className="mt-1">{record.syncState === 'FAILED' ? 'Tally’s own words (REQ-T-01).' : 'Seen on the pull (D-38). The stock is on the shelf either way.'}</p>
              </AlertDescription>
            </Alert>
          ) : null}
          <p className="text-muted-foreground text-sm">
            Against{' '}
            <Link to={`/purchase/orders/${record.purchaseOrderId}`} className="underline-offset-4 hover:underline">
              {record.purchaseOrderNumber}
            </Link>{' '}
            from {record.vendorName}, {formatRelativeAge(record.receivedAt)}
            {record.receivedByName ? ` by ${record.receivedByName}` : ''}.
            {record.syncState === 'PUSHED' ? ` In Tally as Receipt Note #${record.remoteVoucherNumber ?? '?'}.` : record.syncState === 'QUEUED' ? ' Queued for Tally as a Receipt Note.' : ''}
            {' '}Received goes into stock through the Receipt Note; rejected does not, and keeps the PO line open (REQ-X-21).
          </p>
          {pending > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionHeading title="Pending allocation" note="Less arrived than the orders behind these lines need. Who gets it is decided here, not by arrival order (REQ-X-27, D-30)." />
              <AllocationForm grn={record} />
            </section>
          ) : null}
        </div>
      }
    />
  );
}
