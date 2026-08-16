import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import { parseOrThrow } from '@/lib/api/parse';
import { apiRequest } from '@/lib/api/client';

import { integrationsResponseSchema, type IntegrationsResponse } from './types';

/**
 * `GET /integrations` and its two writes (technical design §14, Phase 6b).
 *
 * The sample-data fallback that stood here is gone, and its removal is the
 * point. There was no controller behind this path at all, so the screen showed
 * an invented Tally connection in development and an error in production — and
 * the invented one was the more dangerous of the two, because it looked like an
 * answer.
 *
 * The mutation hooks exist now because the credential machinery finally does:
 * Phase 6b built minting, so a button can stand behind a real endpoint.
 */
export function useIntegrations(
  options: { enabled?: boolean } = {},
): UseQueryResult<IntegrationsResponse, Error> {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: ['integrations', 'list'],
    queryFn: async ({ signal }) => {
      const body = await apiRequest<unknown>('/integrations', { signal });
      return parseOrThrow(integrationsResponseSchema, body, 'integration list');
    },
    // A heartbeat lands every few minutes; nothing here needs a live poll, and
    // the reader can refresh when they are actually watching for one.
    staleTime: 60_000,
  });
}

export interface CreateConnectionVariables {
  name: string;
  companyName?: string;
  companyGuid?: string;
}

export function useCreateConnection(): UseMutationResult<
  unknown,
  Error,
  CreateConnectionVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConnectionVariables) =>
      apiRequest<unknown>('/integrations', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

const issuedTokenSchema = z.object({
  connectionId: z.string(),
  token: z.string(),
});

export type IssuedToken = z.infer<typeof issuedTokenSchema>;

export function useIssueToken(): UseMutationResult<IssuedToken, Error, { connectionId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ connectionId }) => {
      const body = await apiRequest<unknown>(`/integrations/${connectionId}/token`, {
        method: 'POST',
      });
      return parseOrThrow(issuedTokenSchema, body, 'issued agent token');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

const queuedPullSchema = z.object({
  jobId: z.string(),
  /** True when the press found an open job rather than creating one. */
  alreadyQueued: z.boolean(),
});

export type QueuedPull = z.infer<typeof queuedPullSchema>;

/**
 * REQ-R-07's manual half. The server holds the one-open-job invariant, so a
 * second press answers the existing job instead of erroring — the screen's
 * only duty is to say which of the two happened.
 */
export function usePullNow(): UseMutationResult<QueuedPull, Error, { connectionId: string }> {
  return useMutation({
    mutationFn: async ({ connectionId }) => {
      const body = await apiRequest<unknown>(`/integrations/${connectionId}/pull`, {
        method: 'POST',
        body: { entityType: 'party' },
      });
      return parseOrThrow(queuedPullSchema, body, 'queued pull');
    },
  });
}
