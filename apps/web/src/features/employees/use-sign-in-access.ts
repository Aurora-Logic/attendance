import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  invitationResultSchema,
  passwordResetLinkSchema,
  signInAccountSchema,
  type InvitationResult,
  type PasswordResetLink,
  type SignInAccount,
} from '@vyuha/shared';

import { parseOrThrow } from '@/features/attendance/api';
import { apiRequest } from '@/lib/api/client';

/**
 * REQ-B-03 and REQ-B-04 as an administrator performs them: give somebody a way
 * to sign in, or a way back in.
 *
 * Both return a link rather than sending one. `MAIL_TRANSPORT` defaults to
 * `log` and the deployment has no mail server, so the response is the delivery
 * -- the administrator copies it and passes it on. Nothing about the tokens
 * changed: single use, 72 hours for an invitation and 30 minutes for a reset,
 * and issuing a new invitation kills the previous link.
 *
 * Parsed, not cast. The link is put behind a control the reader is invited to
 * hand to a colleague, so `acceptUrl` arriving as `undefined` has to be an
 * error state rather than the string "undefined" in somebody's message.
 */

/**
 * Whether this employee can sign in already.
 *
 * Deliberately not `useEmployeeAccess`, which reads
 * `GET /employees/:id/access` under `roles.manage`. Inviting is
 * `employee.manage`, and the first version of this dialog used the roles read
 * to decide what to offer — which meant an HR user, holding exactly the
 * permission the screen is for, opened it and got a 403 from an endpoint they
 * were never meant to call, with no invite button behind it. Caught by reading
 * the route policy, not by pressing the button as an administrator, who holds
 * both keys and would never have seen it.
 */
export function useSignInAccount(
  employeeId: string | undefined,
): UseQueryResult<SignInAccount, Error> {
  const id = employeeId ?? '';
  return useQuery({
    enabled: id.length > 0,
    queryKey: ['employees', 'sign-in-account', id],
    queryFn: async ({ signal }) =>
      parseOrThrow(
        signInAccountSchema,
        await apiRequest<unknown>(`/auth/invitations/for-employee/${id}`, { signal }),
        'account',
      ),
    // Short: the dialog decides what to offer from this, and the previous
    // answer is stale the moment an invitation is issued from it.
    staleTime: 5_000,
  });
}

export interface InviteVariables {
  /** REQ-B-02: the login is created against this employee record, 1:1. */
  employeeId: string;
  /** REQ-B-01 signs in with the work email, so this is the work email. */
  email: string;
}

export function useCreateInvitation(): UseMutationResult<
  InvitationResult,
  Error,
  InviteVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ employeeId, email }: InviteVariables) =>
      parseOrThrow(
        invitationResultSchema,
        await apiRequest<unknown>('/auth/invitations', {
          method: 'POST',
          // No roles. They are granted on the same screen, under Access and
          // roles, and that control is gated on `roles.manage` -- attaching
          // them here would let somebody holding only `employee.manage` decide
          // what a new account can do.
          body: { email, employeeId, roleIds: [] },
        }),
        'invitation',
      ),
    onSuccess: () => {
      // The account this created is what the access panel on the same screen
      // shows, and what decides whether inviting is offered again. Both sit
      // under the 'employees' root, so one invalidation reaches them.
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
}

export function useIssuePasswordResetLink(): UseMutationResult<
  PasswordResetLink,
  Error,
  { employeeId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ employeeId }: { employeeId: string }) =>
      parseOrThrow(
        passwordResetLinkSchema,
        await apiRequest<unknown>('/auth/password-resets/for-employee', {
          method: 'POST',
          body: { employeeId },
        }),
        'password reset link',
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
}

export interface SetCredentialsVariables {
  employeeId: string;
  email: string;
  password: string;
  roleId?: string;
  reason?: string;
}

export function useSetCredentials(): UseMutationResult<
  unknown,
  Error,
  SetCredentialsVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ employeeId, email, password, roleId, reason }: SetCredentialsVariables) =>
      apiRequest<unknown>(`/employees/${employeeId}/access/credentials`, {
        method: 'POST',
        body: { email, password, roleId, reason },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
}
