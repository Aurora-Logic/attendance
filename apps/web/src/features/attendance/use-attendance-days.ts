import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';
import type { AttendanceStatus, DepartmentSummary, Paginated } from '@vyuha/shared';

import { isUnbuiltEndpoint, loadSamples, parseOrThrow, type Sampled } from './api';
import { attendanceDaysResponseSchema, type AttendanceDay } from './types';

/**
 * `GET /attendance/days` (REQ-E-01), read side.
 *
 * The parameters are the shape of the filter bars above the two screens that
 * use it - My Attendance passes a month and one employee, Team Attendance
 * passes one date and a department - so the hook lives with the feature rather
 * than in `lib`.
 */

export interface AttendanceDaysParams {
  /** Date-only `YYYY-MM-DD`, inclusive at both ends. */
  from: string;
  to: string;
  /**
   * One person's days, by id. There is no `me` sentinel: the server validates
   * this as a UUID and answers 400 for anything else, and it is safe to send a
   * real id because every query runs inside the caller's scope predicate -
   * asking for a colleague's id returns no rows rather than their attendance.
   */
  employeeId?: string | null;
  departmentId?: string | null;
  status?: AttendanceStatus | null;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Technical design §6: `?from=&to=&departmentId=&employeeId=&status=`. */
function toSearch(params: AttendanceDaysParams): string {
  const search = new URLSearchParams();
  search.set('from', params.from);
  search.set('to', params.to);
  if (params.employeeId) search.set('employeeId', params.employeeId);
  if (params.departmentId) search.set('departmentId', params.departmentId);
  if (params.status) search.set('status', params.status);
  // Absent rather than empty: `?q=` filters for the empty string as far as a
  // strict server-side schema is concerned, and that schema has a min length.
  if (params.q) search.set('q', params.q);
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.pageSize !== undefined) search.set('pageSize', String(params.pageSize));
  return search.toString();
}

/**
 * Kept out of `AttendanceDaysParams` on purpose: that object is the query
 * string and it is the cache key. Folding a client-side switch into it would
 * make the same request cache under two keys depending on whether it was
 * allowed to run.
 */
export interface AttendanceDaysOptions {
  enabled?: boolean;
}

export function useAttendanceDays(
  params: AttendanceDaysParams,
  options: AttendanceDaysOptions = {},
): UseQueryResult<Sampled<Paginated<AttendanceDay>>, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['attendance', 'days', params],
    queryFn: async ({ signal }) => {
      try {
        const body = await apiRequest<unknown>(`/attendance/days?${toSearch(params)}`, { signal });
        return {
          value: parseOrThrow(attendanceDaysResponseSchema, body, 'attendance day list'),
          sample: false,
        };
      } catch (error) {
        // The whole fallback is these five lines. Delete them when the
        // endpoint lands; nothing above or below changes.
        if (isUnbuiltEndpoint(error)) {
          const samples = await loadSamples();
          if (samples) return { value: samples.sampleAttendanceDays(params), sample: true };
        }
        throw error;
      }
    },
    // Stepping a date or paging changes the key. Without this the table empties
    // to a skeleton between every step, which reads as the list breaking and
    // coming back rather than as the date moving.
    placeholderData: keepPreviousData,
  });
}

const departmentsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      code: z.string(),
      parent: z.object({ id: z.string(), name: z.string() }).nullable(),
      head: z.object({ id: z.string(), name: z.string() }).nullable(),
    }),
  ),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
}) satisfies z.ZodType<Paginated<DepartmentSummary>>;

/**
 * The department filter's options (REQ-A-02).
 *
 * This endpoint does exist, so in practice the fallback below never fires; it
 * is here because the muster must still render its filter bar when the API is
 * not running at all, and a filter that silently has no options is worse than
 * one that says why.
 */
export function useDepartments(): UseQueryResult<Sampled<Paginated<DepartmentSummary>>, Error> {
  return useQuery({
    // Not ['departments', 'options']: the employees feature caches a plain
    // DepartmentOption[] under that key, and this hook caches a Sampled
    // envelope. One key holding two shapes means whichever fetches first
    // poisons the other screen. Still under the 'departments' root, so the
    // master-data invalidations reach it.
    queryKey: ['departments', 'attendance-options'],
    queryFn: async ({ signal }) => {
      try {
        const body = await apiRequest<unknown>('/departments?pageSize=200', { signal });
        return {
          value: parseOrThrow(departmentsResponseSchema, body, 'department list'),
          sample: false,
        };
      } catch (error) {
        if (isUnbuiltEndpoint(error)) {
          const samples = await loadSamples();
          if (samples) return { value: samples.sampleDepartments(), sample: true };
        }
        throw error;
      }
    },
    // Departments change a few times a year. Refetching them with every date
    // step is a request per keystroke for a list that has not moved.
    staleTime: 5 * 60_000,
  });
}
