import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError, apiRequest } from '@/lib/api/client';

import { leaveCalendarSchema, type LeaveCalendar } from './team-calendar';
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
