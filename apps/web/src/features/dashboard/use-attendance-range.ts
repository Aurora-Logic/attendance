import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { MAX_PAGE_SIZE } from '@vyuha/shared';

import { isUnbuiltEndpoint, loadSamples, parseOrThrow, type Sampled } from '@/features/attendance/api';
import { attendanceDaysResponseSchema, type AttendanceDay } from '@/features/attendance/types';
import { apiRequest } from '@/lib/api/client';

/**
 * Every attendance day in a date range, across as many pages as it takes.
 *
 * `useAttendanceDays` reads one page, which is right for a table and wrong for
 * a chart: thirty days of a two-hundred-person site is six thousand rows, and
 * a chart drawn from the first two hundred of them would show a full first
 * week and an empty third — a lie that looks exactly like an attendance
 * collapse. There is no aggregate endpoint yet (technical design §6 has the
 * list only), so the aggregation happens here, over complete data or not at
 * all.
 *
 * `complete` is the honesty valve. Past `MAX_PAGES` the hook stops asking and
 * says so, and the screen prints that the period is partial rather than
 * drawing the part it managed to fetch as though it were the whole.
 */

/** 12 x 200 rows. Beyond this a dashboard needs a server-side summary, not more requests. */
const MAX_PAGES = 12;

export interface AttendanceRangeParams {
  from: string;
  to: string;
  /** One person's days. Omitted, the server's scope predicate decides. */
  employeeId?: string | null;
}

export interface AttendanceRange {
  days: AttendanceDay[];
  /** What the server said exists, which is not always what was fetched. */
  total: number;
  complete: boolean;
}

interface AttendanceRangeOptions {
  enabled?: boolean;
}

function toSearch(params: AttendanceRangeParams, page: number): string {
  const search = new URLSearchParams();
  search.set('from', params.from);
  search.set('to', params.to);
  if (params.employeeId) search.set('employeeId', params.employeeId);
  search.set('page', String(page));
  search.set('pageSize', String(MAX_PAGE_SIZE));
  return search.toString();
}

async function fetchPage(params: AttendanceRangeParams, page: number, signal: AbortSignal) {
  const body = await apiRequest<unknown>(`/attendance/days?${toSearch(params, page)}`, { signal });
  return parseOrThrow(attendanceDaysResponseSchema, body, 'attendance day list');
}

async function fetchRange(params: AttendanceRangeParams, signal: AbortSignal): Promise<AttendanceRange> {
  const first = await fetchPage(params, 1, signal);
  const total = first.meta.total;
  const pageSize = first.meta.pageSize > 0 ? first.meta.pageSize : MAX_PAGE_SIZE;
  const pages = Math.ceil(total / pageSize);

  if (pages <= 1) return { days: first.data, total, complete: true };

  // The first page already reported the total, so the rest go out together
  // rather than one after another; thirty days of a large site is otherwise a
  // visible pause on a screen that is meant to be a glance.
  const wanted = Math.min(pages, MAX_PAGES);
  const rest = await Promise.all(
    Array.from({ length: wanted - 1 }, (_, index) => fetchPage(params, index + 2, signal)),
  );

  const days = rest.reduce<AttendanceDay[]>((all, page) => all.concat(page.data), [...first.data]);
  return { days, total, complete: pages <= MAX_PAGES };
}

export function useAttendanceRange(
  params: AttendanceRangeParams,
  options: AttendanceRangeOptions = {},
): UseQueryResult<Sampled<AttendanceRange>, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['attendance', 'days', 'range', params],
    queryFn: async ({ signal }) => {
      try {
        return { value: await fetchRange(params, signal), sample: false };
      } catch (error) {
        // Same five-line bridge every screen in the attendance module uses,
        // and it goes the same way: delete the catch when there is nothing
        // left that can 404. A screen that errors while the one next to it
        // shows samples reads as this screen being broken.
        if (isUnbuiltEndpoint(error)) {
          const samples = await loadSamples();
          if (samples) {
            const sampled = samples.sampleAttendanceDays({
              from: params.from,
              to: params.to,
              ...(params.employeeId ? { employeeId: params.employeeId } : {}),
              pageSize: MAX_PAGES * MAX_PAGE_SIZE,
            });
            return {
              value: { days: sampled.data, total: sampled.meta.total, complete: true },
              sample: true,
            };
          }
        }
        throw error;
      }
    },
    // Changing the range must not empty the chart to a skeleton and back. The
    // redraw is the answer arriving; a flash of nothing reads as a fault.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
