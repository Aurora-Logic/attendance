import { z } from 'zod';

import { pageQuerySchema } from './pagination.js';

/**
 * Sales documents (08 Area W). Phase 8a opens with the estimate (REQ-W-01):
 * Vyuha-owned, never pushed to Tally (D-04). Later document types share the
 * table and this contract; the type discriminator is what Tally itself does
 * with vouchers (09 §4.3), and one line editor serves them all.
 *
 * Money is exact decimal text end to end. Line arithmetic — quantity × rate,
 * less a discount, plus tax shown for information — is done once, in SQL, on
 * save; the client shows what the server computed and never re-derives it.
 */

export const SALES_DOCUMENT_TYPES = ['ESTIMATE', 'SALES_ORDER', 'INVOICE'] as const;
export type SalesDocumentType = (typeof SALES_DOCUMENT_TYPES)[number];

export const SALES_DOCUMENT_TYPE_LABELS: Record<SalesDocumentType, string> = { ESTIMATE: 'Estimate', SALES_ORDER: 'Sales order', INVOICE: 'Invoice' };
export const SALES_DOCUMENT_TYPE_PREFIX: Record<SalesDocumentType, string> = { ESTIMATE: 'EST', SALES_ORDER: 'SO', INVOICE: 'INV' };
/** The Tally voucher type a pushed document becomes (09 §3.1). Estimates have none: they are never pushed (D-04). */
export const SALES_DOCUMENT_VOUCHER_TYPE: Record<SalesDocumentType, string | null> = { ESTIMATE: null, SALES_ORDER: 'Sales Order', INVOICE: 'Sales' };

/**
 * A document's life. Estimates: draft → sent → accepted / rejected / expired.
 * Sales orders: draft → confirmed (queued for Tally) → the sync state says
 * the rest; cancelled from draft. `ESTIMATE_STATUSES` keeps its old name for
 * the callers that only ever meant estimates.
 */
export const ESTIMATE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

export const SALES_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];
export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

/** Labels across both lives, for a caller holding a row of either type. */
export const SALES_DOCUMENT_STATUS_LABELS: Record<EstimateStatus | SalesOrderStatus, string> = {
  ...ESTIMATE_STATUS_LABELS,
  ...SALES_ORDER_STATUS_LABELS,
};

/** True when a status belongs to an estimate's life. */
export function isEstimateStatus(status: string): status is EstimateStatus {
  return (ESTIMATE_STATUSES as readonly string[]).includes(status);
}

/**
 * REQ-W-06: every pushed document carries a visible sync state, and it is
 * never inferred — only what the agent reported. `NOT_PUSHED` is a draft;
 * `QUEUED` is a job waiting for the agent; `PUSHED` and `FAILED` are the
 * agent's word, with the GUID or Tally's verbatim error beside it.
 */
export const SYNC_STATES = ['NOT_PUSHED', 'QUEUED', 'PUSHED', 'FAILED'] as const;
export type DocumentSyncState = (typeof SYNC_STATES)[number];
export const SYNC_STATE_LABELS: Record<DocumentSyncState, string> = {
  NOT_PUSHED: 'Not in Tally',
  QUEUED: 'Queued for Tally',
  PUSHED: 'In Tally',
  FAILED: 'Rejected by Tally',
};

/**
 * Which moves are allowed. Draft may go anywhere it makes sense; a sent
 * estimate is decided or expires; a decided one is final. Editing lines is a
 * draft's privilege — anything later is a new estimate.
 */
export const ESTIMATE_TRANSITIONS: Record<EstimateStatus, readonly EstimateStatus[]> = {
  DRAFT: ['SENT', 'ACCEPTED', 'REJECTED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'DRAFT'],
  ACCEPTED: [],
  REJECTED: ['DRAFT'],
  EXPIRED: ['DRAFT'],
};

const moneyText = z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/u, 'a number with up to two decimals');
const quantityText = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/u, 'a quantity with up to three decimals');
const percentText = z.string().trim().regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/u, 'a percentage from 0 to 100');

export const salesLineInputSchema = z
  .object({
    /** A stock item from the projection, or null for a free-text line. */
    stockItemId: z.uuid().nullish(),
    /** Defaults to the item's name when an item is given; required otherwise. */
    description: z.string().trim().max(200).default(''),
    quantity: quantityText,
    unit: z.string().trim().max(20).nullish(),
    rate: moneyText,
    discountPct: percentText.default('0'),
    /** Shown for information (REQ-W-01); defaults from the item's GST rate. */
    taxPct: percentText.default('0'),
  })
  .refine((line) => line.stockItemId != null || line.description !== '', {
    message: 'a description is required for a line without a stock item',
    path: ['description'],
  });
export type SalesLineInput = z.infer<typeof salesLineInputSchema>;

export interface SalesLineView {
  readonly id: string;
  readonly lineNo: number;
  readonly stockItemId: string | null;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string | null;
  readonly rate: string;
  readonly discountPct: string;
  readonly taxPct: string;
  /** quantity × rate × (1 − discount), exact. */
  readonly amount: string;
  /** amount × tax, exact. */
  readonly taxAmount: string;
  /** REQ-AA-01/AA-29: the state, as numbers. Zero on an estimate. */
  readonly packedQty: string;
  readonly invoicedQty: string;
  readonly dispatchedQty: string;
}

/**
 * REQ-AA-02/AA-03 (+ D-34): derived from the line quantities, never stored.
 * The word summarises; the numbers beside it are what count.
 */
export const FULFILMENT_STATES = ['open', 'picking', 'awaiting_invoice', 'ready_to_dispatch', 'partially_dispatched', 'closed', 'short_closed'] as const;
export type FulfilmentState = (typeof FULFILMENT_STATES)[number];
export const FULFILMENT_STATE_LABELS: Record<FulfilmentState, string> = {
  open: 'Open',
  picking: 'Picking',
  awaiting_invoice: 'Awaiting invoice',
  ready_to_dispatch: 'Ready to dispatch',
  partially_dispatched: 'Partially dispatched',
  closed: 'Closed',
  short_closed: 'Short-closed',
};

/** Every status a document row may carry; which apply is decided by `docType`. */
export type SalesDocumentStatus = EstimateStatus | SalesOrderStatus;

export interface EstimateView {
  readonly id: string;
  readonly docType: SalesDocumentType;
  readonly number: string;
  readonly status: SalesDocumentStatus;
  readonly date: string;
  readonly validUntil: string | null;
  /** The Tally party, when the customer is one. */
  readonly partyId: string | null;
  /** The CRM company, when the customer is a prospect (REQ-U-03: never a ledger until they buy). */
  readonly companyId: string | null;
  readonly dealId: string | null;
  /** Whom it is addressed to, as printed. */
  readonly customerName: string;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly notes: string | null;
  readonly terms: string | null;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly grandTotal: string;
  /** The estimate a sales order was converted from (REQ-W-03), when it was. */
  readonly sourceDocumentId: string | null;
  /** REQ-W-06. Always `NOT_PUSHED` on an estimate. */
  readonly syncState: DocumentSyncState;
  readonly remoteGuid: string | null;
  readonly remoteVoucherNumber: string | null;
  readonly lastPushedAt: string | null;
  /** Tally's verbatim words when the push was rejected (REQ-T-01). */
  readonly lastError: string | null;
  /** Orders only (null on an estimate): the derived fulfilment word. */
  readonly fulfilment: FulfilmentState | null;
  readonly shortClosedAt: string | null;
  readonly shortCloseReason: string | null;
  /** REQ-AA-28: where the customer is told, overridable per order. */
  readonly customerEmail: string | null;
  readonly customerWhatsapp: string | null;
  readonly lines: readonly SalesLineView[];
  /** Orders only: the invoices Tally raised against it (REQ-AA-12). */
  readonly invoices: readonly OrderInvoiceView[];
  /** Orders only (13 REQ-X-26): why it waits and what it waits on — each open requirement with the POs raised against it. Empty when nothing waits. */
  readonly waitingOn: readonly OrderWaitingOnView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrderWaitingOnView {
  readonly requirementId: string;
  readonly lineId: string | null;
  readonly stockItemName: string;
  readonly quantity: string;
  readonly orderedQty: string;
  readonly receivedQty: string;
  readonly state: 'open' | 'ordered' | 'received' | 'closed';
  readonly neededBy: string | null;
  readonly purchaseOrders: readonly { id: string; number: string; vendorName: string; status: string; expectedDate: string | null; quantity: string }[];
}

export interface OrderInvoiceView {
  /** The Tally voucher, when it has arrived; null for a Vyuha-raised invoice not yet pulled back. */
  readonly voucherId: string | null;
  /** The Vyuha invoice document, when it was raised here (D-38). */
  readonly invoiceDocumentId: string | null;
  readonly voucherNumber: string;
  readonly date: string;
  readonly amount: string;
  readonly method: 'narration' | 'manual' | 'vyuha';
  readonly linkedAt: string;
}

/** The list row: the header without its lines. */
export type EstimateSummary = Omit<EstimateView, 'lines' | 'invoices' | 'waitingOn'>;

/** A sales order is the same shape; the type says which life it leads. */
export type SalesDocumentView = EstimateView;
export type SalesDocumentSummary = EstimateSummary;

export const estimateListQuerySchema = pageQuerySchema.extend({
  /** Free text over number and customer name. */
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(ESTIMATE_STATUSES).optional(),
  syncState: z.enum(SYNC_STATES).optional(),
  partyId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  sort: z.string().max(200).optional(),
});
export type EstimateListQuery = z.infer<typeof estimateListQuerySchema>;

export const ESTIMATE_SORT_FIELDS = ['number', 'date', 'grandTotal', 'customerName', 'updatedAt'] as const;
export const DEFAULT_ESTIMATE_SORT = '-date';

const customerSchema = z
  .object({
    partyId: z.uuid().nullish(),
    companyId: z.uuid().nullish(),
    /** Required when neither id is given; otherwise defaults to the record's name. */
    customerName: z.string().trim().min(1).max(200).nullish(),
  })
  .refine((c) => c.partyId != null || c.companyId != null || (c.customerName != null && c.customerName !== ''), {
    message: 'a party, a company, or a customer name is required',
    path: ['customerName'],
  });

export const createEstimateSchema = customerSchema.safeExtend({
  date: z.iso.date().optional(),
  validUntil: z.iso.date().nullish(),
  dealId: z.uuid().nullish(),
  ownerId: z.uuid().nullish(),
  notes: z.string().trim().max(4000).nullish(),
  terms: z.string().trim().max(4000).nullish(),
  lines: z.array(salesLineInputSchema).max(200).default([]),
});
export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;

/** Header and lines together; lines, when given, replace the set (a draft's privilege). */
export const updateEstimateSchema = z.object({
  partyId: z.uuid().nullish(),
  companyId: z.uuid().nullish(),
  customerName: z.string().trim().min(1).max(200).optional(),
  date: z.iso.date().optional(),
  validUntil: z.iso.date().nullish(),
  dealId: z.uuid().nullish(),
  ownerId: z.uuid().nullish(),
  notes: z.string().trim().max(4000).nullish(),
  terms: z.string().trim().max(4000).nullish(),
  lines: z.array(salesLineInputSchema).max(200).optional(),
});
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;

export const estimateStatusSchema = z.object({ status: z.enum(ESTIMATE_STATUSES) });
export type EstimateStatusInput = z.infer<typeof estimateStatusSchema>;

/**
 * REQ-W-02: what this party was quoted and invoiced for this item before —
 * from the backfilled vouchers and from earlier estimates. The reason the
 * backfill is worth its cost, opened from the line editor.
 */
export const itemHistoryQuerySchema = z.object({
  stockItemId: z.uuid(),
  partyId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export type ItemHistoryQuery = z.infer<typeof itemHistoryQuerySchema>;

export interface ItemHistoryEntry {
  readonly source: 'voucher' | 'estimate';
  readonly date: string;
  /** "Sales INV-0042" or "Estimate EST-0007". */
  readonly reference: string;
  readonly quantity: string | null;
  readonly rate: string | null;
  readonly discountPct: string | null;
  readonly amount: string | null;
  readonly status: string | null;
}

export interface ItemHistoryView {
  readonly stockItemName: string;
  readonly currentSalePrice: string | null;
  /** REQ-AC-08: the other fact a salesperson needs at the same instant. */
  readonly availability: StockAvailability | null;
  readonly entries: readonly ItemHistoryEntry[];
  /** REQ-Y-07 in miniature: how fresh the voucher side is. */
  readonly vouchersAsOf: string | null;
}


// ------------------------------------------------------------ sales orders

export const salesOrderListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(SALES_ORDER_STATUSES).optional(),
  syncState: z.enum(SYNC_STATES).optional(),
  partyId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  sort: z.string().max(200).optional(),
});
export type SalesOrderListQuery = z.infer<typeof salesOrderListQuerySchema>;

/**
 * REQ-W-03: created fresh, or converted from an accepted estimate carrying
 * its lines. A sales order pushes to Tally, so its customer must be a Tally
 * party — Tally has no ledger for a prospect (REQ-U-03), and an order for
 * one cannot land anywhere.
 */
export const createSalesOrderSchema = z.object({
  partyId: z.uuid(),
  date: z.iso.date().optional(),
  dealId: z.uuid().nullish(),
  ownerId: z.uuid().nullish(),
  notes: z.string().trim().max(4000).nullish(),
  terms: z.string().trim().max(4000).nullish(),
  lines: z.array(salesLineInputSchema).min(1).max(200),
});
export type CreateSalesOrderInput = z.infer<typeof createSalesOrderSchema>;

export const updateSalesOrderSchema = z.object({
  partyId: z.uuid().optional(),
  date: z.iso.date().optional(),
  dealId: z.uuid().nullish(),
  ownerId: z.uuid().nullish(),
  notes: z.string().trim().max(4000).nullish(),
  terms: z.string().trim().max(4000).nullish(),
  lines: z.array(salesLineInputSchema).min(1).max(200).optional(),
});
export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderSchema>;

export const convertEstimateSchema = z.object({
  /** The Tally party the order is for; required when the estimate was addressed to a prospect. */
  partyId: z.uuid().optional(),
});
export type ConvertEstimateInput = z.infer<typeof convertEstimateSchema>;

/**
 * What the agent renders into Tally XML (09 §3.3: "agent … generates Tally
 * XML"). The API never writes XML; it hands the agent the document as data
 * and the agent owns the wire format on the push path as it does on the
 * pull path. `idempotencyKey` travels in the voucher's narration, and is
 * what the agent queries Tally for before any retry.
 */
/**
 * Everything that pushes (D-37). One outcome handler per kind; every pushed
 * record carries the same sync-state columns and the same Alter semantics.
 */
export const PUSH_KINDS = ['SALES_ORDER', 'DELIVERY_NOTE', 'PURCHASE_ORDER', 'RECEIPT_NOTE', 'SALES_INVOICE'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export const PUSH_KIND_VOUCHER_TYPE: Record<PushKind, string> = {
  SALES_ORDER: 'Sales Order',
  DELIVERY_NOTE: 'Delivery Note',
  PURCHASE_ORDER: 'Purchase Order',
  RECEIPT_NOTE: 'Receipt Note',
  /** D-38: a Vyuha-raised invoice is a Sales voucher in Tally. */
  SALES_INVOICE: 'Sales',
};

export const voucherPushPayloadSchema = z.object({
  documentId: z.uuid(),
  kind: z.enum(PUSH_KINDS),
  voucherType: z.string().min(1).max(60),
  /** Vyuha's document number, carried as the voucher's reference. */
  reference: z.string().min(1).max(60),
  date: z.iso.date(),
  partyName: z.string().min(1).max(200),
  narration: z.string().max(4000),
  idempotencyKey: z.string().min(1).max(120),
  /** Set on an alter (REQ-W-07): the agent alters this voucher and never creates a second. */
  remoteGuid: z.string().min(1).max(80).nullable(),
  lines: z.array(
    z.object({
      stockItemName: z.string().min(1).max(200),
      quantity: z.string().min(1).max(40),
      unit: z.string().max(20).nullable(),
      rate: z.string().min(1).max(40),
      discountPct: z.string().max(10),
      amount: z.string().min(1).max(40),
    }),
  ).min(1),
});
export type VoucherPushPayload = z.infer<typeof voucherPushPayloadSchema>;


// ------------------------------------------------------- pick, pack, invoice

const qtyText = z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/u, 'a quantity with up to three decimals');

/** REQ-AA-06/AA-07/AA-08/AA-09: one packing session. Lines not named are untouched. */
export const createPackRecordSchema = z.object({
  boxCount: z.number().int().min(1).max(999).default(1),
  comment: z.string().trim().max(2000).nullish(),
  lines: z.array(z.object({ lineId: z.uuid(), quantity: qtyText, comment: z.string().trim().max(1000).nullish() })).min(1).max(200),
});
export type CreatePackRecordInput = z.infer<typeof createPackRecordSchema>;

export interface PackRecordView {
  readonly id: string;
  readonly documentId: string;
  readonly boxCount: number;
  readonly packedById: string | null;
  readonly packedByName: string | null;
  readonly packedAt: string;
  readonly comment: string | null;
  readonly lines: readonly { lineId: string; description: string; quantity: string; comment: string | null }[];
}

/** REQ-AA-06: an open order with something left to pack, as the picker sees it. */
export interface PickQueueEntry {
  readonly documentId: string;
  readonly number: string;
  readonly customerName: string;
  readonly date: string;
  readonly fulfilment: FulfilmentState;
  readonly balanceLines: number;
  readonly balanceQty: string;
  /** REQ-X-26: what it waits on, when a shortage requirement is open. */
  readonly waitingOnRequirements: number;
}

/** REQ-AA-11/AA-15: packed, uninvoiced, and for how long. */
export interface AwaitingInvoiceEntry {
  readonly documentId: string;
  readonly number: string;
  readonly customerName: string;
  readonly packedUninvoicedQty: string;
  readonly waitingSince: string;
  readonly waitingHours: number;
}

/** REQ-AA-13: a Sales voucher with a party and no order behind it. */
export interface UnlinkedInvoice {
  readonly voucherId: string;
  readonly voucherNumber: string;
  readonly date: string;
  readonly partyId: string | null;
  readonly partyName: string;
  readonly amount: string;
  readonly narration: string | null;
  /** Open orders for the same party, for the manual link. */
  readonly candidateOrders: readonly { documentId: string; number: string; date: string; grandTotal: string }[];
}

export const linkInvoiceSchema = z.object({ voucherId: z.uuid() });
export type LinkInvoiceInput = z.infer<typeof linkInvoiceSchema>;

export const shortCloseSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
export type ShortCloseInput = z.infer<typeof shortCloseSchema>;

/** REQ-AC-04: available = Tally closing − committed, with the pull it rests on (REQ-AC-05). */
export interface StockAvailability {
  readonly stockItemId: string;
  readonly closingQty: string | null;
  readonly committedQty: string;
  readonly availableQty: string | null;
  readonly openPoQty: string;
  readonly reorderLevel: string | null;
  readonly minimumOrderQty: string | null;
  readonly asOf: string | null;
}


// ------------------------------------------------------------------ dispatch

export const DISPATCH_MODES = ['local_auto', 'local_own_vehicle', 'outstation'] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];
export const DISPATCH_MODE_LABELS: Record<DispatchMode, string> = {
  local_auto: 'Local — auto',
  local_own_vehicle: 'Local — own vehicle',
  outstation: 'Outstation',
};

/**
 * REQ-AA-16…AA-19: a dispatch is its own record with its own lines. Mode
 * decides which fields are required — the refinements below name each
 * missing one (12 §7). Photographs travel as multipart parts beside this
 * JSON and are checked in the service (REQ-AA-20).
 */
export const createDispatchSchema = z
  .object({
    mode: z.enum(DISPATCH_MODES),
    lines: z.array(z.object({ lineId: z.uuid(), quantity: z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/u, 'a quantity') })).min(1).max(200),
    lrNumber: z.string().trim().max(60).nullish(),
    transporterName: z.string().trim().max(120).nullish(),
    transporterContact: z.string().trim().max(60).nullish(),
    vehicleNumber: z.string().trim().max(30).nullish(),
    driverName: z.string().trim().max(120).nullish(),
    expectedDeliveryDate: z.iso.date().nullish(),
    notes: z.string().trim().max(2000).nullish(),
    /** REQ-AA-28: overrides for this dispatch's notification. */
    customerEmail: z.email().max(254).nullish(),
    customerWhatsapp: z.string().trim().min(6).max(24).nullish(),
  })
  .superRefine((d, ctx) => {
    const need = (field: keyof typeof d, label: string) => {
      const value = d[field];
      if (value === undefined || value === null || value === '') ctx.addIssue({ code: 'custom', path: [field], message: `${label} is required for ${DISPATCH_MODE_LABELS[d.mode]}` });
    };
    if (d.mode === 'local_own_vehicle') {
      need('vehicleNumber', 'Vehicle number');
      need('driverName', 'Driver name');
    }
    if (d.mode === 'outstation') {
      need('lrNumber', 'LR number');
      need('transporterName', 'Transporter name');
      need('transporterContact', 'Transporter contact');
    }
  });
export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;

export interface DispatchLineView {
  readonly lineId: string;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string | null;
}

export interface DispatchAttachmentView {
  readonly fileId: string;
  readonly kind: 'box' | 'lr';
}

export interface DispatchNotificationView {
  readonly id: string;
  readonly channel: 'email' | 'whatsapp';
  readonly recipient: string | null;
  /** `pending` until somebody sends it by hand (`manual`, REQ-AA-26); `sent`; `failed`. */
  readonly status: 'pending' | 'sent' | 'failed';
  readonly composedText: string;
  readonly sentAt: string | null;
  readonly error: string | null;
}

export interface DispatchView {
  readonly id: string;
  readonly number: string;
  readonly documentId: string;
  readonly orderNumber: string;
  readonly customerName: string;
  readonly mode: DispatchMode;
  readonly dispatchedById: string | null;
  readonly dispatchedByName: string | null;
  readonly dispatchedAt: string;
  readonly lrNumber: string | null;
  readonly transporterName: string | null;
  readonly transporterContact: string | null;
  readonly vehicleNumber: string | null;
  readonly driverName: string | null;
  readonly expectedDeliveryDate: string | null;
  readonly notes: string | null;
  readonly syncState: DocumentSyncState;
  readonly remoteGuid: string | null;
  readonly remoteVoucherNumber: string | null;
  readonly lastError: string | null;
  readonly lines: readonly DispatchLineView[];
  readonly attachments: readonly DispatchAttachmentView[];
  readonly notifications: readonly DispatchNotificationView[];
}

export const dispatchListQuerySchema = pageQuerySchema.extend({
  documentId: z.uuid().optional(),
  mode: z.enum(DISPATCH_MODES).optional(),
  syncState: z.enum(SYNC_STATES).optional(),
  q: z.string().trim().min(1).max(80).optional(),
});
export type DispatchListQuery = z.infer<typeof dispatchListQuerySchema>;

export const markNotificationSentSchema = z.object({ status: z.enum(['sent', 'failed']), error: z.string().trim().max(1000).nullish() });
export type MarkNotificationSentInput = z.infer<typeof markNotificationSentSchema>;


// ------------------------------------------------------------- invoices (D-38)

/**
 * A Vyuha-raised invoice against a sales order: the packed-and-uninvoiced
 * balance of the named lines (all of them when none is named), at the
 * order's rates. Confirming pushes it as a Sales voucher and advances the
 * order's invoiced quantities; the pulled-back voucher then attaches to
 * the same link rather than counting twice.
 */
export const createInvoiceSchema = z.object({
  date: z.iso.date().optional(),
  lines: z.array(z.object({ lineId: z.uuid(), quantity: z.string().trim().regex(/^\d{1,12}(\.\d{1,3})?$/u, 'a quantity') })).max(200).optional(),
  notes: z.string().trim().max(4000).nullish(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const invoiceListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(SALES_ORDER_STATUSES).optional(),
  syncState: z.enum(SYNC_STATES).optional(),
  partyId: z.uuid().optional(),
  sourceDocumentId: z.uuid().optional(),
  sort: z.string().max(200).optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
