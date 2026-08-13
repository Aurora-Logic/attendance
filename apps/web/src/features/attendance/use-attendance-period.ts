import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { MAX_PAGE_SIZE, type AttendanceStatus } from '@vyuha/shared';

import { apiRequest } from '@/lib/api/client';

import { isUnbuiltEndpoint, loadSamples, parseOrThrow, type Sampled } from './api';
import { attendanceDaysResponseSchema, type AttendanceDay } from './types';

/**
 * Every attendance day in a period, across as many pages as it takes, with the
 * filters the screens above it actually carry.
 *
 * `useAttendanceDays` reads one page, which is right for a table and wrong for
 * a chart: a fortnight of a two-hundred-person site is 2,800 rows, and a chart
 * drawn from the first two hundred of them would show a full first day and an
 * empty second week — a lie that looks exactly like an attendance collapse.
 * There is no aggregate endpoint yet (technical design §6 has the list only),
 * so the aggregation happens on the client, over complete data or not at all.
 *
 * `complete` is the honesty valve. Past `MAX_PAGES` the hook stops asking and
 * says so, and the screen prints that the period is partial rather than
 * charting the part it managed to fetch as though it were the whole.
 *
 * This is the dashboard's `useAttendanceRange` widened by three parameters
 * rather than a second idea about paging. It is a copy for the reason given in
 * `use-chart-motion.ts` — the dashboard is another agent's file — and it is
 * the copy the two attendance screens and Analytics all use, so there are two
 * of these in the app rather than four.
 */

/** 12 x 200 rows. Beyond this a chart needs a server-side summary, not more requests. */
const MAX_PAGES = 12;

export interface AttendancePeriodParams {
  /** Date-only `YYYY-MM-DD`, inclusive at both ends. */
  from: string;
  to: string;
  /** One person's days. Omitted, the server's scope predicate decides. */
  employeeId?: string | null;
  departmentId?: string | null;
  status?: AttendanceStatus | null;
}

export interface AttendancePeriod {
  days: AttendanceDay[];
  /** What the server said exists, which is not always what was fetched. */
  total: number;
  complete: boolean;
}

interface AttendancePeriodOptions {
  enabled?: boolean;
}

function toSearch(params: AttendancePeriodParams, page: number): string {
  const search = new URLSearchParams();
  search.set('from', params.from);
  search.set('to', params.to);
  if (params.employeeId) search.set('employeeId', params.employeeId);
  if (params.departmentId) search.set('departmentId', params.departmentId);
  if (params.status) search.set('status', params.status);
  search.set('page', String(page));
  search.set('pageSize', String(MAX_PAGE_SIZE));
  return search.toString();
}

async function fetchPage(params: AttendancePeriodParams, page: number, signal: AbortSignal) {
  const body = await apiRequest<unknown>(`/attendance/days?${toSearch(params, page)}`, { signal });
  return parseOrThrow(attendanceDaysResponseSchema, body, 'attendance day list');
}

async function fetchPeriod(
  params: AttendancePeriodParams,
  signal: AbortSignal,
): Promise<AttendancePeriod> {
  const first = await fetchPage(params, 1, signal);
  const total = first.meta.total;
  const pageSize = first.meta.pageSize > 0 ? first.meta.pageSize : MAX_PAGE_SIZE;
  const pages = Math.ceil(total / pageSize);

  if (pages <= 1) return { days: first.data, total, complete: true };

  // The first page already reported the total, so the rest go out together
  // rather than one after another; a quarter of a large site is otherwise a
  // visible pause on a screen somebody is waiting in front of.
  const wanted = Math.min(pages, MAX_PAGES);
  const rest = await Promise.all(
    Array.from({ length: wanted - 1 }, (_, index) => fetchPage(params, index + 2, signal)),
  );

  const days = rest.reduce<AttendanceDay[]>((all, page) => all.concat(page.data), [...first.data]);
  return { days, total, complete: pages <= MAX_PAGES };
}

export function useAttendancePeriod(
  params: AttendancePeriodParams,
  options: AttendancePeriodOptions = {},
): UseQueryResult<Sampled<AttendancePeriod>, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['attendance', 'days', 'period', params],
    queryFn: async ({ signal }) => {
      try {
        return { value: await fetchPeriod(params, signal), sample: false };
      } catch (error) {
        // Same five-line bridge every screen in this module uses, and it goes
        // the same way: delete the catch when there is nothing left that can
        // 404. A screen that errors while the one next to it shows samples
        // reads as this screen being broken.
        if (isUnbuiltEndpoint(error)) {
          const samples = await loadSamples();
          if (samples) {
            const sampled = samples.sampleAttendanceDays({
              from: params.from,
              to: params.to,
              ...(params.employeeId ? { employeeId: params.employeeId } : {}),
              ...(params.departmentId ? { departmentId: params.departmentId } : {}),
              ...(params.status ? { status: params.status } : {}),
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
    // Changing the period must not empty the chart to a skeleton and back. The
    // redraw is the answer arriving; a flash of nothing reads as a fault.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
