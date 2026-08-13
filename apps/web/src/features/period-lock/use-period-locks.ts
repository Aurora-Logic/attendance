import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { isUnbuiltEndpoint, parseOrThrow, type Sampled } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

import { periodLocksResponseSchema, type PeriodLocksResponse } from './types';

/**
 * `GET/POST/DELETE /attendance/locks` (REQ-E-09).
 *
 * None of the three is deployed. The read falls back to a sample set in
 * development and says so; the two writes do not fall back and never will.
 * Locking a month is the act that freezes payroll input -- a screen that
 * reported success without a server having heard about it would be the single
 * most damaging lie this application could tell.
 */

const LOCKS_QUERY_KEY = ['attendance', 'locks'] as const;

export function usePeriodLocks(
  options: { enabled?: boolean } = {},
): UseQueryResult<Sampled<PeriodLocksResponse>, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: LOCKS_QUERY_KEY,
    queryFn: async ({ signal }) => {
      try {
        const body = await apiRequest<unknown>('/attendance/locks', { signal });
        return {
          value: parseOrThrow(periodLocksResponseSchema, body, 'period lock list'),
          sample: false,
        };
      } catch (error) {
        if (isUnbuiltEndpoint(error)) {
          if (import.meta.env.DEV) {
            const module = await import('./sample');
            return { value: module.samplePeriodLocks(), sample: true };
          }
        }
        throw error;
      }
    },
  });
}

export interface LockPeriodInput {
  year: number;
  month: number;
  /** Null is an org-wide lock, which is the only kind while there is one location. */
  locationId: string | null;
}

export function useLockPeriod(): UseMutationResult<unknown, Error, LockPeriodInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LockPeriodInput) =>
      apiRequest<unknown>('/attendance/locks', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LOCKS_QUERY_KEY });
      // A locked month refuses punches, leave, overrides and recomputes, so
      // everything derived that is already on screen is now wrong.
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

export interface UnlockPeriodInput {
  id: string;
  reason: string;
}

export function useUnlockPeriod(): UseMutationResult<unknown, Error, UnlockPeriodInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UnlockPeriodInput) =>
      apiRequest<unknown>(`/attendance/locks/${input.id}`, {
        method: 'DELETE',
        body: { reason: input.reason },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LOCKS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}
