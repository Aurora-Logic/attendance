import { WarningCircleIcon } from '@phosphor-icons/react';
import { useParams } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { PaperPage, PaperPageSkeleton } from '@/features/documents/paper-page';
import { voucherAsPaper } from '@/features/documents/paper-record';
import { formatRelativeAge } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { useVoucher } from './use-vouchers';

/**
 * A Tally voucher on the organisation's own paper (owner, 22 Aug 2026):
 * the same shell the documents wear -- the sheet fitted to the screen,
 * PDF through the print route, Excel, the design rail -- drawn from
 * Tally's figures. The figures are Tally's and are not edited here; the
 * paper is the organisation's, so a Sales voucher prints as its tax
 * invoice on the invoice design and a receipt on the same design under
 * its own name.
 */
export function VoucherPaperPage() {
  const params = useParams<{ id?: string }>();
  const canView = usePermission(PERMISSIONS.RECEIVABLES_VIEW);
  const voucher = useVoucher(canView ? (params.id ?? null) : null);

  if (!canView) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningCircleIcon />
          </EmptyMedia>
          <EmptyTitle>You cannot view vouchers</EmptyTitle>
          <EmptyDescription>This needs receivables.view — the Accounts role carries it.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (voucher.isError) {
    return (
      <QueryErrorAlert
        error={voucher.error}
        subject="that voucher"
        onRetry={() => {
          void voucher.refetch();
        }}
      />
    );
  }
  if (voucher.data === undefined) return <PaperPageSkeleton label="Loading the voucher" />;
  const { type, record } = voucherAsPaper(voucher.data);
  const number = voucher.data.voucherNumber || record.title || voucher.data.voucherType;

  return (
    <PaperPage
      docType={type}
      record={record}
      backTo={`/masters/vouchers/${voucher.data.id}`}
      backLabel={number}
      title={`${record.title ?? voucher.data.voucherType} ${voucher.data.voucherNumber}`.trim()}
      badges={voucher.data.isCancelled ? <Badge variant="outline">Cancelled</Badge> : <Badge variant="outline">From Tally</Badge>}
      printPath={`/print/vouchers/${voucher.data.id}`}
      excel={{ path: `/masters/vouchers/${voucher.data.id}/export.xlsx`, filename: `${(record.title ?? 'Voucher').replace(/\s+/gu, '-')}-${(voucher.data.voucherNumber || voucher.data.id.slice(-4)).replace(/[\\/]/gu, '-')}.xlsx` }}
      extras={
        <p className="text-muted-foreground text-sm">
          Figures as Tally held them {formatRelativeAge(voucher.data.lastPulledAt)}; the paper is this organisation's design. Nothing here writes back to Tally.
        </p>
      }
    />
  );
}
