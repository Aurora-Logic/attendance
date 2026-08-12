import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import type { Paginated } from '@vyuha/shared';

import { withDevFixture, type Sampled } from '@/features/leave/dev-fixture-fallback';
import { paginatedSchema } from '@/features/leave/types';
import { ApiError, apiRequest } from '@/lib/api/client';

import { holidayCalendarSchema, type HolidayCalendar } from './types';

/**
 * REQ-H-01: the holiday calendars, read side.
 *
 * The leave application form reads this too — REQ-G-07 skips holidays rather
 * than consuming them — which is why the hook lives here rather than inside
 * the holidays screen: the calendar is the source, and leave is a reader.
 */

const calendarListSchema: z.ZodType<Paginated<HolidayCalendar>> =
  paginatedSchema(holidayCalendarSchema);

export function useHolidayCalendars(
  year: number,
): UseQueryResult<Sampled<Paginated<HolidayCalendar>>, Error> {
  return useQuery({
    queryKey: ['holiday-calendars', year],
    queryFn: ({ signal }) =>
      withDevFixture(
        async () => {
          const body = await apiRequest<unknown>(`/holiday-calendars?year=${String(year)}`, {
            signal,
          });
          const parsed = calendarListSchema.safeParse(body);
          if (!parsed.success) {
            throw new ApiError({
              code: 'INTERNAL_ERROR',
              message: 'The holiday calendars came back in a shape this screen cannot read.',
              status: 0,
              details: { issues: z.treeifyError(parsed.error) },
            });
          }
          return parsed.data;
        },
        (fixtures) => fixtures.holidayCalendarsFixture(year),
      ),
    // A holiday list moves once a year. Refetching it on every mount would be
    // traffic for nothing, and the leave form mounts it on every visit.
    staleTime: 10 * 60_000,
  });
}
