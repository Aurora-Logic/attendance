import { useQuery, keepPreviousData, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  MAX_PAGE_SIZE,
  PUNCH_SOURCES,
  PUNCH_TYPES,
} from '@vyuha/shared';

import { parseOrThrow } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

/**
 * The two feeds Analytics reads that the attendance module does not already
 * fetch: the punch log and the employee roster.
 *
 * Both are read whole, over a bounded window, and both refuse to hand back a
 * partial answer disguised as a complete one. A chart is an assertion about a
 * period; drawing three of five pages of punches would assert that the last
 * two days had no punches in them, which is indistinguishable from a genuine
 * outage. `complete: false` is the signal the screen prints instead.
 *
 * Neither has a sample-data fallback. Both endpoints exist and were verified
 * against the running API, and a screen that quietly renders invented rows is
 * exactly the failure REQ-M-01 exists to prevent — somebody would act on it.
 *
 * Permissions, stated because they differ from the screen's own gate:
 *   /punches    attendance.view.self | .team | .all  (the screen's gate covers it)
 *   /employees  employee.view                        (the screen must ask first)
 */

// ------------------------------------------------------------------ punches

/**
 * What Analytics reads off a punch, and nothing else.
 *
 * Narrower than the full `PunchRecord` on purpose: this screen counts sources
 * and flags, and a schema that also demanded a photo reference and a location
 * would turn an unrelated server change into a blank analytics page. The three
 * enums are pinned to the shared contract, so a source added server-side is a
 * parse failure with a readable message rather than a silently dropped slice.
 */
const punchRowSchema = z.object({
  id: z.string(),
  attendanceDate: z.string(),
  type: z.enum(PUNCH_TYPES),
  source: z.enum(PUNCH_SOURCES),
  // `string[]` rather than the shared flag enum, for the same reason the
  // attendance day loosens it: flags are additive server-side and a punch
  // carrying one this build has not heard of must still be counted.
  flags: z.array(z.string()),
});

export type PunchRow = z.infer<typeof punchRowSchema>;

const punchFeedSchema = z.object({
  data: z.array(punchRowSchema),
  meta: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
});

/** 10 x 200 punches. Past this the screen needs a server-side tally, not more requests. */
const MAX_PUNCH_PAGES = 10;

export interface PunchWindow {
  punches: PunchRow[];
  complete: boolean;
  /** How many were actually read, which is what the notes on screen count. */
  fetched: number;
}

async function fetchPunchWindow(
  from: string,
  to: string,
  signal: AbortSignal,
): Promise<PunchWindow> {
  const punches: PunchRow[] = [];
  let cursor: string | null = null;

  // Sequential rather than parallel, and unavoidably so: a cursor feed cannot
  // say where page four starts until page three has come back. The cap is what
  // stops that turning into an unbounded request loop on a busy month.
  for (let page = 0; page < MAX_PUNCH_PAGES; page += 1) {
    const search = new URLSearchParams({ from, to, limit: String(MAX_PAGE_SIZE) });
    if (cursor !== null) search.set('cursor', cursor);
    const body = await apiRequest<unknown>(`/punches?${search.toString()}`, { signal });
    const parsed = parseOrThrow(punchFeedSchema, body, 'punch feed');
    punches.push(...parsed.data);
    if (!parsed.meta.hasMore || parsed.meta.nextCursor === null) {
      return { punches, complete: true, fetched: punches.length };
    }
    cursor = parsed.meta.nextCursor;
  }

  return { punches, complete: false, fetched: punches.length };
}

export function usePunchWindow(
  params: { from: string; to: string },
  options: { enabled?: boolean } = {},
): UseQueryResult<PunchWindow, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['punches', 'window', params],
    queryFn: ({ signal }) => fetchPunchWindow(params.from, params.to, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------- employees

/**
 * The roster fields headcount is counted from.
 *
 * `dateOfLeaving` is read but not charted: it is what makes "active" mean
 * something, and a leaver still holds a department in the list.
 */
const rosterRowSchema = z.object({
  id: z.string(),
  employeeCode: z.string(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  status: z.enum(EMPLOYEE_STATUSES),
  department: z.object({ id: z.string(), name: z.string() }).nullable(),
});

export type RosterRow = z.infer<typeof rosterRowSchema>;

const rosterPageSchema = z.object({
  data: z.array(rosterRowSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});

/** 10 x 200 people. NFR-04 targets 500 now and 5,000 later; this covers 2,000. */
const MAX_ROSTER_PAGES = 10;

export interface Roster {
  people: RosterRow[];
  total: number;
  complete: boolean;
}

async function fetchRosterPage(page: number, signal: AbortSignal) {
  const search = new URLSearchParams({ page: String(page), pageSize: String(MAX_PAGE_SIZE) });
  const body = await apiRequest<unknown>(`/employees?${search.toString()}`, { signal });
  return parseOrThrow(rosterPageSchema, body, 'employee list');
}

async function fetchRoster(signal: AbortSignal): Promise<Roster> {
  const first = await fetchRosterPage(1, signal);
  const total = first.meta.total;
  const pageSize = first.meta.pageSize > 0 ? first.meta.pageSize : MAX_PAGE_SIZE;
  const pages = Math.ceil(total / pageSize);

  if (pages <= 1) return { people: first.data, total, complete: true };

  const wanted = Math.min(pages, MAX_ROSTER_PAGES);
  const rest = await Promise.all(
    Array.from({ length: wanted - 1 }, (_, index) => fetchRosterPage(index + 2, signal)),
  );

  const people = rest.reduce<RosterRow[]>((all, page) => all.concat(page.data), [...first.data]);
  return { people, total, complete: pages <= MAX_ROSTER_PAGES };
}

export function useRoster(options: { enabled?: boolean } = {}): UseQueryResult<Roster, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['employees', 'roster', 'analytics'],
    queryFn: ({ signal }) => fetchRoster(signal),
    // Headcount moves when somebody joins or leaves, not while a reader is
    // looking at it.
    staleTime: 5 * 60_000,
  });
}
