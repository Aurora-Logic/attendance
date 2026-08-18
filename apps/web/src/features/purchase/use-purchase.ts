import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import {
  purchaseSettingsSchema,
  type AllocateReceiptInput,
  type CreateGrnInput,
  type CreatePurchaseOrderInput,
  type CreateRequirementInput,
  type DocumentSyncState,
  type PurchaseLineInput,
  type PurchaseOrderFromRequirementsInput,
  type PurchaseOrderStatus,
  type PurchaseSettings,
  type PutItemSettingsInput,
  type PutItemVendorsInput,
  type RequirementState,
  type UpdatePurchaseOrderInput,
} from '@vyuha/shared';

import { apiRequest } from '@/lib/api/client';
import { parseOrThrow } from '@/lib/api/parse';

import {
  closedSchema,
  grnListSchema,
  grnSchema,
  itemVendorListSchema,
  purchaseHistorySchema,
  purchaseOrderSchema,
  purchaseOrdersResponseSchema,
  requirementListSchema,
  requirementSchema,
  stockAvailabilitySchema,
  type Grn,
  type ItemVendor,
  type PurchaseHistoryEntry,
  type PurchaseOrder,
  type PurchaseOrderDraft,
  type PurchaseOrdersResponse,
  type Requirement,
  type StockAvailability,
} from './types';

/**
 * `/purchase/*` (13): the queue, purchase orders, GRNs and the item facts.
 * Every mutation invalidates `['sales']` as well as `['purchase']`: a receipt
 * returns a waiting sales order to the pick queue (REQ-X-25), and a
 * requirement raised or closed changes what an order is waiting on
 * (REQ-X-26).
 */

const blank = (value: string): string | null => (value.trim() === '' ? null : value.trim());

function useInvalidatePurchase(): () => Promise<void> {
  const client = useQueryClient();
  return async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ['purchase'] }), client.invalidateQueries({ queryKey: ['sales'] })]);
  };
}

// --------------------------------------------------------------- settings

/** REQ-X-16 / REQ-AA-15: the approval threshold and the invoice-waiting hours. Read by anyone who may see purchasing. */
export function usePurchaseSettings(options: { enabled?: boolean } = {}): UseQueryResult<PurchaseSettings, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['purchase', 'settings'],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/purchase/settings', { signal });
      return parseOrThrow(purchaseSettingsSchema, body, 'purchase settings');
    },
    staleTime: 5 * 60_000,
  });
}

/** Set by an approver; the threshold decides which POs wait in the inbox. */
export function useSavePurchaseSettings(): UseMutationResult<PurchaseSettings, Error, PurchaseSettings> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const response = await apiRequest<unknown>('/purchase/settings', { method: 'PUT', body: input });
      return parseOrThrow(purchaseSettingsSchema, response, 'purchase settings');
    },
    onSuccess: async (saved) => {
      client.setQueryData(['purchase', 'settings'], saved);
      // A moved threshold changes approvalRequired on every open PO.
      await client.invalidateQueries({ queryKey: ['purchase', 'order'] });
      await client.invalidateQueries({ queryKey: ['purchase', 'orders'] });
    },
  });
}

// ----------------------------------------------------------- requirements

export interface RequirementFilters {
  state?: RequirementState;
  stockItemId?: string;
  salesOrderId?: string;
}

export function useRequirements(filters: RequirementFilters, options: { enabled?: boolean } = {}): UseQueryResult<Requirement[], Error> {
  const params = new URLSearchParams();
  if (filters.state) params.set('state', filters.state);
  if (filters.stockItemId) params.set('stockItemId', filters.stockItemId);
  if (filters.salesOrderId) params.set('salesOrderId', filters.salesOrderId);
  const key = params.toString();
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['purchase', 'requirements', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/purchase/requirements${key ? `?${key}` : ''}`, { signal });
      return parseOrThrow(requirementListSchema, body, 'requirement list');
    },
    placeholderData: keepPreviousData,
  });
}

/** REQ-X-06 by hand: a manual requirement, for a need no shortage or reorder raised. */
export function useCreateRequirement(): UseMutationResult<Requirement, Error, CreateRequirementInput> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async (input) => {
      const response = await apiRequest<unknown>('/purchase/requirements', { method: 'POST', body: input });
      return parseOrThrow(requirementSchema, response, 'requirement');
    },
    onSuccess: invalidate,
  });
}

/** REQ-X-11: closed without a PO, with a reason. */
export function useCloseRequirement(): UseMutationResult<{ closed: boolean }, Error, { id: string; reason: string }> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async ({ id, reason }) => {
      const response = await apiRequest<unknown>(`/purchase/requirements/${id}/close`, { method: 'POST', body: { reason } });
      return parseOrThrow(closedSchema, response, 'requirement close');
    },
    onSuccess: invalidate,
  });
}

// -------------------------------------------------------- purchase orders

export interface PurchaseOrderFilters {
  page: number;
  q?: string;
  status?: PurchaseOrderStatus;
  syncState?: DocumentSyncState;
  partyId?: string;
  salesOrderId?: string;
}

export function usePurchaseOrders(filters: PurchaseOrderFilters, options: { enabled?: boolean } = {}): UseQueryResult<PurchaseOrdersResponse, Error> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: '25' });
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.syncState) params.set('syncState', filters.syncState);
  if (filters.partyId) params.set('partyId', filters.partyId);
  if (filters.salesOrderId) params.set('salesOrderId', filters.salesOrderId);
  const key = params.toString();
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['purchase', 'orders', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/purchase/orders?${key}`, { signal });
      return parseOrThrow(purchaseOrdersResponseSchema, body, 'purchase order list');
    },
    placeholderData: keepPreviousData,
    // REQ-X-17: the Tally state changes when the agent reports; a minute is
    // the most a queued badge should lie by.
    refetchInterval: 60_000,
  });
}

export function usePurchaseOrder(id: string | null): UseQueryResult<PurchaseOrder, Error> {
  return useQuery({
    enabled: id !== null,
    queryKey: ['purchase', 'order', id],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/purchase/orders/${id ?? ''}`, { signal });
      return parseOrThrow(purchaseOrderSchema, body, 'purchase order');
    },
    refetchInterval: (query) => (query.state.data?.syncState === 'QUEUED' ? 10_000 : false),
  });
}

/**
 * The editor's lines as the API takes them: a sales line plus the
 * requirements it takes up. A PO carries no discount, so it is sent as zero
 * whatever the shared editor's box says.
 */
function toLineInputs(draft: PurchaseOrderDraft): PurchaseLineInput[] {
  return draft.lines
    .filter((line) => line.stockItemId !== null || line.description.trim() !== '' || line.rate.trim() !== '')
    .map((line) => ({
      stockItemId: line.stockItemId,
      description: line.description.trim(),
      quantity: line.quantity.trim() === '' ? '1' : line.quantity.trim(),
      unit: blank(line.unit),
      rate: line.rate.trim() === '' ? '0' : line.rate.trim().replace(/,/gu, ''),
      discountPct: '0',
      taxPct: line.taxPct.trim() === '' ? '0' : line.taxPct.trim(),
      requirementIds: draft.lineRequirements[line.key] ?? [],
    }));
}

/** Create or edit a draft (REQ-X-13 standalone). */
export function useSavePurchaseOrder(): UseMutationResult<PurchaseOrder, Error, PurchaseOrderDraft> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async (draft) => {
      if (draft.partyId === null) throw new Error('A purchase order needs a vendor.');
      const body: CreatePurchaseOrderInput | UpdatePurchaseOrderInput = {
        partyId: draft.partyId,
        vendorEmail: blank(draft.vendorEmail),
        vendorWhatsapp: blank(draft.vendorWhatsapp),
        date: draft.date,
        expectedDate: draft.expectedDate,
        salesOrderId: draft.salesOrderId,
        notes: blank(draft.notes),
        lines: toLineInputs(draft),
      };
      const response = await apiRequest<unknown>(draft.id === undefined ? '/purchase/orders' : `/purchase/orders/${draft.id}`, {
        method: draft.id === undefined ? 'POST' : 'PATCH',
        body,
      });
      return parseOrThrow(purchaseOrderSchema, response, 'saved purchase order');
    },
    onSuccess: invalidate,
  });
}

/** REQ-X-13: selected requirements become one draft PO, one line per item. */
export function useCreatePurchaseOrderFromRequirements(): UseMutationResult<PurchaseOrder, Error, PurchaseOrderFromRequirementsInput> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async (input) => {
      const response = await apiRequest<unknown>('/purchase/orders/from-requirements', { method: 'POST', body: input });
      return parseOrThrow(purchaseOrderSchema, response, 'purchase order');
    },
    onSuccess: invalidate,
  });
}

export type PurchaseOrderAction = 'confirm' | 'approve' | 'push' | 'cancel';

/** Confirm, approve, push, cancel: one mutation, the action named. */
export function usePurchaseOrderAction(): UseMutationResult<PurchaseOrder, Error, { id: string; action: PurchaseOrderAction }> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async ({ id, action }) => {
      const response = await apiRequest<unknown>(`/purchase/orders/${id}/${action}`, { method: 'POST' });
      return parseOrThrow(purchaseOrderSchema, response, 'purchase order');
    },
    onSuccess: invalidate,
  });
}

/** REQ-X-18 / REQ-AA-26: the vendor's copy went out by hand; say so. */
export function useMarkPurchaseNotification(): UseMutationResult<PurchaseOrder, Error, { id: string; notificationId: string; status: 'sent' | 'failed'; error?: string | null }> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async ({ id, notificationId, status, error }) => {
      const response = await apiRequest<unknown>(`/purchase/orders/${id}/notifications/${notificationId}`, { method: 'POST', body: { status, error: error ?? null } });
      return parseOrThrow(purchaseOrderSchema, response, 'purchase order');
    },
    onSuccess: invalidate,
  });
}

/** REQ-X-23: the vendor will not supply the balance. */
export function useShortClosePurchaseOrder(): UseMutationResult<PurchaseOrder, Error, { id: string; reason: string }> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async ({ id, reason }) => {
      const response = await apiRequest<unknown>(`/purchase/orders/${id}/short-close`, { method: 'POST', body: { reason } });
      return parseOrThrow(purchaseOrderSchema, response, 'purchase order');
    },
    onSuccess: invalidate,
  });
}

// ------------------------------------------------------------------ GRNs

export function useGrns(filters: { purchaseOrderId?: string }, options: { enabled?: boolean } = {}): UseQueryResult<Grn[], Error> {
  const params = new URLSearchParams();
  if (filters.purchaseOrderId) params.set('purchaseOrderId', filters.purchaseOrderId);
  const key = params.toString();
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['purchase', 'grns', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/purchase/grns${key ? `?${key}` : ''}`, { signal });
      return parseOrThrow(grnListSchema, body, 'goods receipt list');
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useGrn(id: string | null): UseQueryResult<Grn, Error> {
  return useQuery({
    enabled: id !== null,
    queryKey: ['purchase', 'grn', id],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/purchase/grns/${id ?? ''}`, { signal });
      return parseOrThrow(grnSchema, body, 'goods receipt');
    },
    refetchInterval: (query) => (query.state.data?.syncState === 'QUEUED' ? 10_000 : false),
  });
}

/** REQ-X-19…X-22: receive against a confirmed PO; the answer may carry pending allocations (REQ-X-27). */
export function useReceiveGrn(): UseMutationResult<Grn, Error, { purchaseOrderId: string; input: CreateGrnInput }> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async ({ purchaseOrderId, input }) => {
      const response = await apiRequest<unknown>(`/purchase/orders/${purchaseOrderId}/grns`, { method: 'POST', body: input });
      return parseOrThrow(grnSchema, response, 'goods receipt');
    },
    onSuccess: invalidate,
  });
}

/** REQ-X-27 / D-30: who gets an insufficient receipt, decided by a holder of the approve key. */
export function useAllocateReceipt(): UseMutationResult<Grn, Error, { grnId: string; input: AllocateReceiptInput }> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async ({ grnId, input }) => {
      const response = await apiRequest<unknown>(`/purchase/grns/${grnId}/allocate`, { method: 'POST', body: input });
      return parseOrThrow(grnSchema, response, 'goods receipt');
    },
    onSuccess: invalidate,
  });
}

// ------------------------------------------------------------ item facts

export function useItemVendors(stockItemId: string | null): UseQueryResult<ItemVendor[], Error> {
  return useQuery({
    enabled: stockItemId !== null,
    queryKey: ['purchase', 'item-vendors', stockItemId],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/purchase/items/${stockItemId ?? ''}/vendors`, { signal });
      return parseOrThrow(itemVendorListSchema, body, 'item vendors');
    },
  });
}

/** D-27: the whole set replaces the old. */
export function usePutItemVendors(): UseMutationResult<ItemVendor[], Error, { stockItemId: string; input: PutItemVendorsInput }> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async ({ stockItemId, input }) => {
      const response = await apiRequest<unknown>(`/purchase/items/${stockItemId}/vendors`, { method: 'PUT', body: input });
      return parseOrThrow(itemVendorListSchema, response, 'item vendors');
    },
    onSuccess: invalidate,
  });
}

/** D-28: reorder level and minimum order quantity; answers the refreshed availability. */
export function usePutItemSettings(): UseMutationResult<StockAvailability, Error, { stockItemId: string; input: PutItemSettingsInput }> {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: async ({ stockItemId, input }) => {
      const response = await apiRequest<unknown>(`/purchase/items/${stockItemId}/settings`, { method: 'PUT', body: input });
      return parseOrThrow(stockAvailabilitySchema, response, 'stock availability');
    },
    onSuccess: invalidate,
  });
}

/** REQ-AC-04/AC-05, REQ-X-24: closing, committed, available and on order, with the pull it rests on. */
export function useItemAvailability(stockItemId: string | null): UseQueryResult<StockAvailability, Error> {
  return useQuery({
    enabled: stockItemId !== null,
    queryKey: ['purchase', 'availability', stockItemId],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/purchase/items/${stockItemId ?? ''}/availability`, { signal });
      return parseOrThrow(stockAvailabilitySchema, body, 'stock availability');
    },
    staleTime: 30_000,
  });
}

/** REQ-X-14: what this vendor charged for this item before. Asked when opened, not on every keystroke. */
export function usePurchaseHistory(input: { stockItemId: string | null; partyId: string | null; enabled: boolean }): UseQueryResult<PurchaseHistoryEntry[], Error> {
  const params = new URLSearchParams({ stockItemId: input.stockItemId ?? '' });
  if (input.partyId) params.set('partyId', input.partyId);
  const key = params.toString();
  return useQuery({
    enabled: input.enabled && input.stockItemId !== null,
    queryKey: ['purchase', 'item-history', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/purchase/item-history?${key}`, { signal });
      return parseOrThrow(purchaseHistorySchema, body, 'purchase history');
    },
    staleTime: 60_000,
  });
}
