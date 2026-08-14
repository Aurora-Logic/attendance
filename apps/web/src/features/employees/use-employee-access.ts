import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { ALL_PERMISSIONS, USER_STATUSES, type PermissionKey } from '@vyuha/shared';
import { z } from 'zod';

import { parseOrThrow } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

/**
 * `/employees/:id/access` (REQ-B-07): which roles a person's login holds, and
 * the two writes that change it.
 *
 * No sample fallback, deliberately. Every other read on this screen has one for
 * the endpoints that did not exist yet; inventing an answer here would show an
 * administrator a permission set that is not the one in force, which is worse
 * than an error state on the one screen where being wrong matters most.
 */

const permissionKeySchema = z.enum(
  ALL_PERMISSIONS as unknown as [PermissionKey, ...PermissionKey[]],
);

const assignedRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(permissionKeySchema),
});

export type AssignedRole = z.infer<typeof assignedRoleSchema>;

export const employeeAccessSchema = z.object({
  employeeId: z.string(),
  account: z
    .object({
      id: z.string(),
      email: z.string(),
      status: z.enum(USER_STATUSES),
      lastLoginAt: z.string().nullable(),
    })
    .nullable(),
  roles: z.array(assignedRoleSchema),
});

export type EmployeeAccess = z.infer<typeof employeeAccessSchema>;

function accessKey(employeeId: string): readonly unknown[] {
  return ['employees', employeeId, 'access'];
}

export function useEmployeeAccess(
  employeeId: string | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<EmployeeAccess, Error> {
  const id = employeeId ?? '';
  return useQuery({
    enabled: (options.enabled ?? true) && id.length > 0,
    queryKey: accessKey(id),
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>(`/employees/${id}/access`, { signal });
      return parseOrThrow(employeeAccessSchema, body, 'access and roles');
    },
    // A role change takes effect on the holder's next request, so a stale
    // reading here would be a screen disagreeing with the server about what
    // somebody can do.
    staleTime: 30_000,
  });
}

export interface AssignRoleVariables {
  employeeId: string;
  roleId: string;
  reason: string;
}

export function useAssignRole(): UseMutationResult<EmployeeAccess, Error, AssignRoleVariables> {
  return useAccessMutation(({ employeeId, ...body }: AssignRoleVariables) =>
    apiRequest<EmployeeAccess>(`/employees/${employeeId}/access/roles`, {
      method: 'POST',
      body,
    }),
  );
}

export interface RevokeRoleVariables {
  employeeId: string;
  roleId: string;
  reason: string;
}

export function useRevokeRole(): UseMutationResult<EmployeeAccess, Error, RevokeRoleVariables> {
  return useAccessMutation(({ employeeId, roleId, reason }: RevokeRoleVariables) =>
    apiRequest<EmployeeAccess>(`/employees/${employeeId}/access/roles/${roleId}`, {
      method: 'DELETE',
      body: { reason },
    }),
  );
}

/**
 * Four caches move when a membership changes, and each one would be wrong
 * without this.
 *
 * `roles` carries a member count per role. `session` decides the sidebar, the
 * Go To palette and every disabled control -- and an administrator granting
 * themselves a role would otherwise keep looking at the old menu until
 * something else happened to refetch. `audit-logs` because this write leaves a
 * row the history sheet on this very screen is showing.
 */
function useAccessMutation<TInput extends { employeeId: string }>(
  mutationFn: (input: TInput) => Promise<EmployeeAccess>,
): UseMutationResult<EmployeeAccess, Error, TInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      queryClient.setQueryData(accessKey(variables.employeeId), data);
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
}
