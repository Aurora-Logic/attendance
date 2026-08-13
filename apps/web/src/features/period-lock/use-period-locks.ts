import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { parseOrThrow } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

import { periodLocksResponseSchema, type PeriodLock, type PeriodLocksResponse } from './types';

/**
 * `GET/POST/DELETE /attendance/locks` (REQ-E-09).
 *
 * The development sample fallback that stood here while none of the three
 * existed is gone. Locking a month is the act that freezes payroll input, and a
 * screen that showed invented locks would be telling somebody a month was
 * closed when it was open — the single most damaging lie this application could
 * tell. An unreachable endpoint is now an error state, which is the truth.
 */

const LOCKS_QUERY_KEY = ['attendance', 'locks'] as const;

export function usePeriodLocks(
  options: { enabled?: boolean } = {},
): UseQueryResult<PeriodLocksResponse, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: LOCKS_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/attendance/locks', { signal });
      return parseOrThrow(periodLocksResponseSchema, body, 'period lock list');
    },
  });
}

export interface LockPeriodInput {
  year: number;
  month: number;
  /** Null is an org-wide lock, which is the only kind while there is one location. */
  locationId: string | null;
  reason: string;
}

export function useLockPeriod(): UseMutationResult<PeriodLock, Error, LockPeriodInput> {
  return useInvalidating((input: LockPeriodInput) =>
    apiRequest<PeriodLock>('/attendance/locks', { method: 'POST', body: input }),
  );
}

export interface UnlockPeriodInput {
  id: string;
  reason: string;
}

export function useUnlockPeriod(): UseMutationResult<PeriodLock, Error, UnlockPeriodInput> {
  return useInvalidating((input: UnlockPeriodInput) =>
    apiRequest<PeriodLock>(`/attendance/locks/${input.id}`, {
      method: 'DELETE',
      body: { reason: input.reason },
    }),
  );
}

/**
 * Both writes invalidate the same two caches.
 *
 * `['attendance']` covers the lock list and every muster and day detail below
 * it: a locked month refuses punches, leave, overrides and recomputes, so
 * anything derived that is already on screen is now answering a different
 * question from the one the server would answer.
 */
function useInvalidating<TInput>(
  mutationFn: (input: TInput) => Promise<PeriodLock>,
): UseMutationResult<PeriodLock, Error, TInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LOCKS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}
