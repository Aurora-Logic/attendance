import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { parseOrThrow } from '@/features/attendance/api';
import { attendanceDaysResponseSchema, type AttendanceDay } from '@/features/attendance/types';
import { apiRequest } from '@/lib/api/client';
import {
  PUNCH_FLAG_REVIEW_ACTIONS,
  PUNCH_SOURCES,
  PUNCH_TYPES,
  type Paginated,
  type PunchFlagReviewAction,
  type PunchSource,
  type PunchType,
} from '@vyuha/shared';

/**
 * What one employee's detail screen reads: their attendance days (REQ-E-01)
 * and the punches behind them (REQ-D-03a).
 *
 * Deliberately *not* `useAttendanceDays` from the attendance module, and the
 * difference is one line: that hook falls back to a generated sample set when
 * the endpoint 404s or the server is unreachable, and this screen draws charts.
 * A table of invented rows announces itself — every value is visibly made up
 * and the notice above it says so. A bar chart of invented rows is a shape,
 * and a shape is remembered after the notice is forgotten. So when the server
 * is not there this screen shows its error state and nothing else.
 *
 * The response schema and the wire-to-screen mapping are still the attendance
 * module's, imported rather than copied, so a rename on the server is one
 * compile error and not two.
 */

export interface EmployeeRangeParams {
  employeeId: string;
  /** Date-only `YYYY-MM-DD`, inclusive at both ends. */
  from: string;
  to: string;
}

/**
 * A month has at most 31 days, and the day engine writes one row per employee
 * per date, so a single page always holds the whole range. Asking for 31 keeps
 * the analysis honest — a paginated chart would describe a page while looking
 * like it described a month.
 */
const MAX_DAYS_IN_RANGE = 31;

export function useEmployeeAttendanceDays(
  params: EmployeeRangeParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<Paginated<AttendanceDay>, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['attendance', 'days', 'employee', params],
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({
        employeeId: params.employeeId,
        from: params.from,
        to: params.to,
        pageSize: String(MAX_DAYS_IN_RANGE),
      });
      const body = await apiRequest<unknown>(`/attendance/days?${search.toString()}`, { signal });
      return parseOrThrow(attendanceDaysResponseSchema, body, 'attendance day list');
    },
    // Stepping the month changes the key. Without this every step empties the
    // charts to a skeleton, which reads as the analysis breaking and coming
    // back rather than as the month moving.
    placeholderData: keepPreviousData,
  });
}

export interface EmployeePunch {
  readonly id: string;
  /** REQ-C-02: the shift start date, which a night shift's OUT does not share. */
  readonly attendanceDate: string;
  readonly type: PunchType;
  /** Authoritative (REQ-D-05). ISO-8601 instant. */
  readonly serverTime: string;
  readonly source: PunchSource;
  readonly reason: string | null;
  readonly flags: readonly string[];
  /** Owner, 21 Aug 2026: who recorded an ADMIN_ENTRY; null for the employee's own punches. */
  readonly recordedBy: { readonly id: string; readonly name: string } | null;
  /** Owner, 21 Aug 2026: the admin's last decisive word on the punch's flags. */
  readonly flagReview: { readonly action: PunchFlagReviewAction; readonly note: string | null; readonly decidedBy: { readonly id: string; readonly name: string } | null; readonly decidedAt: string } | null;
}

/**
 * Only the fields this table prints.
 *
 * A `PunchRecord` also carries a photo reference, a location and three clock
 * measurements, and demanding all of them here would make this section fail
 * whenever an unrelated field moved. `flags` stays `string[]` rather than the
 * shared enum for the reason the day rows give: punch flags are additive
 * server-side and one this build has never heard of should render with a
 * humanised label, not take the page down.
 */
const punchSchema = z.object({
  id: z.string(),
  attendanceDate: z.string(),
  type: z.enum(PUNCH_TYPES),
  serverTime: z.string(),
  source: z.enum(PUNCH_SOURCES),
  reason: z.string().nullable(),
  flags: z.array(z.string()),
  recordedBy: z.object({ id: z.string(), name: z.string() }).nullable().default(null),
  flagReview: z
    .object({
      action: z.enum(PUNCH_FLAG_REVIEW_ACTIONS),
      note: z.string().nullable(),
      decidedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
      decidedAt: z.string(),
    })
    .nullable()
    // Older API builds omit it; absent reads as unreviewed.
    .default(null),
}) satisfies z.ZodType<EmployeePunch, unknown>;

/** Technical design §6: the punch feed is cursor-paginated, not page-numbered. */
const punchFeedSchema = z.object({
  data: z.array(punchSchema),
  meta: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});

export interface PunchPage {
  readonly punches: EmployeePunch[];
  /** True when the range holds more punches than one page carries. */
  readonly hasMore: boolean;
}

/**
 * Two punches a day for a month is sixty-two, so this ceiling is generous for
 * the range the screen asks for and small enough that a person with a broken
 * device cannot drag a hundred rows into the page.
 */
const PUNCH_PAGE_LIMIT = 80;

export function useEmployeePunches(
  params: EmployeeRangeParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<PunchPage, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['punches', 'employee', params],
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({
        employeeId: params.employeeId,
        from: params.from,
        to: params.to,
        limit: String(PUNCH_PAGE_LIMIT),
      });
      const body = await apiRequest<unknown>(`/punches?${search.toString()}`, { signal });
      const page = parseOrThrow(punchFeedSchema, body, 'punch feed');
      return { punches: page.data, hasMore: page.meta.hasMore };
    },
    placeholderData: keepPreviousData,
  });
}
