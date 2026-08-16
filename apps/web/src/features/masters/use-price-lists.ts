import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { parseOrThrow } from '@/lib/api/parse';
import { apiRequest } from '@/lib/api/client';

/** `GET /masters/price-lists` (REQ-R-03). Rates are strings: shown, not summed. */

export const priceListEntrySchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  stockItemName: z.string(),
  priceLevel: z.string(),
  rate: z.string(),
  unit: z.string().nullable(),
  lastPulledAt: z.string(),
});

export type PriceListEntry = z.infer<typeof priceListEntrySchema>;

const priceListsResponseSchema = z.object({
  data: z.array(priceListEntrySchema),
  meta: z.object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
  }),
});

export type PriceListsResponse = z.infer<typeof priceListsResponseSchema>;

export interface PriceListFilters {
  page: number;
  q?: string;
  priceLevel?: string;
}

export function usePriceLists(
  filters: PriceListFilters,
  options: { enabled?: boolean } = {},
): UseQueryResult<PriceListsResponse, Error> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: '25' });
  if (filters.q) params.set('q', filters.q);
  if (filters.priceLevel) params.set('priceLevel', filters.priceLevel);
  const key = params.toString();

  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['masters', 'price-lists', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/masters/price-lists?${key}`, { signal });
      return parseOrThrow(priceListsResponseSchema, body, 'price list');
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
