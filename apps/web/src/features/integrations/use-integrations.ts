import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { parseOrThrow } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

import { integrationsResponseSchema, type IntegrationsResponse } from './types';

/**
 * `GET /integrations` (technical design §14).
 *
 * The sample-data fallback that stood here is gone, and its removal is the
 * point. There was no controller behind this path at all, so the screen showed
 * an invented Tally connection in development and an error in production — and
 * the invented one was the more dangerous of the two, because it looked like an
 * answer. The endpoint now exists and returns an empty list for an organisation
 * with no connections, which is the honest version of the same screen.
 *
 * Read only, and there is no mutation hook on purpose. Issuing or rotating an
 * agent token is a credential operation with no endpoint behind it yet, and a
 * button that appeared to mint a token without one would be worse than no
 * button.
 */
export function useIntegrations(
  options: { enabled?: boolean } = {},
): UseQueryResult<IntegrationsResponse, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['integrations', 'list'],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/integrations', { signal });
      return parseOrThrow(integrationsResponseSchema, body, 'integration list');
    },
    // A heartbeat lands every few minutes; nothing here needs a live poll, and
    // the reader can refresh when they are actually watching for one.
    staleTime: 60_000,
  });
}
