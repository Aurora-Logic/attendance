import { z } from 'zod';

import { newLine, trimZeros, type LineDraft } from '@/features/sales/types';
import { PO_FULFILMENT_STATES, PURCHASE_ORDER_STATUSES, REQUIREMENT_SOURCES, REQUIREMENT_STATES, SYNC_STATES } from '@vyuha/shared';

/**
 * What `/purchase/*` answers (13 §4), parsed at the boundary. Each schema
 * mirrors the view interface in `@vyuha/shared` purchase.ts field for field;
 * quantities and money stay strings end to end (D-01).
 */

const pageMeta = z.object({ page: z.number(), pageSize: z.number(), total: z.number() });

// ----------------------------------------------------------- requirements

export const requirementSchema = z.object({
  id: z.string(),
  stockItemId: z.string(),
  stockItemName: z.string(),
  quantity: z.string(),
  orderedQty: z.string(),
  receivedQty: z.string(),
  source: z.enum(REQUIREMENT_SOURCES),
  salesOrderId: z.string().nullable(),
  salesOrderLineId: z.string().nullable(),
  salesOrderNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  neededBy: z.string().nullable(),
  state: z.enum(REQUIREMENT_STATES),
  closedReason: z.string().nullable(),
  createdAt: z.string(),
});
export type Requirement = z.infer<typeof requirementSchema>;
export const requirementListSchema = z.array(requirementSchema);

/** `POST /purchase/requirements/:id/close` answers only whether it closed. */
export const closedSchema = z.object({ closed: z.boolean() });

// -------------------------------------------------------- purchase orders

export const purchaseOrderLineSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  stockItemId: z.string().nullable(),
  description: z.string(),
  quantity: z.string(),
  unit: z.string().nullable(),
  rate: z.string(),
  taxPct: z.string(),
  amount: z.string(),
  taxAmount: z.string(),
  receivedQty: z.string(),
  rejectedQty: z.string(),
  requirements: z.array(
    z.object({
      requirementId: z.string(),
      quantity: z.string(),
      salesOrderNumber: z.string().nullable(),
      customerName: z.string().nullable(),
    }),
  ),
});
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;

/** REQ-X-18 / REQ-AA-26: the vendor's copy, per channel, sent by hand until the channel lands. */
export const purchaseNotificationSchema = z.object({
  id: z.string(),
  channel: z.enum(['email', 'whatsapp']),
  recipient: z.string().nullable(),
  status: z.enum(['pending', 'sent', 'failed']),
  composedText: z.string(),
  sentAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type PurchaseNotification = z.infer<typeof purchaseNotificationSchema>;

const purchaseOrderHeaderShape = {
  id: z.string(),
  number: z.string(),
  status: z.enum(PURCHASE_ORDER_STATUSES),
  fulfilment: z.enum(PO_FULFILMENT_STATES),
  date: z.string(),
  partyId: z.string(),
  vendorName: z.string(),
  vendorEmail: z.string().nullable(),
  vendorWhatsapp: z.string().nullable(),
  salesOrderId: z.string().nullable(),
  expectedDate: z.string().nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  notes: z.string().nullable(),
  subtotal: z.string(),
  taxTotal: z.string(),
  grandTotal: z.string(),
  approvalRequired: z.boolean(),
  syncState: z.enum(SYNC_STATES),
  remoteGuid: z.string().nullable(),
  remoteVoucherNumber: z.string().nullable(),
  lastError: z.string().nullable(),
  shortClosedAt: z.string().nullable(),
  shortCloseReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const purchaseOrderSummarySchema = z.object(purchaseOrderHeaderShape);
export type PurchaseOrderSummary = z.infer<typeof purchaseOrderSummarySchema>;
export const purchaseOrderSchema = z.object({ ...purchaseOrderHeaderShape, lines: z.array(purchaseOrderLineSchema), notifications: z.array(purchaseNotificationSchema) });
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;

export const purchaseOrdersResponseSchema = z.object({ data: z.array(purchaseOrderSummarySchema), meta: pageMeta });
export type PurchaseOrdersResponse = z.infer<typeof purchaseOrdersResponseSchema>;

// ------------------------------------------------------------------ GRNs

export const grnSchema = z.object({
  id: z.string(),
  number: z.string(),
  purchaseOrderId: z.string(),
  purchaseOrderNumber: z.string(),
  vendorName: z.string(),
  receivedById: z.string().nullable(),
  receivedByName: z.string().nullable(),
  receivedAt: z.string(),
  vendorInvoiceRef: z.string().nullable(),
  notes: z.string().nullable(),
  syncState: z.enum(SYNC_STATES),
  remoteGuid: z.string().nullable(),
  remoteVoucherNumber: z.string().nullable(),
  lastError: z.string().nullable(),
  lines: z.array(
    z.object({
      purchaseOrderLineId: z.string(),
      description: z.string(),
      receivedQty: z.string(),
      rejectedQty: z.string(),
      rejectionReason: z.string().nullable(),
    }),
  ),
  pendingAllocations: z.array(
    z.object({
      purchaseOrderLineId: z.string(),
      stockItemName: z.string(),
      unallocatedQty: z.string(),
      waiting: z.array(
        z.object({
          requirementId: z.string(),
          salesOrderNumber: z.string().nullable(),
          customerName: z.string().nullable(),
          outstandingQty: z.string(),
        }),
      ),
    }),
  ),
});
export type Grn = z.infer<typeof grnSchema>;
export type PendingAllocation = Grn['pendingAllocations'][number];
/** `GET /purchase/grns` answers a plain array (the newest 200), not a page. */
export const grnListSchema = z.array(grnSchema);

// ------------------------------------------------------------ item facts

export const itemVendorSchema = z.object({
  partyId: z.string(),
  partyName: z.string(),
  isPreferred: z.boolean(),
  leadTimeDays: z.number().nullable(),
});
export type ItemVendor = z.infer<typeof itemVendorSchema>;
export const itemVendorListSchema = z.array(itemVendorSchema);

export const purchaseHistoryEntrySchema = z.object({
  source: z.enum(['voucher', 'purchase_order']),
  date: z.string(),
  reference: z.string(),
  vendorName: z.string(),
  quantity: z.string().nullable(),
  rate: z.string().nullable(),
  amount: z.string().nullable(),
});
export type PurchaseHistoryEntry = z.infer<typeof purchaseHistoryEntrySchema>;
export const purchaseHistorySchema = z.array(purchaseHistoryEntrySchema);

/** REQ-AC-04: available = closing − committed, with the pull it rests on (REQ-AC-05). */
export const stockAvailabilitySchema = z.object({
  stockItemId: z.string(),
  closingQty: z.string().nullable(),
  committedQty: z.string(),
  availableQty: z.string().nullable(),
  openPoQty: z.string(),
  reorderLevel: z.string().nullable(),
  minimumOrderQty: z.string().nullable(),
  asOf: z.string().nullable(),
});
export type StockAvailability = z.infer<typeof stockAvailabilitySchema>;

// ---------------------------------------------------------------- drafts

/**
 * The sheet's working copy of a purchase order. Lines are the sales editor's
 * `LineDraft`; which requirements each line takes up (REQ-X-10) rides beside
 * them keyed by line key, because the editor knows nothing of requirements
 * and a re-save that dropped the links would silently orphan the queue.
 */
export interface PurchaseOrderDraft {
  id?: string;
  number: string | null;
  status: PurchaseOrder['status'];
  partyId: string | null;
  vendorName: string;
  vendorEmail: string;
  vendorWhatsapp: string;
  date: string;
  expectedDate: string | null;
  salesOrderId: string | null;
  notes: string;
  lines: LineDraft[];
  lineRequirements: Record<string, string[]>;
}

export function emptyPurchaseOrderDraft(today: string, overrides: Partial<PurchaseOrderDraft> = {}): PurchaseOrderDraft {
  return {
    number: null,
    status: 'DRAFT',
    partyId: null,
    vendorName: '',
    vendorEmail: '',
    vendorWhatsapp: '',
    date: today,
    expectedDate: null,
    salesOrderId: null,
    notes: '',
    lines: [newLine()],
    lineRequirements: {},
    ...overrides,
  };
}

export function purchaseOrderToDraft(order: PurchaseOrder): PurchaseOrderDraft {
  const lineRequirements: Record<string, string[]> = {};
  const lines = order.lines.map((line) => {
    const draft = newLine({
      stockItemId: line.stockItemId,
      description: line.description,
      quantity: trimZeros(line.quantity),
      unit: line.unit ?? '',
      rate: trimZeros(line.rate),
      discountPct: '0',
      taxPct: trimZeros(line.taxPct),
    });
    lineRequirements[draft.key] = line.requirements.map((r) => r.requirementId);
    return draft;
  });
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    partyId: order.partyId,
    vendorName: order.vendorName,
    vendorEmail: order.vendorEmail ?? '',
    vendorWhatsapp: order.vendorWhatsapp ?? '',
    date: order.date,
    expectedDate: order.expectedDate,
    salesOrderId: order.salesOrderId,
    notes: order.notes ?? '',
    lines,
    lineRequirements,
  };
}

/**
 * What "changed" compares. Line keys are minted fresh every time a record is
 * turned into a draft, so a refetch would otherwise make a clean sheet read
 * as dirty and hide the Confirm button; the fingerprint carries the
 * requirement links beside each line and forgets the keys.
 */
export function draftFingerprint(draft: PurchaseOrderDraft): string {
  const { lines, lineRequirements, ...header } = draft;
  return JSON.stringify({ ...header, lines: lines.map(({ key, ...line }) => ({ ...line, requirementIds: lineRequirements[key] ?? [] })) });
}

/** `12.000` → `12`; a quantity as a person reads it. */
export function formatQty(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return trimZeros(value);
}

/** What is still to come on a PO line: ordered − received − rejected, never below zero. */
export function lineBalance(line: Pick<PurchaseOrderLine, 'quantity' | 'receivedQty' | 'rejectedQty'>): number {
  return Math.max(0, Number(line.quantity) - Number(line.receivedQty) - Number(line.rejectedQty));
}
