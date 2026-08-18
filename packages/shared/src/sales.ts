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

export const SALES_DOCUMENT_TYPES = ['ESTIMATE'] as const;
export type SalesDocumentType = (typeof SALES_DOCUMENT_TYPES)[number];

export const SALES_DOCUMENT_TYPE_LABELS: Record<SalesDocumentType, string> = { ESTIMATE: 'Estimate' };
export const SALES_DOCUMENT_TYPE_PREFIX: Record<SalesDocumentType, string> = { ESTIMATE: 'EST' };

/** An estimate's life. Accepted is the state a sales order is raised from (REQ-W-03, later). */
export const ESTIMATE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
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
}

export interface EstimateView {
  readonly id: string;
  readonly docType: SalesDocumentType;
  readonly number: string;
  readonly status: EstimateStatus;
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
  readonly lines: readonly SalesLineView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The list row: the header without its lines. */
export type EstimateSummary = Omit<EstimateView, 'lines'>;

export const estimateListQuerySchema = pageQuerySchema.extend({
  /** Free text over number and customer name. */
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(ESTIMATE_STATUSES).optional(),
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
  readonly entries: readonly ItemHistoryEntry[];
  /** REQ-Y-07 in miniature: how fresh the voucher side is. */
  readonly vouchersAsOf: string | null;
}
