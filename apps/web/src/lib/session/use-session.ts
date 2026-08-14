import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PermissionKey } from '@vyuha/shared';

import { apiRequest, getAccessToken, refreshAccessToken, setAccessToken } from '@/lib/api/client';

/**
 * Mirrors MeResponse in apps/api/src/platform/auth/auth.dto.ts. Technical
 * design §10: "`/me` returns the effective permission set", and the client
 * decides what to render from it and nothing else.
 */
export interface Me {
  user: { id: string; email: string; status: string; employeeId: string | null };
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string | null;
    departmentId: string | null;
    locationId: string | null;
    reportingManagerId: string | null;
  } | null;
  roles: { id: string; name: string }[];
  permissions: PermissionKey[];
}

interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  user: { id: string; email: string };
}

export const SESSION_QUERY_KEY = ['session', 'me'] as const;

/**
 * Resolves the current session.
 *
 * On a cold load there is no access token in memory - it deliberately does not
 * survive the tab - but the refresh cookie may still be valid, so this tries
 * to exchange it before deciding the visitor is anonymous. Without that step a
 * page refresh would look identical to signing out.
 *
 * `null` means anonymous and is a normal answer, not an error, so a 401 here
 * must not be retried or surfaced as a failure.
 */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      // Refresh first when there is no token in memory, rather than calling
      // /auth/me and letting it fail. On a cold load that call cannot succeed
      // - there is nothing to authenticate with - so making it anyway put a
      // guaranteed 401 in the console on every single page load, which is both
      // noise and a real request the server has to answer.
      if (!getAccessToken() && !(await refreshAccessToken())) return null;

      try {
        return await apiRequest<Me>('/auth/me');
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const result = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: input,
        // A 401 from this endpoint is the verdict on the typed password, not a
        // stale token. Without this, the client's refresh-and-retry replayed
        // the same wrong password - observed as login 401, refresh 200, login
        // 401 - burning two of REQ-B-10's five lockout attempts per typo.
        skipRefresh: true,
      });
      setAccessToken(result.accessToken);
      return result;
    },
    onSuccess: async () => {
      // Refetch rather than write a guess into the cache: the permission set
      // is the server's answer, and inventing it here is how a client ends up
      // rendering controls the API will refuse.
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        await apiRequest<void>('/auth/logout', { method: 'POST' });
      } finally {
        // Local state is cleared even if the call failed. A logout that leaves
        // the session on screen because the network blipped is worse than one
        // whose server-side revocation has to be retried.
        setAccessToken(null);
      }
    },
    onSuccess: () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
      queryClient.clear();
    },
  });
}
