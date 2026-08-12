import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import type { ApprovalStatus, Paginated } from '@vyuha/shared';

import { ApiError, apiRequest } from '@/lib/api/client';

import { withDevFixture, type Sampled } from './dev-fixture-fallback';
import {
  leaveApplicationSchema,
  leaveBalanceSchema,
  leaveRequestSchema,
  leaveTypePolicySchema,
  paginatedSchema,
  type LeaveApplication,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveTypePolicy,
} from './types';

/**
 * REQ-G-01, G-03, G-06: the read and write sides of leave, as the screens use
 * them.
 *
 * The queries live with the screens for the same reason `useEmployees` does —
 * the parameters are the shape of that screen's toolbar. What is new here is
 * the development fallback: none of these endpoints exist yet, so each query
 * hits the real path first and only serves fixtures when the server says there
 * is nothing there. See `dev-fixture-fallback.ts`.
 */

/** Turns a response this screen cannot read into the error state it already has. */
function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown, subject: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: `The ${subject} came back in a shape this screen cannot read.`,
      status: 0,
      details: { issues: z.treeifyError(parsed.error) },
    });
  }
  return parsed.data;
}

const balanceListSchema = paginatedSchema(leaveBalanceSchema);
const requestListSchema = paginatedSchema(leaveRequestSchema);
const typeListSchema = paginatedSchema(leaveTypePolicySchema);

export const LEAVE_QUERY_ROOT = ['leave'] as const;

export function useLeaveBalances(
  leaveYear: number,
): UseQueryResult<Sampled<Paginated<LeaveBalance>>, Error> {
  return useQuery({
    queryKey: [...LEAVE_QUERY_ROOT, 'balances', leaveYear],
    queryFn: ({ signal }) =>
      withDevFixture(
        async () =>
          parseOrThrow(
            balanceListSchema,
            await apiRequest<unknown>(`/leave/balances?year=${String(leaveYear)}`, { signal }),
            'leave balances',
          ),
        (fixtures) => fixtures.leaveBalancesFixture(leaveYear),
      ),
  });
}

export interface LeaveRequestListParams {
  page: number;
  pageSize: number;
  status: ApprovalStatus | null;
}

export function useLeaveRequests(
  params: LeaveRequestListParams,
): UseQueryResult<Sampled<Paginated<LeaveRequest>>, Error> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.status) search.set('status', params.status);

  return useQuery({
    queryKey: [...LEAVE_QUERY_ROOT, 'requests', params],
    queryFn: ({ signal }) =>
      withDevFixture(
        async () =>
          parseOrThrow(
            requestListSchema,
            await apiRequest<unknown>(`/leave/requests?${search.toString()}`, { signal }),
            'leave history',
          ),
        (fixtures) => fixtures.leaveRequestsFixture(params),
      ),
    // Paging should narrow the list in place rather than empty it to a
    // skeleton, which reads as the list breaking and coming back.
    placeholderData: keepPreviousData,
  });
}

export function useLeaveTypes(): UseQueryResult<Sampled<Paginated<LeaveTypePolicy>>, Error> {
  return useQuery({
    queryKey: [...LEAVE_QUERY_ROOT, 'types'],
    queryFn: ({ signal }) =>
      withDevFixture(
        async () =>
          parseOrThrow(
            typeListSchema,
            await apiRequest<unknown>('/leave/types', { signal }),
            'leave types',
          ),
        (fixtures) => fixtures.leaveTypesFixture(),
      ),
    // The policy list changes about once a quarter and three screens read it.
    staleTime: 5 * 60_000,
  });
}

/**
 * REQ-G-06. The body is parsed with the same schema the server will use, so a
 * field this form forgets to send fails here rather than as a 400 the reader
 * has to interpret.
 */
export function useApplyForLeave(): UseMutationResult<LeaveRequest, Error, LeaveApplication> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LeaveApplication) => {
      const body = leaveApplicationSchema.parse(input);
      const response = await apiRequest<unknown>('/leave/requests', { method: 'POST', body });
      return parseOrThrow(leaveRequestSchema, response, 'leave application');
    },
    onSuccess: () => {
      // The balance and the history both move when an application lands, and
      // the balance band is the thing the reader will look at to confirm it.
      void queryClient.invalidateQueries({ queryKey: LEAVE_QUERY_ROOT });
    },
  });
}

export interface LeaveTypeDraft extends Omit<LeaveTypePolicy, 'id'> {
  /** Absent when creating (REQ-G-01 allows new types, not only edits). */
  id: string | null;
}

/** REQ-G-01: `GET/POST /leave/types` in the technical design §6 surface. */
export function useSaveLeaveType(): UseMutationResult<LeaveTypePolicy, Error, LeaveTypeDraft> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...draft }: LeaveTypeDraft) => {
      const response = await apiRequest<unknown>(
        id === null ? '/leave/types' : `/leave/types/${id}`,
        { method: id === null ? 'POST' : 'PATCH', body: draft },
      );
      return parseOrThrow(leaveTypePolicySchema, response, 'leave type');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LEAVE_QUERY_ROOT });
    },
  });
}
