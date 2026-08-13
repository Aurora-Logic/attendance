import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { isUnbuiltEndpoint, parseOrThrow } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

import {
  auditFacetsSchema,
  auditPageSchema,
  type AuditFacets,
  type AuditFilters,
  type AuditPage,
} from './types';

/**
 * `GET /audit-logs` (REQ-M-02), cursor-paged.
 *
 * `useInfiniteQuery` rather than a page number, because the endpoint is keyset
 * paged and for the reason it is: the trail grows while it is being read, so an
 * offset page two repeats rows that page one already showed every time a
 * request is audited in between.
 */

/** Each page carries whether it came from the sample set, so the notice can render. */
export interface SampledPage {
  value: AuditPage;
  sample: boolean;
}

function toSearch(filters: AuditFilters, cursor: string | null): string {
  const search = new URLSearchParams();
  if (filters.action) search.set('action', filters.action);
  if (filters.entityType) search.set('entityType', filters.entityType);
  // The filter is a date; the endpoint takes an instant. Widening to the whole
  // day here rather than server-side keeps "from 12 August" meaning the same
  // thing as the calendar the reader clicked.
  if (filters.from) search.set('from', `${filters.from}T00:00:00.000Z`);
  if (filters.to) search.set('to', `${filters.to}T23:59:59.999Z`);
  if (cursor) search.set('cursor', cursor);
  search.set('limit', '50');
  return search.toString();
}

export function useAuditLog(
  filters: AuditFilters,
  options: { enabled?: boolean } = {},
): UseInfiniteQueryResult<{ pages: SampledPage[]; pageParams: (string | null)[] }, Error> {
  return useInfiniteQuery({
    enabled: options.enabled ?? true,
    queryKey: ['audit-logs', filters],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      try {
        const body = await apiRequest<unknown>(`/audit-logs?${toSearch(filters, pageParam)}`, {
          signal,
        });
        return { value: parseOrThrow(auditPageSchema, body, 'audit log'), sample: false };
      } catch (error) {
        if (isUnbuiltEndpoint(error)) {
          if (import.meta.env.DEV) {
            const module = await import('./sample');
            return { value: module.sampleAuditPage(), sample: true };
          }
        }
        throw error;
      }
    },
    getNextPageParam: (last: SampledPage) => last.value.meta.nextCursor,
    // The trail is append-only and the reader is usually looking at a specific
    // moment, so re-fetching it under them is disruptive rather than helpful.
    staleTime: 30_000,
  });
}

export function useAuditFacets(
  options: { enabled?: boolean } = {},
): UseQueryResult<AuditFacets, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['audit-logs', 'facets'],
    queryFn: async ({ signal }) => {
      try {
        const body = await apiRequest<unknown>('/audit-logs/facets', { signal });
        return parseOrThrow(auditFacetsSchema, body, 'audit filters');
      } catch (error) {
        if (isUnbuiltEndpoint(error)) {
          if (import.meta.env.DEV) {
            const module = await import('./sample');
            return module.sampleAuditFacets();
          }
        }
        // A failed facet query must not take the trail with it: no options
        // simply means the two dropdowns are not offered.
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}
