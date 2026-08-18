import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { parseOrThrow } from '@/lib/api/parse';
import { apiRequest } from '@/lib/api/client';

/**
 * `GET /masters/vouchers` and `/masters/vouchers/:id` (Phase 6c). Amounts
 * are strings end to end: Tally's figures, shown, never computed on (D-01).
 */

export const voucherSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  date: z.string(),
  voucherType: z.string(),
  voucherNumber: z.string(),
  partyName: z.string(),
  partyId: z.string().nullable(),
  narration: z.string(),
  isCancelled: z.boolean(),
  amount: z.string(),
  lastPulledAt: z.string(),
});

export type Voucher = z.infer<typeof voucherSchema>;

const voucherLineSchema = z.object({
  lineNo: z.number(),
  kind: z.enum(['ledger', 'inventory']),
  ledgerName: z.string().nullable(),
  isDeemedPositive: z.boolean().nullable(),
  stockItemName: z.string().nullable(),
  stockItemId: z.string().nullable(),
  actualQty: z.string().nullable(),
  billedQty: z.string().nullable(),
  rate: z.string().nullable(),
  amount: z.string(),
});

export type VoucherLine = z.infer<typeof voucherLineSchema>;

const voucherDetailSchema = voucherSchema.extend({ lines: z.array(voucherLineSchema) });

export type VoucherDetail = z.infer<typeof voucherDetailSchema>;

const vouchersResponseSchema = z.object({
  data: z.array(voucherSchema),
  meta: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
});

export type VouchersResponse = z.infer<typeof vouchersResponseSchema>;

export interface VoucherFilters {
  page: number;
  q?: string;
  voucherType?: string;
  partyId?: string;
  from?: string;
  to?: string;
  includeCancelled?: boolean;
}

export function useVouchers(
  filters: VoucherFilters,
  options: { enabled?: boolean } = {},
): UseQueryResult<VouchersResponse, Error> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: '25' });
  if (filters.q) params.set('q', filters.q);
  if (filters.voucherType) params.set('voucherType', filters.voucherType);
  if (filters.partyId) params.set('partyId', filters.partyId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.includeCancelled) params.set('includeCancelled', 'true');
  const key = params.toString();

  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['masters', 'vouchers', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/masters/vouchers?${key}`, { signal });
      return parseOrThrow(vouchersResponseSchema, body, 'voucher list');
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useVoucher(
  id: string | null,
  options: { enabled?: boolean } = {},
): UseQueryResult<VoucherDetail, Error> {
  return useQuery({
    enabled: (options.enabled ?? true) && id !== null,
    queryKey: ['masters', 'vouchers', 'detail', id],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/masters/vouchers/${id ?? ''}`, { signal });
      return parseOrThrow(voucherDetailSchema, body, 'voucher');
    },
    staleTime: 60_000,
  });
}
