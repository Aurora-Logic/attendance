import { z } from 'zod';

import { ESTIMATE_STATUSES, SALES_ORDER_STATUSES, SYNC_STATES } from '@vyuha/shared';

/** What `/sales/estimates` answers (REQ-W-01), parsed at the boundary. */

export const salesLineSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  stockItemId: z.string().nullable(),
  description: z.string(),
  quantity: z.string(),
  unit: z.string().nullable(),
  rate: z.string(),
  discountPct: z.string(),
  taxPct: z.string(),
  amount: z.string(),
  taxAmount: z.string(),
});
export type SalesLine = z.infer<typeof salesLineSchema>;

const headerShape = {
  id: z.string(),
  docType: z.enum(['ESTIMATE', 'SALES_ORDER']),
  number: z.string(),
  status: z.enum([...ESTIMATE_STATUSES, ...SALES_ORDER_STATUSES]),
  date: z.string(),
  validUntil: z.string().nullable(),
  partyId: z.string().nullable(),
  companyId: z.string().nullable(),
  dealId: z.string().nullable(),
  customerName: z.string(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  subtotal: z.string(),
  discountTotal: z.string(),
  taxTotal: z.string(),
  grandTotal: z.string(),
  sourceDocumentId: z.string().nullable(),
  syncState: z.enum(SYNC_STATES),
  remoteGuid: z.string().nullable(),
  remoteVoucherNumber: z.string().nullable(),
  lastPushedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const estimateSummarySchema = z.object(headerShape);
export type EstimateSummary = z.infer<typeof estimateSummarySchema>;
export const estimateSchema = z.object({ ...headerShape, lines: z.array(salesLineSchema) });
export type Estimate = z.infer<typeof estimateSchema>;

export const estimatesResponseSchema = z.object({
  data: z.array(estimateSummarySchema),
  meta: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
});
export type EstimatesResponse = z.infer<typeof estimatesResponseSchema>;

export const itemHistorySchema = z.object({
  stockItemName: z.string(),
  currentSalePrice: z.string().nullable(),
  entries: z.array(
    z.object({
      source: z.enum(['voucher', 'estimate']),
      date: z.string(),
      reference: z.string(),
      quantity: z.string().nullable(),
      rate: z.string().nullable(),
      discountPct: z.string().nullable(),
      amount: z.string().nullable(),
      status: z.string().nullable(),
    }),
  ),
  vouchersAsOf: z.string().nullable(),
});
export type ItemHistory = z.infer<typeof itemHistorySchema>;

/** The editor's working copy of a line; strings as typed, validated on save. */
export interface LineDraft {
  key: string;
  stockItemId: string | null;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  discountPct: string;
  taxPct: string;
}

export interface EstimateDraft {
  id?: string;
  status: Estimate['status'];
  number: string | null;
  partyId: string | null;
  companyId: string | null;
  customerName: string;
  date: string;
  validUntil: string | null;
  dealId: string | null;
  ownerId: string | null;
  notes: string;
  terms: string;
  lines: LineDraft[];
}

let lineCounter = 0;
export function newLine(overrides: Partial<LineDraft> = {}): LineDraft {
  lineCounter += 1;
  return {
    key: `line-${String(lineCounter)}`,
    stockItemId: null,
    description: '',
    quantity: '1',
    unit: '',
    rate: '',
    discountPct: '0',
    taxPct: '0',
    ...overrides,
  };
}

export function emptyEstimateDraft(today: string, overrides: Partial<EstimateDraft> = {}): EstimateDraft {
  return {
    status: 'DRAFT',
    number: null,
    partyId: null,
    companyId: null,
    customerName: '',
    date: today,
    validUntil: null,
    dealId: null,
    ownerId: null,
    notes: '',
    terms: '',
    lines: [newLine()],
    ...overrides,
  };
}

export function estimateToDraft(estimate: Estimate): EstimateDraft {
  return {
    id: estimate.id,
    status: estimate.status,
    number: estimate.number,
    partyId: estimate.partyId,
    companyId: estimate.companyId,
    customerName: estimate.customerName,
    date: estimate.date,
    validUntil: estimate.validUntil,
    dealId: estimate.dealId,
    ownerId: estimate.ownerId,
    notes: estimate.notes ?? '',
    terms: estimate.terms ?? '',
    lines: estimate.lines.map((line) =>
      newLine({
        stockItemId: line.stockItemId,
        description: line.description,
        quantity: trimZeros(line.quantity),
        unit: line.unit ?? '',
        rate: trimZeros(line.rate),
        discountPct: trimZeros(line.discountPct),
        taxPct: trimZeros(line.taxPct),
      }),
    ),
  };
}

/** `4000.00` → `4000`, `4100.50` → `4100.5`: what a person would type. */
export function trimZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/u, '') : value;
}

/**
 * The editor's preview of a line while it is being typed. The server's SQL
 * is the authority and replaces this on save; this exists so a person does
 * not type blind. Same formula, rounded the same way (half up, two places).
 */
export function previewLine(line: LineDraft): { amount: number; tax: number } | null {
  const qty = Number(line.quantity);
  const rate = Number(line.rate);
  const disc = Number(line.discountPct || '0');
  const tax = Number(line.taxPct || '0');
  if (!Number.isFinite(qty) || !Number.isFinite(rate) || !Number.isFinite(disc) || !Number.isFinite(tax)) return null;
  if (line.quantity.trim() === '' || line.rate.trim() === '') return null;
  const amount = round2(qty * rate * (1 - disc / 100));
  return { amount, tax: round2(amount * (tax / 100)) };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
