import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import { compOffGrantSchema, type CompOffGrant } from '@vyuha/shared';

import { ApiError, apiRequest } from '@/lib/api/client';

import { leaveCalendarSchema, type LeaveCalendar } from './team-calendar';
import { compOffCreditSchema, type CompOffCredit } from './types';
import { LEAVE_QUERY_ROOT } from './use-leave';

/**
 * REQ-G-12: `GET /leave/calendar?from=&to=&departmentId=`.
 *
 * No development fixture fallback, deliberately. The other leave reads carry
 * one because they predate their endpoints; this screen exists only because
 * the endpoint does, and a manager deciding whether a third absence is safe
 * must never be shown invented people. An unreachable API is an error state
 * here, which is what the screen renders.
 *
 * The response is not paginated — the endpoint answers with the whole range,
 * and a month of a pilot-sized organisation is tens of rows.
 */

export interface LeaveCalendarParams {
  from: string;
  to: string;
  departmentId: string | null;
}

export function useLeaveCalendar(
  params: LeaveCalendarParams,
): UseQueryResult<LeaveCalendar, Error> {
  const search = new URLSearchParams({ from: params.from, to: params.to });
  if (params.departmentId !== null) search.set('departmentId', params.departmentId);

  return useQuery({
    queryKey: [...LEAVE_QUERY_ROOT, 'calendar', params],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/leave/calendar?${search.toString()}`, { signal });
      const parsed = leaveCalendarSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'The team leave calendar came back in a shape this screen cannot read.',
          status: 0,
          details: { issues: z.treeifyError(parsed.error) },
        });
      }
      return parsed.data;
    },
    // Stepping a month should redraw the grid in place rather than blank it,
    // which reads as the calendar breaking and coming back.
    placeholderData: keepPreviousData,
  });
}

/**
 * REQ-G-11: "HR or an approver grants comp-off credits against a specific
 * worked holiday/weekly-off date."
 *
 * The body is parsed with the same schema the server uses, so a field this
 * form forgets to send fails here rather than as a 400 the reader has to
 * interpret. No fixture fallback: a grant that "succeeded" against nothing
 * would put days into a balance the server never wrote.
 */
export function useGrantCompOff(): UseMutationResult<CompOffCredit, Error, CompOffGrant> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CompOffGrant) => {
      const body = compOffGrantSchema.parse(input);
      const response = await apiRequest<unknown>('/leave/comp-off', { method: 'POST', body });
      const parsed = compOffCreditSchema.safeParse(response);
      if (!parsed.success) {
        throw new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'The comp-off credit came back in a shape this screen cannot read.',
          status: 0,
          details: { issues: z.treeifyError(parsed.error) },
        });
      }
      return parsed.data;
    },
    onSuccess: () => {
      // A grant writes a ledger row and recomputes the balance, so the whole
      // leave tree is stale — including the employee's own balance band.
      void queryClient.invalidateQueries({ queryKey: LEAVE_QUERY_ROOT });
    },
  });
}
