import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError, apiRequest } from '@/lib/api/client';

/**
 * Departments, for the filter picker (REQ-A-02).
 *
 * Only the two fields the picker needs are read. The endpoint returns more,
 * and a schema that demanded all of it would make this screen fail whenever an
 * unrelated column was added to a department.
 *
 * It lives beside the employees screen rather than in `lib/`, because that is
 * the only screen using it today. When rosters and reports need the same list,
 * it moves up - inventing a shared module for one caller guesses at a shape
 * before there is anything to shape it against.
 */

export interface DepartmentOption {
  id: string;
  name: string;
}

const responseSchema = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string() })),
});

export function useDepartments(): UseQueryResult<DepartmentOption[], Error> {
  return useQuery({
    queryKey: ['departments', 'options'],
    queryFn: async ({ signal }) => {
      // One page large enough for every department an organisation this size
      // has. Paging a filter picker would hide options behind a control the
      // picker does not have.
      const body = await apiRequest<unknown>('/departments?pageSize=200', { signal });
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'The department list came back in a shape this screen cannot read.',
          status: 0,
          details: { issues: z.treeifyError(parsed.error) },
        });
      }
      return parsed.data.data;
    },
    // Departments change a few times a year, not a few times a minute.
    staleTime: 10 * 60 * 1000,
  });
}
