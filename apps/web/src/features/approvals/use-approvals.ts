import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import type { ApprovalStatus, ApprovalType, Paginated } from '@vyuha/shared';

import { withDevFixture, type Sampled } from '@/features/leave/dev-fixture-fallback';
import { paginatedSchema } from '@/features/leave/types';
import { ApiError, apiRequest } from '@/lib/api/client';

import {
  approvalRequestSchema,
  approveSchema,
  bulkActionSchema,
  rejectSchema,
  type ApprovalRequest,
  type BulkAction,
} from './types';

/**
 * REQ-I-03: one inbox per approver, filterable by type, with bulk actions.
 *
 * All four verbs go through the same generic endpoints (REQ-I-01) — there is
 * no per-type approve call and there must never be one, or the four separate
 * inboxes the requirement forbids reappear one mutation at a time.
 */

const approvalListSchema: z.ZodType<Paginated<ApprovalRequest>> =
  paginatedSchema(approvalRequestSchema);

export const APPROVALS_QUERY_ROOT = ['approvals'] as const;

export interface ApprovalListParams {
  page: number;
  pageSize: number;
  type: ApprovalType | null;
  status: ApprovalStatus | null;
}

export function useApprovals(
  params: ApprovalListParams,
): UseQueryResult<Sampled<Paginated<ApprovalRequest>>, Error> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.type) search.set('type', params.type);
  if (params.status) search.set('status', params.status);

  return useQuery({
    queryKey: [...APPROVALS_QUERY_ROOT, 'list', params],
    queryFn: ({ signal }) =>
      withDevFixture(
        async () => {
          const body = await apiRequest<unknown>(`/approvals?${search.toString()}`, { signal });
          const parsed = approvalListSchema.safeParse(body);
          if (!parsed.success) {
            throw new ApiError({
              code: 'INTERNAL_ERROR',
              message: 'The approvals inbox came back in a shape this screen cannot read.',
              status: 0,
              details: { issues: z.treeifyError(parsed.error) },
            });
          }
          return parsed.data;
        },
        (fixtures) => fixtures.approvalsFixture(params),
      ),
    placeholderData: keepPreviousData,
  });
}

export interface SingleDecision {
  id: string;
  action: 'APPROVE' | 'REJECT';
  /** REQ-F-05: mandatory on reject, optional on approve. */
  reason?: string;
}

export function useDecideApproval(): UseMutationResult<void, Error, SingleDecision> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, reason }: SingleDecision) => {
      const body =
        action === 'REJECT'
          ? rejectSchema.parse({ reason })
          : approveSchema.parse(reason === undefined ? {} : { reason });
      await apiRequest<unknown>(
        `/approvals/${id}/${action === 'REJECT' ? 'reject' : 'approve'}`,
        { method: 'POST', body },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: APPROVALS_QUERY_ROOT });
      // An approved leave moves a balance, so the leave screens are stale too.
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
    },
  });
}

/**
 * REQ-I-03 bulk. One request rather than a loop of single calls: a partial
 * failure halfway through a loop leaves the inbox in a state nobody chose, and
 * the server can apply the whole set in one transaction and one audit entry.
 */
export function useBulkDecision(): UseMutationResult<void, Error, BulkAction> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkAction) => {
      await apiRequest<unknown>('/approvals/bulk', {
        method: 'POST',
        body: bulkActionSchema.parse(input),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: APPROVALS_QUERY_ROOT });
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
    },
  });
}
