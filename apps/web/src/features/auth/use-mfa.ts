import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { MfaEnrolmentStart, MfaRecoveryCodes, MfaStatus } from '@vyuha/shared';

import { apiRequest, setAccessToken } from '@/lib/api/client';
import { SESSION_QUERY_KEY } from '@/lib/session/use-session';

/**
 * REQ-B-09, the client side. The status is one query, invalidated by every
 * change; the code step after the password is a mutation that, like login,
 * stores the access token and then refetches the session so the gate sees
 * a signed-in person rather than a guess about one.
 */

export const MFA_QUERY_KEY = ['session', 'mfa'] as const;

interface LoginResponse {
  accessToken: string;
}

export function useMfaStatus(enabled = true) {
  return useQuery({
    queryKey: MFA_QUERY_KEY,
    queryFn: () => apiRequest<MfaStatus>('/auth/mfa'),
    enabled,
  });
}

export function useCompleteMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { challengeToken: string; code: string; trustDevice: boolean }) => {
      const result = await apiRequest<LoginResponse>('/auth/mfa/verify', { method: 'POST', body: input, skipRefresh: true });
      setAccessToken(result.accessToken);
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}

function useInvalidatingMutation<TInput, TOutput>(run: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MFA_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
      ]);
    },
  });
}

export function useStartMfaEnrolment() {
  return useInvalidatingMutation<void, MfaEnrolmentStart>(() => apiRequest<MfaEnrolmentStart>('/auth/mfa/enrol', { method: 'POST' }));
}

export function useConfirmMfa() {
  return useInvalidatingMutation<{ code: string }, MfaRecoveryCodes>((input) => apiRequest<MfaRecoveryCodes>('/auth/mfa/confirm', { method: 'POST', body: input }));
}

export function useDisableMfa() {
  return useInvalidatingMutation<{ code: string }, void>((input) => apiRequest<void>('/auth/mfa/disable', { method: 'POST', body: input }));
}

export function useRegenerateRecoveryCodes() {
  return useInvalidatingMutation<{ code: string }, MfaRecoveryCodes>((input) => apiRequest<MfaRecoveryCodes>('/auth/mfa/recovery-codes', { method: 'POST', body: input }));
}

export function useRevokeTrustedDevice() {
  return useInvalidatingMutation<string, void>((deviceId) => apiRequest<void>(`/auth/mfa/trusted-devices/${deviceId}`, { method: 'DELETE' }));
}

/** An administrator's reset for somebody else; the employee page's query is the caller's to refresh. */
export function useResetMfaForUser() {
  return useMutation({
    mutationFn: (userId: string) => apiRequest<void>(`/auth/mfa/reset/${userId}`, { method: 'POST' }),
  });
}
