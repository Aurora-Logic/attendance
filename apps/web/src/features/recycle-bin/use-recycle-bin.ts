import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { SoftDeletableEntity } from '@vyuha/shared';

import { parseOrThrow } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

import { recycleBinResponseSchema, type RecycleBinResponse } from './types';

/**
 * `GET /recycle-bin` and `POST /masters/:entityType/:id/restore` (REQ-B-09a).
 *
 * No sample fallback, unlike the other screens in this build. A bin that
 * invented rows would be telling somebody that records were deleted when they
 * were not — and the natural next action is to restore one, which would then
 * fail. An empty bin and an unreachable bin are different states and this hook
 * lets the screen say which.
 */

const BIN_KEY = ['recycle-bin'] as const;

export interface RecycleBinFilters {
  entityType?: SoftDeletableEntity | undefined;
  q?: string | undefined;
  page: number;
  pageSize: number;
}

export function useRecycleBin(
  filters: RecycleBinFilters,
  options: { enabled?: boolean } = {},
): UseQueryResult<RecycleBinResponse, Error> {
  const search = new URLSearchParams();
  if (filters.entityType !== undefined) search.set('entityType', filters.entityType);
  if (filters.q !== undefined && filters.q.length > 0) search.set('q', filters.q);
  search.set('page', String(filters.page));
  search.set('pageSize', String(filters.pageSize));

  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: [...BIN_KEY, search.toString()],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/recycle-bin?${search.toString()}`, { signal });
      return parseOrThrow(recycleBinResponseSchema, body, 'recycle bin');
    },
  });
}

export interface RestoreInput {
  entityType: SoftDeletableEntity;
  id: string;
  reason: string;
}

export function useRestore(): UseMutationResult<unknown, Error, RestoreInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RestoreInput) =>
      apiRequest<unknown>(`/masters/${input.entityType}/${input.id}/restore`, {
        method: 'POST',
        body: { reason: input.reason },
      }),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: BIN_KEY });
      // A restored record reappears in its own list, which is very likely open
      // in another tab of the same session. Naming the caches rather than
      // clearing everything: these are the six that can now be wrong.
      for (const key of cachesTouchedBy(input.entityType)) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

function cachesTouchedBy(entityType: SoftDeletableEntity): readonly string[] {
  switch (entityType) {
    case 'department':
    case 'designation':
    case 'location':
      // The employee form's pickers are built from all three.
      return ['departments', 'designations', 'locations', 'employees'];
    case 'shift':
      return ['shifts'];
    case 'leaveType':
      return ['leave'];
    case 'holidayCalendar':
      return ['holidays'];
    case 'role':
      return ['roles'];
  }
}
