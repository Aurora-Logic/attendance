import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ItemAnalytics, LifecycleAnalyticsQuery, PartyAnalytics } from '@vyuha/shared';

import { apiRequest } from '@/lib/api/client';

function search(query: LifecycleAnalyticsQuery): string {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.compareFrom !== undefined && query.compareTo !== undefined) {
    params.set('compareFrom', query.compareFrom);
    params.set('compareTo', query.compareTo);
  }
  return params.toString();
}

/** The period half of a lifecycle; the previous period's figures stay on screen while the next loads. */
export function useItemAnalytics(id: string | null, query: LifecycleAnalyticsQuery): UseQueryResult<ItemAnalytics, Error> {
  const key = search(query);
  return useQuery({
    enabled: id !== null,
    queryKey: ['masters', 'items', id ?? '', 'analytics', key],
    queryFn: ({ signal }) => apiRequest<ItemAnalytics>(`/masters/items/${id ?? ''}/analytics?${key}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function usePartyAnalytics(id: string | null, query: LifecycleAnalyticsQuery): UseQueryResult<PartyAnalytics, Error> {
  const key = search(query);
  return useQuery({
    enabled: id !== null,
    queryKey: ['masters', 'parties', id ?? '', 'analytics', key],
    queryFn: ({ signal }) => apiRequest<PartyAnalytics>(`/masters/parties/${id ?? ''}/analytics?${key}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
