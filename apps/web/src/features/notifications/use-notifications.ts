import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import {
  notificationPreferencesInputSchema,
  type NotificationPreference,
  type NotificationPreferenceUpdate,
  type NotificationReadResult,
  type NotificationSummary,
  type NotificationUnreadCount,
  type Paginated,
} from '@vyuha/shared';

import { paginatedSchema } from '@/features/leave/types';
import { ApiError, apiRequest } from '@/lib/api/client';

import {
  notificationSchema,
  preferenceListSchema,
  readResultSchema,
  unreadCountSchema,
} from './types';

/**
 * REQ-K-02, REQ-K-04, REQ-K-05 on the client.
 *
 * One query root, so every mutation can invalidate the whole feature with a
 * single prefix. That is what makes the count fall the instant something is
 * read without a page reload: the read returns the server's own new count and
 * the cache is refreshed from it, rather than the badge decrementing a number
 * it keeps for itself and drifting away from the server after a second device
 * reads the same row.
 */

export const NOTIFICATIONS_QUERY_ROOT = ['notifications'] as const;

const notificationListSchema: z.ZodType<Paginated<NotificationSummary>> =
  paginatedSchema(notificationSchema);

/**
 * How often the bell re-asks for its count.
 *
 * Sixty seconds, and only while the tab is visible. A notification is not a
 * chat message and nobody is waiting on the second; polling harder would spend
 * a request per person per few seconds for a number that changes a handful of
 * times a day. There is no socket in this product and adding one for a badge
 * would be a dependency and a deployment concern for very little.
 */
const UNREAD_POLL_MS = 60_000;

function parsed<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: `${what} came back in a shape this screen cannot read.`,
      status: 0,
      details: { issues: z.treeifyError(result.error) },
    });
  }
  return result.data;
}

export interface NotificationListParams {
  page: number;
  pageSize: number;
  unreadOnly: boolean;
}

export function useNotifications(
  params: NotificationListParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<Paginated<NotificationSummary>, Error> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.unreadOnly) search.set('unreadOnly', 'true');

  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: [...NOTIFICATIONS_QUERY_ROOT, 'list', params],
    queryFn: async ({ signal }) =>
      parsed(
        notificationListSchema,
        await apiRequest<unknown>(`/me/notifications?${search.toString()}`, { signal }),
        'Your notifications',
      ),
    placeholderData: keepPreviousData,
  });
}

export function useUnreadCount(): UseQueryResult<NotificationUnreadCount, Error> {
  return useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_ROOT, 'unread-count'],
    queryFn: async ({ signal }) =>
      parsed(
        unreadCountSchema,
        await apiRequest<unknown>('/me/notifications/unread-count', { signal }),
        'The unread count',
      ),
    refetchInterval: UNREAD_POLL_MS,
    // Off by default across the app (see App.tsx), and wanted here: coming back
    // to the tab is exactly the moment somebody looks at the bell.
    refetchOnWindowFocus: true,
    // The badge is the one thing that should never be stale on arrival.
    staleTime: 0,
  });
}

/**
 * Marking read, single and all.
 *
 * Both write the returned count straight into the unread-count cache before
 * invalidating, so the badge moves on the same frame as the click rather than
 * a round trip later. The invalidation that follows is what reconciles it with
 * anything else that changed in the meantime.
 */
export function useMarkNotificationRead(): UseMutationResult<NotificationReadResult, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      parsed(
        readResultSchema,
        await apiRequest<unknown>(`/me/notifications/${id}/read`, { method: 'POST' }),
        'Marking a notification read',
      ),
    onSuccess: (result) => {
      queryClient.setQueryData<NotificationUnreadCount>(
        [...NOTIFICATIONS_QUERY_ROOT, 'unread-count'],
        { unread: result.unread },
      );
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_ROOT });
    },
  });
}

export function useMarkAllNotificationsRead(): UseMutationResult<
  NotificationReadResult,
  Error,
  void
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      parsed(
        readResultSchema,
        await apiRequest<unknown>('/me/notifications/read-all', { method: 'POST' }),
        'Marking everything read',
      ),
    onSuccess: (result) => {
      queryClient.setQueryData<NotificationUnreadCount>(
        [...NOTIFICATIONS_QUERY_ROOT, 'unread-count'],
        { unread: result.unread },
      );
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_ROOT });
    },
  });
}

export const NOTIFICATION_PREFERENCES_QUERY_KEY = [
  ...NOTIFICATIONS_QUERY_ROOT,
  'preferences',
] as const;

export function useNotificationPreferences(): UseQueryResult<NotificationPreference[], Error> {
  return useQuery({
    queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
    queryFn: async ({ signal }) =>
      parsed(
        preferenceListSchema,
        await apiRequest<unknown>('/me/notification-preferences', { signal }),
        'Your notification preferences',
      ),
  });
}

/**
 * One switch at a time, sent as the batch the endpoint takes.
 *
 * The body is parsed by the schema the server parses it with. A client-side
 * copy of "only these channels can be asked for" is how the two ends come to
 * disagree about what a valid request is.
 */
export function useSaveNotificationPreference(): UseMutationResult<
  NotificationPreference[],
  Error,
  NotificationPreferenceUpdate
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (update: NotificationPreferenceUpdate) =>
      parsed(
        preferenceListSchema,
        await apiRequest<unknown>('/me/notification-preferences', {
          method: 'PATCH',
          body: notificationPreferencesInputSchema.parse({ preferences: [update] }),
        }),
        'Your notification preferences',
      ),
    onSuccess: (grid) => {
      // The server answers with the whole grid, so there is nothing to refetch
      // and nothing to reconcile -- the switch settles on what was stored.
      queryClient.setQueryData<NotificationPreference[]>(
        NOTIFICATION_PREFERENCES_QUERY_KEY,
        grid,
      );
    },
  });
}
