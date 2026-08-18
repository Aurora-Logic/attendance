import { useInfiniteQuery, useMutation, useQueryClient, type UseInfiniteQueryResult, type UseMutationResult } from '@tanstack/react-query';
import type { CrmActivityKind, CrmActivitySubject, LogActivityInput } from '@vyuha/shared';

import { apiRequest } from '@/lib/api/client';
import { parseOrThrow } from '@/lib/api/parse';

import { activityPageSchema, activitySchema, type Activity, type ActivityPageView } from './types';

/** REQ-U-07: one record's timeline, newest first, paged by the audit cursor. */
export function useActivities(
  subject: { type: CrmActivitySubject; id: string } | null,
): UseInfiniteQueryResult<{ pages: ActivityPageView[] }, Error> {
  return useInfiniteQuery({
    enabled: subject !== null,
    queryKey: ['crm', 'activities', subject?.type ?? '', subject?.id ?? ''],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ subjectType: subject?.type ?? '', subjectId: subject?.id ?? '', limit: '30' });
      if (pageParam !== null) params.set('cursor', pageParam);
      const body = await apiRequest<unknown>(`/crm/activities?${params.toString()}`, { signal });
      return parseOrThrow(activityPageSchema, body, 'activity timeline');
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useLogActivity(): UseMutationResult<
  Activity,
  Error,
  { subjectType: CrmActivitySubject; subjectId: string; kind: CrmActivityKind; body: string }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const body: LogActivityInput = { subjectType: input.subjectType, subjectId: input.subjectId, kind: input.kind, body: input.body.trim() };
      const response = await apiRequest<unknown>('/crm/activities', { method: 'POST', body });
      return parseOrThrow(activitySchema, response, 'logged activity');
    },
    onSuccess: async (_saved, input) => {
      // The row lands when the request completes; a refetch straight away
      // usually sees it, and a second one a moment later always does.
      await client.invalidateQueries({ queryKey: ['crm', 'activities', input.subjectType, input.subjectId] });
      window.setTimeout(() => {
        void client.invalidateQueries({ queryKey: ['crm', 'activities', input.subjectType, input.subjectId] });
      }, 800);
    },
  });
}
