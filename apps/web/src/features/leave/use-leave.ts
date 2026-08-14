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
  leaveApplicationSchema,
  leaveTypeInputSchema,
  leaveTypePatchSchema,
  type ApprovalStatus,
  type LeaveApplication,
  type LeaveDayPortion,
  type LeaveTypeInput,
  type LeaveTypePatch,
  type Paginated,
} from '@vyuha/shared';

import { ApiError, apiRequest } from '@/lib/api/client';

import { withDevFixture, type Sampled } from './dev-fixture-fallback';
import {
  compOffCreditSchema,
  leaveBalanceSchema,
  leavePreviewSchema,
  leaveRequestDetailSchema,
  leaveRequestSchema,
  leaveTypePolicySchema,
  paginatedSchema,
  type CompOffCredit,
  type LeaveBalance,
  type LeavePreview,
  type LeaveRequest,
  type LeaveRequestDetail,
  type LeaveTypePolicy,
} from './types';

/**
 * REQ-G-01 … REQ-G-12: the read and write sides of leave, as the screens use
 * them.
 *
 * The queries live with the screens for the same reason `useEmployees` does —
 * the parameters are the shape of that screen's toolbar.
 *
 * Each read still goes through `withDevFixture`, which is now a narrow
 * fallback rather than the ordinary path: the endpoints below exist, so the
 * only thing that reaches the fixtures is a development machine with the API
 * not running. See `dev-fixture-fallback.ts` for why that is allowed to serve
 * anything at all, and why a 403 is not. Nothing that writes has a fallback —
 * a mutation that "succeeded" against a fixture would be a lie.
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
const compOffListSchema = paginatedSchema(compOffCreditSchema);

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
            // `pageSize` explicitly: the default page is 50 and the picker
            // must not silently lose a type an organisation added last week.
            await apiRequest<unknown>('/leave/types?pageSize=200', { signal }),
            'leave types',
          ),
        (fixtures) => fixtures.leaveTypesFixture(),
      ),
    // The policy list changes about once a quarter and three screens read it.
    staleTime: 5 * 60_000,
  });
}

export function useCompOffCredits(
  state: 'ACTIVE' | 'LAPSED' | 'CONSUMED',
): UseQueryResult<Paginated<CompOffCredit>, Error> {
  return useQuery({
    queryKey: [...LEAVE_QUERY_ROOT, 'comp-off', state],
    queryFn: async ({ signal }) =>
      parseOrThrow(
        compOffListSchema,
        await apiRequest<unknown>(`/leave/comp-off?state=${state}&pageSize=100`, { signal }),
        'comp-off credits',
      ),
  });
}

export interface LeavePreviewParams {
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  fromPortion: LeaveDayPortion;
  toPortion: LeaveDayPortion;
}

/**
 * REQ-G-06: "the form shows the computed working days consumed and the balance
 * before/after, before submission".
 *
 * The server answers this, not the client. Only the server knows the
 * employee's holiday calendar, their weekly-off pattern, the sandwich rule on
 * the type and the balance behind it — and it runs the same `evaluate()` the
 * application will, so the number the form shows is the number that is
 * deducted rather than an estimate the submission then contradicts.
 *
 * `enabled` is the caller's, because a half-filled form must not ask.
 */
export function usePreviewLeave(
  params: LeavePreviewParams | null,
): UseQueryResult<LeavePreview, Error> {
  return useQuery({
    enabled: params !== null,
    queryKey: [...LEAVE_QUERY_ROOT, 'preview', params],
    queryFn: async ({ signal }) => {
      if (params === null) throw new Error('The preview ran with no parameters.');
      const search = new URLSearchParams({
        leaveTypeId: params.leaveTypeId,
        fromDate: params.fromDate,
        toDate: params.toDate,
        fromPortion: params.fromPortion,
        toPortion: params.toPortion,
      });
      return parseOrThrow(
        leavePreviewSchema,
        await apiRequest<unknown>(`/leave/preview?${search.toString()}`, { signal }),
        'leave preview',
      );
    },
    // Nudging a date should replace the summary in place rather than blank it,
    // which reads as the arithmetic failing and coming back.
    placeholderData: keepPreviousData,
    // The calendar behind it moves about as often as a public holiday is added.
    staleTime: 60_000,
  });
}

/**
 * REQ-G-06. The body is parsed with the same schema the server will use, so a
 * field this form forgets to send fails here rather than as a 400 the reader
 * has to interpret.
 */
export function useApplyForLeave(): UseMutationResult<
  LeaveRequestDetail,
  Error,
  LeaveApplication
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LeaveApplication) => {
      const body = leaveApplicationSchema.parse(input);
      const response = await apiRequest<unknown>('/leave/requests', { method: 'POST', body });
      return parseOrThrow(leaveRequestDetailSchema, response, 'leave application');
    },
    onSuccess: () => {
      // The balance and the history both move when an application lands, and
      // the balance band is the thing the reader will look at to confirm it.
      void queryClient.invalidateQueries({ queryKey: LEAVE_QUERY_ROOT });
    },
  });
}

/** REQ-G-10. Before the start date the employee may do this themselves. */
export function useCancelLeave(): UseMutationResult<
  LeaveRequestDetail,
  Error,
  { id: string; reason: string | null }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }) => {
      const response = await apiRequest<unknown>(`/leave/requests/${id}/cancel`, {
        method: 'POST',
        body: { reason },
      });
      return parseOrThrow(leaveRequestDetailSchema, response, 'leave cancellation');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LEAVE_QUERY_ROOT });
      // Cancelling approved leave recomputes the affected days inline on the
      // server, so the muster this client holds is stale too.
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

/**
 * There is deliberately no hook here for deciding leave.
 *
 * A minimal band on the Approvals screen used to read pending leave from
 * `/leave/requests` and decide it on `/leave/requests/:id/approve`, because
 * nothing raised a leave request into the generic inbox. The join has landed:
 * applying now raises an approval request, so leave arrives in the inbox with
 * a route, a current step, delegation and escalation, and the inbox's own
 * `useDecideApproval` is the only decision mutation the client needs
 * (REQ-I-03: "one Approvals inbox per approver").
 *
 * Re-adding one would not double-write -- the leave endpoints route through
 * the framework now, so a second decision is refused either way -- but it
 * would list requests by status rather than by whose step they are on, and
 * offer buttons on rows that are waiting on somebody else.
 */

export interface LeaveTypeDraft extends LeaveTypeInput {
  /** Absent when creating (REQ-G-01 allows new types, not only edits). */
  id: string | null;
}

/**
 * REQ-G-01: `GET/POST /leave/types` in the technical design §6 surface.
 *
 * The code is dropped from an edit rather than sent: the ledger, every report
 * and every export cite it, so the server refuses to rename one, and sending
 * it would earn a 400 for a field the form never let anyone change.
 */
export function useSaveLeaveType(): UseMutationResult<LeaveTypePolicy, Error, LeaveTypeDraft> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...draft }: LeaveTypeDraft) => {
      const body: LeaveTypeInput | LeaveTypePatch =
        id === null
          ? leaveTypeInputSchema.parse(draft)
          : leaveTypePatchSchema.parse({ ...draft, code: undefined });
      const response = await apiRequest<unknown>(
        id === null ? '/leave/types' : `/leave/types/${id}`,
        { method: id === null ? 'POST' : 'PATCH', body },
      );
      return parseOrThrow(leaveTypePolicySchema, response, 'leave type');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LEAVE_QUERY_ROOT });
    },
  });
}
