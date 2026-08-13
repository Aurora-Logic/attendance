import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { PermissionKey } from '@vyuha/shared';

import { parseOrThrow } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

import { rolesResponseSchema, type Role, type RolesResponse } from './types';

/**
 * `GET/POST/PATCH /roles` and `DELETE /masters/role/:id` (REQ-B-07).
 *
 * The sample-data fallback that stood here while the endpoints did not exist is
 * gone, and its removal is the point: a roles screen that invents four roles
 * would be showing somebody a permission matrix that is not the one in force.
 * An unreachable endpoint is now an error state, which is the truth.
 *
 * Every mutation carries a reason. Not because a role edit is destructive on
 * its own, but because it is the one edit that can lock an organisation out of
 * its own system.
 */

const ROLES_KEY = ['roles', 'list'] as const;

export function useRoles(
  options: { enabled?: boolean } = {},
): UseQueryResult<RolesResponse, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ROLES_KEY,
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/roles', { signal });
      return parseOrThrow(rolesResponseSchema, body, 'role list');
    },
    // A role edit takes effect on the next request, and the list is small.
    staleTime: 60_000,
  });
}

export interface CreateRoleInput {
  name: string;
  description: string | null;
  permissions: readonly PermissionKey[];
  reason: string;
}

export function useCreateRole(): UseMutationResult<Role, Error, CreateRoleInput> {
  return useInvalidating((input: CreateRoleInput) =>
    apiRequest<Role>('/roles', { method: 'POST', body: input }),
  );
}

export interface UpdateRoleInput {
  id: string;
  name?: string;
  description?: string | null;
  /** Absent means unchanged. An empty array means "grants nothing". */
  permissions?: readonly PermissionKey[];
  reason: string;
}

export function useUpdateRole(): UseMutationResult<Role, Error, UpdateRoleInput> {
  return useInvalidating(({ id, ...body }: UpdateRoleInput) =>
    apiRequest<Role>(`/roles/${id}`, { method: 'PATCH', body }),
  );
}

export interface DeleteRoleInput {
  id: string;
  reason: string;
}

export function useDeleteRole(): UseMutationResult<unknown, Error, DeleteRoleInput> {
  return useInvalidating((input: DeleteRoleInput) =>
    // Through the shared soft-delete route, so a role is deleted by the same
    // code path, with the same reason floor and the same audit shape, as every
    // other record — and lands in the same recycle bin.
    apiRequest<unknown>(`/masters/role/${input.id}`, {
      method: 'DELETE',
      body: { reason: input.reason },
    }),
  );
}

/**
 * Every role write invalidates the same three caches.
 *
 * The session is one of them: a change to a role the signed-in user holds
 * changes what they may do, and the sidebar, the Go To palette and every
 * disabled control read from it. Leaving it stale would show an administrator
 * a menu their next request refuses.
 */
function useInvalidating<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROLES_KEY });
      void queryClient.invalidateQueries({ queryKey: ['recycle-bin'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
