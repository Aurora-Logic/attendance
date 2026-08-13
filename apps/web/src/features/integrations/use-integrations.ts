import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { isUnbuiltEndpoint, parseOrThrow, type Sampled } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

import { integrationsResponseSchema, type IntegrationsResponse } from './types';

/**
 * `GET /integrations` (technical design §14).
 *
 * Read only, and there is no mutation hook on purpose. Issuing or rotating an
 * agent token is a credential operation with no endpoint behind it yet, and a
 * button that appeared to mint a token without one would be worse than no
 * button.
 */
export function useIntegrations(
  options: { enabled?: boolean } = {},
): UseQueryResult<Sampled<IntegrationsResponse>, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['integrations', 'list'],
    queryFn: async ({ signal }) => {
      try {
        const body = await apiRequest<unknown>('/integrations', { signal });
        return {
          value: parseOrThrow(integrationsResponseSchema, body, 'integration list'),
          sample: false,
        };
      } catch (error) {
        if (isUnbuiltEndpoint(error)) {
          if (import.meta.env.DEV) {
            const module = await import('./sample');
            return { value: module.sampleIntegrations(), sample: true };
          }
        }
        throw error;
      }
    },
    // A heartbeat lands every few minutes; nothing here needs a live poll, and
    // the reader can refresh when they are actually watching for one.
    staleTime: 60_000,
  });
}
