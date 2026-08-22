import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ItemLifecycle, PartyLifecycle, StockItemView } from '@vyuha/shared';

import { apiRequest } from '@/lib/api/client';

/** Owner, 22 Aug 2026: the life of one item or one party, read from everything that touched it. */
export function useItemLifecycle(id: string | null): UseQueryResult<ItemLifecycle, Error> {
  return useQuery({
    enabled: id !== null,
    queryKey: ['masters', 'items', id ?? '', 'lifecycle'],
    queryFn: ({ signal }) => apiRequest<ItemLifecycle>(`/masters/items/${id ?? ''}/lifecycle`, { signal }),
    staleTime: 30_000,
  });
}

export function usePartyLifecycle(id: string | null): UseQueryResult<PartyLifecycle, Error> {
  return useQuery({
    enabled: id !== null,
    queryKey: ['masters', 'parties', id ?? '', 'lifecycle'],
    queryFn: ({ signal }) => apiRequest<PartyLifecycle>(`/masters/parties/${id ?? ''}/lifecycle`, { signal }),
    staleTime: 30_000,
  });
}

export function useStockItem(id: string | null): UseQueryResult<StockItemView, Error> {
  return useQuery({
    enabled: id !== null,
    queryKey: ['masters', 'items', id ?? ''],
    queryFn: ({ signal }) => apiRequest<StockItemView>(`/masters/items/${id ?? ''}`, { signal }),
    staleTime: 30_000,
  });
}
