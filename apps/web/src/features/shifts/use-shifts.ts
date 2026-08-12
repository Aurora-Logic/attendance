import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  isUnbuiltEndpoint,
  loadSamples,
  parseOrThrow,
  type Sampled,
} from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';
import type { Paginated } from '@vyuha/shared';

import {
  rostersResponseSchema,
  shiftSchema,
  shiftsResponseSchema,
  type RosterEntry,
  type Shift,
} from './types';

/**
 * `GET /shifts` and `GET /rosters` (REQ-C-01, REQ-C-04).
 *
 * The sample fallback is imported from the attendance feature rather than
 * duplicated: shifts, rosters and attendance days are one module, and there is
 * one place to delete when the endpoints land.
 */

export function useShifts(): UseQueryResult<Sampled<Paginated<Shift>>, Error> {
  return useQuery({
    queryKey: ['shifts', 'list'],
    queryFn: async ({ signal }) => {
      try {
        const body = await apiRequest<unknown>('/shifts?pageSize=200', { signal });
        return { value: parseOrThrow(shiftsResponseSchema, body, 'shift list'), sample: false };
      } catch (error) {
        if (isUnbuiltEndpoint(error)) {
          const samples = await loadSamples();
          if (samples) return { value: samples.sampleShifts(), sample: true };
        }
        throw error;
      }
    },
  });
}

export interface RosterParams {
  from: string;
  to: string;
  departmentId?: string | null;
  q?: string;
  page: number;
  pageSize: number;
}

function toSearch(params: RosterParams): string {
  const search = new URLSearchParams();
  search.set('from', params.from);
  search.set('to', params.to);
  if (params.departmentId) search.set('departmentId', params.departmentId);
  if (params.q) search.set('q', params.q);
  search.set('page', String(params.page));
  search.set('pageSize', String(params.pageSize));
  return search.toString();
}

export function useRoster(
  params: RosterParams,
): UseQueryResult<Sampled<Paginated<RosterEntry>>, Error> {
  return useQuery({
    queryKey: ['rosters', 'list', params],
    queryFn: async ({ signal }) => {
      try {
        const body = await apiRequest<unknown>(`/rosters?${toSearch(params)}`, { signal });
        return { value: parseOrThrow(rostersResponseSchema, body, 'roster'), sample: false };
      } catch (error) {
        if (isUnbuiltEndpoint(error)) {
          const samples = await loadSamples();
          if (samples) return { value: samples.sampleRoster(params), sample: true };
        }
        throw error;
      }
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * `PATCH /shifts/:id` (REQ-C-01), the write side.
 *
 * Deliberately has no sample fallback. Reads may be invented and labelled;
 * a write may not. Pretending a shift policy was saved when no server heard
 * about it is exactly the lie the sample notice exists to prevent, so a failed
 * save reports the failure and the sheet stays open with the edits intact.
 */
export function useSaveShift(): UseMutationResult<Shift, Error, Shift> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shift: Shift) => {
      const body = await apiRequest<unknown>(`/shifts/${shift.id}`, {
        method: 'PATCH',
        body: {
          name: shift.name,
          code: shift.code,
          scheduledIn: shift.scheduledIn,
          scheduledOut: shift.scheduledOut,
          breakMinutes: shift.breakMinutes,
          crossesMidnight: shift.crossesMidnight,
          policy: shift.policy,
        },
      });
      return parseOrThrow(shiftSchema, body, 'saved shift');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      // A shift's window and thresholds decide every derived day, so a changed
      // policy makes every attendance day on screen stale (REQ-C-06).
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}
