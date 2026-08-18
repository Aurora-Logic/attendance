import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { CreateEstimateInput, EstimateStatus, SalesLineInput, UpdateEstimateInput } from '@vyuha/shared';

import { apiRequest } from '@/lib/api/client';
import { parseOrThrow } from '@/lib/api/parse';

import { estimateSchema, estimatesResponseSchema, itemHistorySchema, type Estimate, type EstimateDraft, type EstimatesResponse, type ItemHistory } from './types';

export interface EstimateFilters {
  page: number;
  q?: string;
  status?: EstimateStatus;
  dealId?: string;
  companyId?: string;
  partyId?: string;
}

export function useEstimates(filters: EstimateFilters, options: { enabled?: boolean } = {}): UseQueryResult<EstimatesResponse, Error> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: '25' });
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.dealId) params.set('dealId', filters.dealId);
  if (filters.companyId) params.set('companyId', filters.companyId);
  if (filters.partyId) params.set('partyId', filters.partyId);
  const key = params.toString();
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['sales', 'estimates', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/sales/estimates?${key}`, { signal });
      return parseOrThrow(estimatesResponseSchema, body, 'estimate list');
    },
    placeholderData: keepPreviousData,
  });
}

export function useEstimate(id: string | null): UseQueryResult<Estimate, Error> {
  return useQuery({
    enabled: id !== null,
    queryKey: ['sales', 'estimate', id],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/sales/estimates/${id ?? ''}`, { signal });
      return parseOrThrow(estimateSchema, body, 'estimate');
    },
  });
}

/** REQ-W-02, asked when the affordance opens, not on every keystroke. */
export function useItemHistory(input: { stockItemId: string | null; partyId: string | null; companyId: string | null; enabled: boolean }): UseQueryResult<ItemHistory, Error> {
  const params = new URLSearchParams({ stockItemId: input.stockItemId ?? '' });
  if (input.partyId) params.set('partyId', input.partyId);
  if (input.companyId) params.set('companyId', input.companyId);
  const key = params.toString();
  return useQuery({
    enabled: input.enabled && input.stockItemId !== null,
    queryKey: ['sales', 'item-history', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/sales/item-history?${key}`, { signal });
      return parseOrThrow(itemHistorySchema, body, 'item history');
    },
    staleTime: 60_000,
  });
}

function useInvalidateSales(): () => Promise<void> {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['sales'] });
}

const blank = (value: string): string | null => (value.trim() === '' ? null : value.trim());

function toLineInputs(draft: EstimateDraft): SalesLineInput[] {
  return draft.lines
    .filter((line) => line.stockItemId !== null || line.description.trim() !== '' || line.rate.trim() !== '')
    .map((line) => ({
      stockItemId: line.stockItemId,
      description: line.description.trim(),
      quantity: line.quantity.trim() === '' ? '1' : line.quantity.trim(),
      unit: blank(line.unit),
      rate: line.rate.trim() === '' ? '0' : line.rate.trim().replace(/,/gu, ''),
      discountPct: line.discountPct.trim() === '' ? '0' : line.discountPct.trim(),
      taxPct: line.taxPct.trim() === '' ? '0' : line.taxPct.trim(),
    }));
}

export function useSaveEstimate(): UseMutationResult<Estimate, Error, EstimateDraft> {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: async (draft: EstimateDraft) => {
      const common = {
        partyId: draft.partyId,
        companyId: draft.companyId,
        date: draft.date,
        validUntil: draft.validUntil,
        dealId: draft.dealId,
        ownerId: draft.ownerId,
        notes: blank(draft.notes),
        terms: blank(draft.terms),
        lines: toLineInputs(draft),
      };
      const body: CreateEstimateInput | UpdateEstimateInput =
        draft.id === undefined
          ? { ...common, customerName: blank(draft.customerName) }
          : { ...common, ...(draft.customerName.trim() === '' ? {} : { customerName: draft.customerName.trim() }) };
      const response = await apiRequest<unknown>(draft.id === undefined ? '/sales/estimates' : `/sales/estimates/${draft.id}`, {
        method: draft.id === undefined ? 'POST' : 'PATCH',
        body,
      });
      return parseOrThrow(estimateSchema, response, 'saved estimate');
    },
    onSuccess: invalidate,
  });
}

export function useSetEstimateStatus(): UseMutationResult<Estimate, Error, { id: string; status: EstimateStatus }> {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: async ({ id, status }) => {
      const response = await apiRequest<unknown>(`/sales/estimates/${id}/status`, { method: 'POST', body: { status } });
      return parseOrThrow(estimateSchema, response, 'estimate');
    },
    onSuccess: invalidate,
  });
}

export function useDeleteEstimate(): UseMutationResult<void, Error, string> {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest<void>(`/sales/estimates/${id}`, { method: 'DELETE' });
    },
    onSuccess: invalidate,
  });
}
