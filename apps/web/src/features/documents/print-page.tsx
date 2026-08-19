import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { useParty } from '@/features/masters/use-parties';
import type { PurchaseOrder } from '@/features/purchase/types';
import { usePurchaseOrder } from '@/features/purchase/use-purchase';
import type { Estimate } from '@/features/sales/types';
import { useEstimate, useSalesOrder } from '@/features/sales/use-estimates';
import { useInvoice } from '@/features/sales/use-invoices';
import { useBranding } from '@/lib/branding/use-branding';
import { INVOICE_COPIES, INVOICE_COPY_LABELS, PURCHASE_ORDER_STATUS_LABELS, SALES_DOCUMENT_STATUS_LABELS, type InvoiceCopy, type PrintedDocumentType } from '@vyuha/shared';

import { DocumentPaper, type PaperModel } from './paper';
import { useDocumentSettings, useFooterLogoUrls } from './use-document-settings';

/**
 * The print route: the paper and nothing else, outside the shell, so the
 * browser's print dialog — and its Save as PDF — sees an A4 page and no
 * chrome (`@page` and `.a4-paper` in index.css). Opened in its own tab from
 * a document's PDF button; prints on load, and stays open so it can be
 * printed again or saved. An invoice prints its three copies as three
 * pages, each named (GST's original, duplicate, triplicate).
 */

const KINDS: Record<string, PrintedDocumentType> = { estimates: 'ESTIMATE', orders: 'SALES_ORDER', invoices: 'INVOICE', 'purchase-orders': 'PURCHASE_ORDER' };

export function DocumentPrintPage() {
  const params = useParams<{ kind: string; id: string }>();
  const [searchParams] = useSearchParams();
  const type = KINDS[params.kind ?? ''] ?? null;
  const settings = useDocumentSettings();
  const branding = useBranding();
  // One hook per kind, all mounted; only the matching one asks.
  const estimate = useEstimate(type === 'ESTIMATE' ? (params.id ?? null) : null);
  const order = useSalesOrder(type === 'SALES_ORDER' ? (params.id ?? null) : null);
  const invoice = useInvoice(type === 'INVOICE' ? (params.id ?? null) : null);
  const purchaseOrder = usePurchaseOrder(type === 'PURCHASE_ORDER' ? (params.id ?? null) : null);
  const source = type === 'SALES_ORDER' ? order : type === 'INVOICE' ? invoice : estimate;
  // The purchase order is another module's record, read into the same paper shape below.
  const record = type === 'PURCHASE_ORDER' ? (purchaseOrder.data === undefined ? undefined : purchaseOrderAsPaper(purchaseOrder.data)) : source.data === undefined ? undefined : salesDocumentAsPaper(source.data);
  const query = type === 'PURCHASE_ORDER' ? purchaseOrder : source;
  const party = useParty(record?.partyId ?? null);
  const footerLogoUrls = useFooterLogoUrls(settings.data?.profile.footerLogoFileIds ?? []);
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
  if (query.isError) {
    return (
      <div className="p-6">
        <QueryErrorAlert error={query.error} subject="that document" onRetry={() => { void query.refetch(); }} />
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
    statusLabel: record.statusLabel,
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
            footerLogoUrls={footerLogoUrls}
            orgName={branding.data.name}
            model={{ ...model, copyLabel: copy === null ? null : INVOICE_COPY_LABELS[copy] }}
          />
        ))}
      </div>
    </div>
  );
}

/** The fields the paper reads, named the way every sales record names them. */
interface PaperRecord {
  readonly number: string;
  readonly statusLabel: string;
  readonly date: string;
  readonly validUntil: string | null;
  readonly partyId: string | null;
  readonly customerName: string;
  readonly placeOfSupply: string | null;
  readonly shipTo: PaperModel['shipTo'];
  readonly details: PaperModel['details'] | null;
  readonly lines: readonly { id: string; stockItemId: string | null; description: string; hsnCode: string | null; quantity: string; unit: string | null; rate: string; discountPct: string; taxPct: string; amount: string; taxAmount: string }[];
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly grandTotal: string;
  readonly notes: string | null;
  readonly terms: string | null;
}

function salesDocumentAsPaper(doc: Estimate): PaperRecord {
  return { ...doc, statusLabel: SALES_DOCUMENT_STATUS_LABELS[doc.status] };
}

function purchaseOrderAsPaper(po: PurchaseOrder): PaperRecord {
  return {
    number: po.number,
    statusLabel: PURCHASE_ORDER_STATUS_LABELS[po.status],
    date: po.date,
    validUntil: po.expectedDate,
    partyId: po.partyId,
    customerName: po.vendorName,
    placeOfSupply: null,
    shipTo: po.shipTo,
    details: po.details,
    lines: po.lines,
    subtotal: po.subtotal,
    discountTotal: po.discountTotal,
    taxTotal: po.taxTotal,
    grandTotal: po.grandTotal,
    notes: po.notes,
    terms: po.terms,
  };
}
