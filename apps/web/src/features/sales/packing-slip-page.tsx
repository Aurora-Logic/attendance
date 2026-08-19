import { WarningCircleIcon } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { PaperPage, PaperPageSkeleton } from '@/features/documents/paper-page';
import { packAsPaper } from '@/features/documents/paper-record';
import { formatRelativeAge } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { useSalesOrder } from './use-estimates';
import { usePackRecord } from './use-fulfilment';

/**
 * One packing session as the slip that goes in the box (REQ-AA-09): what
 * was packed, how many boxes, who packed it — on the same paper as the
 * order, quantities only, with the order's ship-to so the box is addressed.
 */
export function PackingSlipPage() {
  const params = useParams<{ id?: string }>();
  const canViewSelf = usePermission(PERMISSIONS.SALES_DOCUMENT_VIEW_SELF);
  const canViewAll = usePermission(PERMISSIONS.SALES_DOCUMENT_VIEW_ALL);
  const canView = canViewSelf || canViewAll;
  const pack = usePackRecord(canView ? (params.id ?? null) : null);
  const order = useSalesOrder(pack.data?.documentId ?? null);

  if (!canView) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningCircleIcon />
          </EmptyMedia>
          <EmptyTitle>You cannot view packing slips</EmptyTitle>
          <EmptyDescription>This needs sales.document.view.self or sales.document.view.all.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const failed = [pack, order].find((q) => q.isError);
  if (failed !== undefined) {
    return (
      <QueryErrorAlert
        error={failed.error}
        subject="that packing slip"
        onRetry={() => {
          void failed.refetch();
        }}
      />
    );
  }
  if (pack.data === undefined || order.data === undefined) return <PaperPageSkeleton label="Loading the packing slip" />;
  const record = packAsPaper(pack.data, order.data);

  return (
    <PaperPage
      docType="PACKING_SLIP"
      record={record}
      backTo={`/sales/orders/${order.data.id}`}
      backLabel={order.data.number}
      title={`Packing slip ${record.number}`}
      badges={<Badge variant="outline">{record.statusLabel}</Badge>}
      printPath={`/print/packs/${pack.data.id}`}
      excel={{ path: `/sales/packs/${pack.data.id}/export.xlsx`, filename: `Packing-Slip-${record.number.replace('/', '-')}.xlsx` }}
      extras={
        <p className="text-muted-foreground text-sm">
          Packed {formatRelativeAge(pack.data.packedAt)}
          {pack.data.packedByName ? ` by ${pack.data.packedByName}` : ''} against{' '}
          <Link to={`/sales/orders/${order.data.id}`} className="underline-offset-4 hover:underline">
            {order.data.number}
          </Link>
          . The order shows the balance still to pack.
        </p>
      }
    />
  );
}
