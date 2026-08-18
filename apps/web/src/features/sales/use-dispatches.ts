import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { CreateDispatchInput, DispatchMode, DocumentSyncState } from '@vyuha/shared';

import { apiRequest } from '@/lib/api/client';
import { parseOrThrow } from '@/lib/api/parse';
import { postMultipart } from '@/lib/offline/multipart';

import { attachmentUrlSchema, dispatchSchema, dispatchesResponseSchema, type AttachmentUrl, type Dispatch, type DispatchesResponse } from './types';

/**
 * Dispatch (12 §3.4, §3.5). Creating one is the only multipart POST in the
 * sales module: the JSON rides as a `payload` field beside the `box` and
 * `lr` photographs (REQ-AA-20/AA-21), the same way a punch travels.
 */

export interface DispatchFilters {
  page: number;
  /** 25 for the board; the order sheet asks for its whole history at once (REQ-AA-31). */
  pageSize?: number;
  q?: string;
  documentId?: string;
  mode?: DispatchMode;
  syncState?: DocumentSyncState;
}

export function useDispatches(filters: DispatchFilters, options: { enabled?: boolean } = {}): UseQueryResult<DispatchesResponse, Error> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize ?? 25) });
  if (filters.q) params.set('q', filters.q);
  if (filters.documentId) params.set('documentId', filters.documentId);
  if (filters.mode) params.set('mode', filters.mode);
  if (filters.syncState) params.set('syncState', filters.syncState);
  const key = params.toString();
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['sales', 'dispatches', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/sales/dispatches?${key}`, { signal });
      return parseOrThrow(dispatchesResponseSchema, body, 'dispatch list');
    },
    placeholderData: keepPreviousData,
    // REQ-W-06: the Delivery Note's state is the agent's word; a minute is the most a queued badge should lie by.
    refetchInterval: 60_000,
  });
}

export function useDispatch(id: string | null): UseQueryResult<Dispatch, Error> {
  return useQuery({
    enabled: id !== null,
    queryKey: ['sales', 'dispatch', id],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/sales/dispatches/${id ?? ''}`, { signal });
      return parseOrThrow(dispatchSchema, body, 'dispatch');
    },
    refetchInterval: (query) => (query.state.data?.syncState === 'QUEUED' ? 10_000 : false),
  });
}

/** A signed URL for one photograph, minted when the sheet opens; it expires, so it is not cached for long. */
export function useAttachmentUrl(dispatchId: string | null, fileId: string | null): UseQueryResult<AttachmentUrl, Error> {
  return useQuery({
    enabled: dispatchId !== null && fileId !== null,
    queryKey: ['sales', 'dispatch', dispatchId, 'attachment', fileId],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/sales/dispatches/${dispatchId ?? ''}/attachments/${fileId ?? ''}/url`, { signal });
      return parseOrThrow(attachmentUrlSchema, body, 'attachment link');
    },
    staleTime: 60_000,
    gcTime: 60_000,
  });
}

function useInvalidateSales(): () => Promise<void> {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['sales'] });
}

export interface CreateDispatchArgs {
  documentId: string;
  input: CreateDispatchInput;
  /** REQ-AA-20: at least one of each for outstation; the service refuses otherwise. */
  box: readonly File[];
  lr: readonly File[];
}

/** REQ-AA-16…AA-22: one dispatch, its lines, its photographs, queued as a Delivery Note. */
export function useCreateDispatch(): UseMutationResult<Dispatch, Error, CreateDispatchArgs> {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: async ({ documentId, input, box, lr }) => {
      const form = new FormData();
      form.append('payload', JSON.stringify(input));
      for (const file of box) form.append('box', file, file.name);
      for (const file of lr) form.append('lr', file, file.name);
      return postMultipart(`/sales/orders/${documentId}/dispatches`, form, (body) => parseOrThrow(dispatchSchema, body, 'dispatch'));
    },
    onSuccess: invalidate,
  });
}

/** REQ-AA-26: the person sent it (or could not); the record says so. */
export function useMarkNotification(): UseMutationResult<Dispatch, Error, { dispatchId: string; notificationId: string; status: 'sent' | 'failed'; error?: string }> {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: async ({ dispatchId, notificationId, status, error }) => {
      const response = await apiRequest<unknown>(`/sales/dispatches/${dispatchId}/notifications/${notificationId}`, {
        method: 'POST',
        body: { status, ...(error === undefined ? {} : { error }) },
      });
      return parseOrThrow(dispatchSchema, response, 'dispatch');
    },
    onSuccess: invalidate,
  });
}

/** Push again after a rejection, or the first time when no agent could carry it. */
export function usePushDispatch(): UseMutationResult<Dispatch, Error, string> {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: async (dispatchId: string) => {
      const response = await apiRequest<unknown>(`/sales/dispatches/${dispatchId}/push`, { method: 'POST' });
      return parseOrThrow(dispatchSchema, response, 'dispatch');
    },
    onSuccess: invalidate,
  });
}
