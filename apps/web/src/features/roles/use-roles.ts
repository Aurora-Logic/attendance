import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { isUnbuiltEndpoint, parseOrThrow, type Sampled } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

import { rolesResponseSchema, type RolesResponse } from './types';

/**
 * `GET /roles` (REQ-B-07).
 *
 * Read only. `POST/PATCH /roles` are listed in technical design §6 and are not
 * built, so this feature deliberately has no mutation hook: a save button whose
 * request has nowhere to go would be a control that fails on every press, and
 * the screen says so instead.
 */

export function useRoles(
  options: { enabled?: boolean } = {},
): UseQueryResult<Sampled<RolesResponse>, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['roles', 'list'],
    queryFn: async ({ signal }) => {
      try {
        const body = await apiRequest<unknown>('/roles', { signal });
        return { value: parseOrThrow(rolesResponseSchema, body, 'role list'), sample: false };
      } catch (error) {
        if (isUnbuiltEndpoint(error)) {
          if (import.meta.env.DEV) {
            const module = await import('./sample');
            return { value: module.sampleRoles(), sample: true };
          }
        }
        throw error;
      }
    },
    // A role edit takes effect on the next request, so this list is not
    // something the screen has to poll.
    staleTime: 5 * 60_000,
  });
}
