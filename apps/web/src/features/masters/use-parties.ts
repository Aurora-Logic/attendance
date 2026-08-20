import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { parseOrThrow } from '@/lib/api/parse';
import { apiRequest } from '@/lib/api/client';

/**
 * `GET /masters/parties` (REQ-R-01), the projection as the screen reads it.
 * Money fields stay strings end to end: they are Tally's figures, shown,
 * never computed on (D-01).
 */

export const partySchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  name: z.string(),
  alias: z.string().nullable(),
  parentGroup: z.string(),
  gstin: z.string().nullable(),
  address: z.string().nullable(),
  creditLimit: z.string().nullable(),
  creditDays: z.number().nullable(),
  openingBalance: z.string().nullable(),
  absentInTally: z.boolean(),
  lastPulledAt: z.string(),
});

export type Party = z.infer<typeof partySchema>;

const partiesResponseSchema = z.object({
  data: z.array(partySchema),
  // The shared envelope exactly: it carries no totalPages, and a schema that
  // demanded one refused every real answer this API sends. Pages are derived
  // where they are rendered.
  meta: z.object({
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
  }),
});

export type PartiesResponse = z.infer<typeof partiesResponseSchema>;

export interface PartiesFilters {
  page: number;
  q?: string;
  parentGroup?: string;
}

export function useParties(
  filters: PartiesFilters,
  options: { enabled?: boolean } = {},
): UseQueryResult<PartiesResponse, Error> {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: '25' });
  if (filters.q) params.set('q', filters.q);
  if (filters.parentGroup) params.set('parentGroup', filters.parentGroup);
  const key = params.toString();

  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['masters', 'parties', key],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/masters/parties?${key}`, { signal });
      return parseOrThrow(partiesResponseSchema, body, 'party list');
    },
    placeholderData: keepPreviousData,
    // The projection changes when a pull lands, minutes apart at most
    // (REQ-R-07); a fresh page navigation re-reads regardless.
    staleTime: 60_000,
  });
}

/** One party, for a page that prints its address and GSTIN under the buyer's name. */
export function useParty(id: string | null): UseQueryResult<Party, Error> {
  return useQuery({
    enabled: id !== null,
    queryKey: ['masters', 'party', id],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/masters/parties/${id ?? ''}`, { signal });
      return parseOrThrow(partySchema, body, 'party');
    },
    staleTime: 60_000,
  });
}
