import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { CreatePackRecordInput } from '@vyuha/shared';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';
import { parseOrThrow } from '@/lib/api/parse';

import { awaitingInvoiceEntrySchema, estimateSchema, packRecordSchema, packedListSchema, pickQueueEntrySchema, unlinkedInvoiceSchema, type AwaitingInvoiceEntry, type Estimate, type PackRecord, type PackedList, type PickQueueEntry, type UnlinkedInvoice } from './types';

/**
 * Pick, pack, and the billing handshake (12 §3.2, §3.3). Every mutation
 * invalidates ['sales'] because the quantities are the state (REQ-AA-01):
 * a pack moves an order out of the pick queue and into awaiting-invoice, a
 * link moves it out again, and every screen showing the order must agree.
 */

function useInvalidateSales(): () => Promise<void> {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['sales'] });
}

/** REQ-AA-06: oldest first, as the API sorts it (D-26: a shared queue). */
export function usePickQueue(options: { enabled?: boolean } = {}): UseQueryResult<PickQueueEntry[], Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['sales', 'pick-queue'],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/sales/pick-queue', { signal });
      return parseOrThrow(z.array(pickQueueEntrySchema), body, 'pick queue');
    },
    // A picker's phone sits on this screen all day; a minute is the most it should lag.
    refetchInterval: 60_000,
  });
}

/** REQ-AA-11/AA-15. Asking also runs the narration link, so a fresh voucher disappears from here on the next look. */
export function useAwaitingInvoice(options: { enabled?: boolean } = {}): UseQueryResult<AwaitingInvoiceEntry[], Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['sales', 'awaiting-invoice'],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/sales/awaiting-invoice', { signal });
      return parseOrThrow(z.array(awaitingInvoiceEntrySchema), body, 'awaiting-invoice queue');
    },
    refetchInterval: 60_000,
  });
}

/** REQ-AA-13. */
export function useUnlinkedInvoices(options: { enabled?: boolean } = {}): UseQueryResult<UnlinkedInvoice[], Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['sales', 'unlinked-invoices'],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/sales/invoices/unlinked', { signal });
      return parseOrThrow(z.array(unlinkedInvoiceSchema), body, 'unlinked invoices');
    },
    refetchInterval: 60_000,
  });
}

/** One pack record: the packing slip's page. */
/** D-47: the Packed screen — every pack across the orders this person may see, newest first. */
export function usePackedList(filters: { page: number; pageSize?: number; q?: string }): UseQueryResult<PackedList, Error> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize ?? 25) });
  if (filters.q) params.set('q', filters.q);
  const key = params.toString();
  return useQuery({
    queryKey: ['sales', 'packed', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/sales/packs?${key}`, { signal });
      return parseOrThrow(packedListSchema, body, 'packed list');
    },
    placeholderData: keepPreviousData,
  });
}

export function usePackRecord(id: string | null): UseQueryResult<PackRecord, Error> {
  return useQuery({
    enabled: id !== null,
    queryKey: ['sales', 'pack', id],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/sales/packs/${id ?? ''}`, { signal });
      return parseOrThrow(packRecordSchema, body, 'pack record');
    },
  });
}

/** REQ-AA-09/AA-31: every packing session against one order. */
export function usePackRecords(documentId: string | null): UseQueryResult<PackRecord[], Error> {
  return useQuery({
    enabled: documentId !== null,
    queryKey: ['sales', 'order', documentId, 'packs'],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/sales/orders/${documentId ?? ''}/packs`, { signal });
      return parseOrThrow(z.array(packRecordSchema), body, 'pack records');
    },
  });
}

/** REQ-AA-07/AA-08/AA-09: one packing session, lines within the balance. */
export function usePackOrder(): UseMutationResult<PackRecord, Error, { documentId: string; input: CreatePackRecordInput }> {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: async ({ documentId, input }) => {
      const response = await apiRequest<unknown>(`/sales/orders/${documentId}/packs`, { method: 'POST', body: input });
      return parseOrThrow(packRecordSchema, response, 'pack record');
    },
    onSuccess: invalidate,
  });
}

/** D-21, the manual half: a Sales voucher tied to the order by hand. */
export function useLinkInvoice(): UseMutationResult<Estimate, Error, { documentId: string; voucherId: string }> {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: async ({ documentId, voucherId }) => {
      const response = await apiRequest<unknown>(`/sales/orders/${documentId}/link-invoice`, { method: 'POST', body: { voucherId } });
      return parseOrThrow(estimateSchema, response, 'sales order');
    },
    onSuccess: invalidate,
  });
}

/** REQ-AA-05 / D-24: the balance written off, with a reason, by sales.document.alter. */
export function useShortCloseOrder(): UseMutationResult<Estimate, Error, { documentId: string; reason: string }> {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: async ({ documentId, reason }) => {
      const response = await apiRequest<unknown>(`/sales/orders/${documentId}/short-close`, { method: 'POST', body: { reason } });
      return parseOrThrow(estimateSchema, response, 'sales order');
    },
    onSuccess: invalidate,
  });
}
