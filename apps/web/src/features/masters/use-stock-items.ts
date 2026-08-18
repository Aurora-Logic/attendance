import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { parseOrThrow } from '@/lib/api/parse';
import { apiRequest } from '@/lib/api/client';

/**
 * `GET /masters/items` (REQ-R-02). The GST rate stays a string end to end:
 * Tally's figure, shown, never computed on (D-01).
 */

export const stockItemSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  name: z.string(),
  alias: z.string().nullable(),
  unit: z.string(),
  parentGroup: z.string(),
  gstRate: z.string().nullable(),
  absentInTally: z.boolean(),
  lastPulledAt: z.string(),
});

export type StockItem = z.infer<typeof stockItemSchema>;

const stockItemsResponseSchema = z.object({
  data: z.array(stockItemSchema),
  meta: z.object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
  }),
});

export type StockItemsResponse = z.infer<typeof stockItemsResponseSchema>;

export interface StockItemFilters {
  page: number;
  q?: string;
  parentGroup?: string;
}

export function useStockItems(
  filters: StockItemFilters,
  options: { enabled?: boolean } = {},
): UseQueryResult<StockItemsResponse, Error> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: '25' });
  if (filters.q) params.set('q', filters.q);
  if (filters.parentGroup) params.set('parentGroup', filters.parentGroup);
  const key = params.toString();

  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['masters', 'stock-items', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/masters/items?${key}`, { signal });
      return parseOrThrow(stockItemsResponseSchema, body, 'stock item list');
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
