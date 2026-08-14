import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import type { RestrictedHolidayResult } from '@vyuha/shared';

import { ApiError, apiRequest } from '@/lib/api/client';

import {
  restrictedHolidayPoolSchema,
  restrictedHolidayResultSchema,
  type RestrictedHolidayPool,
} from './restricted-holidays';

/**
 * REQ-H-03 at `/api/v1/restricted-holidays`.
 *
 * No development fixture fallback on any of the three, reads included. The
 * other holiday reads carry one because they predate their endpoints; this one
 * decides whether somebody gets a day off, and an invented pool would let a
 * person "take" a festival the server has never heard of.
 *
 * Election and withdrawal both answer with the whole pool rather than the row
 * that moved, because the allowance moved too — so the cache is replaced from
 * the response instead of being invalidated and refetched, which would leave
 * the allowance stale for a round trip on the one control it gates.
 */

const POOL_KEY = 'restricted-holidays';

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new ApiError({
    code: 'INTERNAL_ERROR',
    message: `The ${what} came back in a shape this screen cannot read.`,
    status: 0,
    details: { issues: z.treeifyError(parsed.error) },
  });
}

export function useRestrictedHolidayPool(options: {
  /** Omitted asks for the caller's own pool, which is what an employee wants. */
  employeeId?: string | null;
  enabled?: boolean;
}): UseQueryResult<RestrictedHolidayPool, Error> {
  const search = new URLSearchParams();
  if (options.employeeId) search.set('employeeId', options.employeeId);
  const suffix = search.size > 0 ? `?${search.toString()}` : '';

  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: [POOL_KEY, options.employeeId ?? 'self'],
    queryFn: async ({ signal }) =>
      parseOrThrow(
        restrictedHolidayPoolSchema,
        await apiRequest<unknown>(`/restricted-holidays${suffix}`, { signal }),
        'restricted holiday pool',
      ),
  });
}

export interface ElectionRequest {
  holidayId: string;
  /** Naming somebody else needs holiday.manage; the server decides that. */
  employeeId?: string | null;
  action: 'ELECT' | 'WITHDRAW';
}

export function useElectRestrictedHoliday(): UseMutationResult<
  RestrictedHolidayResult,
  Error,
  ElectionRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: ElectionRequest) => {
      const search = new URLSearchParams();
      if (request.employeeId) search.set('employeeId', request.employeeId);
      const suffix = search.size > 0 ? `?${search.toString()}` : '';

      const response =
        request.action === 'ELECT'
          ? await apiRequest<unknown>('/restricted-holidays', {
              method: 'POST',
              body: request.employeeId
                ? { holidayId: request.holidayId, employeeId: request.employeeId }
                : { holidayId: request.holidayId },
            })
          : await apiRequest<unknown>(`/restricted-holidays/${request.holidayId}${suffix}`, {
              method: 'DELETE',
            });

      return parseOrThrow(restrictedHolidayResultSchema, response, 'restricted holiday election');
    },
    onSuccess: (result, request) => {
      queryClient.setQueryData([POOL_KEY, request.employeeId ?? 'self'], result.pool);
      // The server recomputed that one attendance day inline (REQ-H-03 marks
      // it HOLIDAY for this employee only), so a muster or My Attendance left
      // open beside this is stale and nothing else would say so.
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}
