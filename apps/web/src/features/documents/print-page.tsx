import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { useParty } from '@/features/masters/use-parties';
import { useEstimate } from '@/features/sales/use-estimates';
import { useBranding } from '@/lib/branding/use-branding';
import { INVOICE_COPIES, INVOICE_COPY_LABELS, SALES_DOCUMENT_STATUS_LABELS, type InvoiceCopy, type PrintedDocumentType } from '@vyuha/shared';

import { DocumentPaper, type PaperModel } from './paper';
import { useDocumentSettings } from './use-document-settings';

/**
 * The print route: the paper and nothing else, outside the shell, so the
 * browser's print dialog — and its Save as PDF — sees an A4 page and no
 * chrome (`@page` and `.a4-paper` in index.css). Opened in its own tab from
 * a document's PDF button; prints on load, and stays open so it can be
 * printed again or saved. An invoice prints its three copies as three
 * pages, each named (GST's original, duplicate, triplicate).
 */

const KINDS: Record<string, PrintedDocumentType> = { estimates: 'ESTIMATE' };

export function DocumentPrintPage() {
  const params = useParams<{ kind: string; id: string }>();
  const [searchParams] = useSearchParams();
  const type = KINDS[params.kind ?? ''] ?? null;
  const settings = useDocumentSettings();
  const branding = useBranding();
  const estimate = useEstimate(type === 'ESTIMATE' ? (params.id ?? null) : null);
  const record = estimate.data;
  const party = useParty(record?.partyId ?? null);
  const ready = record !== undefined && settings.data !== undefined && branding.data !== undefined && (record.partyId === null || party.data !== undefined || party.isError);

  useEffect(() => {
    if (!ready || searchParams.get('auto') === '0') return;
    // A frame later, so the fonts and the logo have painted before the dialog snapshots the page.
    const timer = window.setTimeout(() => {
      window.print();
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready, searchParams]);

  if (type === null) return <p className="p-6 text-sm">Nothing prints at this address.</p>;
  if (estimate.isError) {
    return (
      <div className="p-6">
        <QueryErrorAlert error={estimate.error} subject="that document" onRetry={() => { void estimate.refetch(); }} />
      </div>
    );
  }
  if (!ready) {
    return (
      <div role="status" aria-busy="true" aria-label="Preparing the page" className="mx-auto max-w-[210mm] p-6">
        <Skeleton className="h-[297mm] w-full" />
      </div>
    );
  }
  const copies: readonly (InvoiceCopy | null)[] = type === 'INVOICE' ? INVOICE_COPIES : [null];
  const model: PaperModel = {
    type,
    number: record.number,
    statusLabel: SALES_DOCUMENT_STATUS_LABELS[record.status],
    date: record.date,
    validUntil: record.validUntil,
    buyer: {
      name: record.customerName,
      address: party.data?.address ?? '',
      gstin: party.data?.gstin ?? '',
      stateName: '',
      stateCode: record.placeOfSupply ?? (party.data?.gstin ?? '').slice(0, 2).replace(/\D/gu, ''),
    },
    shipTo: record.shipTo,
    details: record.details ?? {},
    reference: null,
    lines: record.lines.map((line) => ({ key: line.id, stockItemId: line.stockItemId, description: line.description, hsnCode: line.hsnCode ?? '', quantity: line.quantity, unit: line.unit ?? '', rate: line.rate, discountPct: line.discountPct, taxPct: line.taxPct, amount: line.amount, taxAmount: line.taxAmount })),
    totals: { subtotal: record.subtotal, discountTotal: record.discountTotal, taxTotal: record.taxTotal, grandTotal: record.grandTotal, preview: false },
    notes: record.notes ?? '',
    terms: record.terms ?? '',
  };
  return (
    <div className="bg-muted/40 min-h-dvh print:bg-white">
      <div className="print-hidden mx-auto flex max-w-[210mm] items-center justify-between gap-2 px-4 py-3 text-sm">
        <span className="text-muted-foreground">Use your browser's print dialog to save this as a PDF (A4).</span>
        <Button size="sm" onClick={() => { window.print(); }}>
          Print or save PDF
        </Button>
      </div>
      <div className="mx-auto flex max-w-[210mm] flex-col gap-6 pb-8 print:gap-0 print:pb-0">
        {copies.map((copy) => (
          <DocumentPaper
            key={copy ?? 'single'}
            design={settings.data.designs[type]}
            profile={settings.data.profile}
            logoUrl={branding.data.logoUrl}
            orgName={branding.data.name}
            model={{ ...model, copyLabel: copy === null ? null : INVOICE_COPY_LABELS[copy] }}
          />
        ))}
      </div>
    </div>
  );
}
