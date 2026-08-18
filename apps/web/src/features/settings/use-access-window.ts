import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api/client';
import { parseOrThrow } from '@/lib/api/parse';
import { accessWindowSchema, type AccessWindow } from '@vyuha/shared';

/**
 * The sign-in window (12 REQ-AB-01…AB-04): when sign-in closes and reopens,
 * on the organisation's clock, and on which days. Its own row rather than a
 * group in `/settings`, so it is read and written through its own route —
 * and held here as edits over the server's row, the way the office geofence
 * is, so the screen's one Save can carry it beside the other groups.
 */

export const ACCESS_WINDOW_QUERY_KEY = ['settings', 'access-window'] as const;

export function useAccessWindowQuery(options: { enabled?: boolean } = {}): UseQueryResult<AccessWindow, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ACCESS_WINDOW_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/settings/access-window', { signal });
      return parseOrThrow(accessWindowSchema, body, 'access window');
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaveAccessWindow(): UseMutationResult<AccessWindow, Error, AccessWindow> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AccessWindow) => {
      // Parsed against the server's own schema before it leaves, so a bad
      // clock string fails here rather than as a 400 to interpret.
      const body = await apiRequest<unknown>('/settings/access-window', { method: 'PUT', body: accessWindowSchema.parse(input) });
      return parseOrThrow(accessWindowSchema, body, 'saved access window');
    },
    onSuccess: (saved) => {
      // The response is the authoritative post-write state.
      queryClient.setQueryData<AccessWindow>(ACCESS_WINDOW_QUERY_KEY, saved);
    },
  });
}

export interface AccessWindowDraftState {
  readonly query: UseQueryResult<AccessWindow, Error>;
  /** The server's row with the edits over it, or null until the row arrives. */
  readonly draft: AccessWindow | null;
  /** What Save should send, or null when nothing has changed. */
  readonly write: AccessWindow | null;
  readonly edit: (next: Partial<AccessWindow>) => void;
  /** Back to the last thing the server said. */
  readonly reset: () => void;
}

function same(left: AccessWindow, right: AccessWindow): boolean {
  return left.enabled === right.enabled && left.closesAt === right.closesAt && left.reopensAt === right.reopensAt && [...left.days].sort((a, b) => a - b).join(',') === [...right.days].sort((a, b) => a - b).join(',');
}

/**
 * `edited` is null until somebody touches a control, and the draft is the
 * fetched row until then — which is what makes a save repaint without an
 * effect to reseed the form.
 */
export function useAccessWindowDraft(options: { enabled?: boolean } = {}): AccessWindowDraftState {
  const query = useAccessWindowQuery(options);
  const [edited, setEdited] = useState<AccessWindow | null>(null);
  const saved = query.data ?? null;
  const draft = saved === null ? null : (edited ?? saved);
  const write = saved !== null && draft !== null && !same(draft, saved) ? draft : null;
  return {
    query,
    draft,
    write,
    edit: (next) => {
      if (draft === null) return;
      setEdited({ ...draft, ...next });
    },
    reset: () => {
      setEdited(null);
    },
  };
}
