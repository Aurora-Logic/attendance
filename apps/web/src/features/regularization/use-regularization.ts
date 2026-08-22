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
  onDutyInputSchema,
  regularizationCompleteSchema,
  regularizationInputSchema,
  type ApprovalStatus,
  type OnDutyInput,
  type OnDutyRequest,
  type Paginated,
  type RegularizationComplete,
  type RegularizationInput,
  type RegularizationPolicyView,
  type RegularizationRequest,
} from '@vyuha/shared';

import { ApiError, apiRequest } from '@/lib/api/client';

import {
  onDutyRequestSchema,
  paginatedSchema,
  regularizationPolicySchema,
  regularizationRequestSchema,
} from './types';

/**
 * REQ-F-01 … REQ-F-05, as the screens use them.
 *
 * No development fixture fallback anywhere in this file, unlike leave and
 * attendance. Those two shims exist because their screens shipped before their
 * endpoints did; these endpoints exist, so a fallback would only ever serve a
 * developer with the API stopped — and a regularization that "succeeded"
 * against a fixture, on the one flow whose entire purpose is to change a
 * payroll input, would be a lie worth avoiding.
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

const regularizationListSchema = paginatedSchema(regularizationRequestSchema);
const onDutyListSchema = paginatedSchema(onDutyRequestSchema);

export const REGULARIZATION_QUERY_ROOT = ['regularization'] as const;

/**
 * REQ-F-02's limits, from the server.
 *
 * The form bounds its own calendar with these rather than with 7 and 3 from a
 * constant, because both are org settings an administrator can move — and a
 * form that goes on offering dates the server will refuse is worse than one
 * that offers none.
 */
export function useRegularizationPolicy(
  enabled = true,
): UseQueryResult<RegularizationPolicyView, Error> {
  return useQuery({
    enabled,
    queryKey: [...REGULARIZATION_QUERY_ROOT, 'policy'],
    queryFn: async ({ signal }) =>
      parseOrThrow(
        regularizationPolicySchema,
        await apiRequest<unknown>('/regularizations/policy', { signal }),
        'regularization limits',
      ),
    // The allowance moves every time this person raises one, so it is not
    // cached across a mutation; `staleTime` only spares a refetch on a
    // remount within the minute.
    staleTime: 60_000,
  });
}

export interface RequestListParams {
  page: number;
  pageSize: number;
  status: ApprovalStatus | null;
}

function listSearch(params: RequestListParams): string {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.status) search.set('status', params.status);
  return search.toString();
}

export function useRegularizations(
  params: RequestListParams,
  enabled = true,
): UseQueryResult<Paginated<RegularizationRequest>, Error> {
  return useQuery({
    enabled,
    queryKey: [...REGULARIZATION_QUERY_ROOT, 'requests', params],
    queryFn: async ({ signal }) =>
      parseOrThrow(
        regularizationListSchema,
        await apiRequest<unknown>(`/regularizations?${listSearch(params)}`, { signal }),
        'regularizations',
      ),
    // Paging narrows the list in place rather than emptying it to a skeleton,
    // which reads as the list breaking and coming back.
    placeholderData: keepPreviousData,
  });
}

export function useOnDutyRequests(
  params: RequestListParams,
  enabled = true,
): UseQueryResult<Paginated<OnDutyRequest>, Error> {
  return useQuery({
    enabled,
    queryKey: [...REGULARIZATION_QUERY_ROOT, 'on-duty', params],
    queryFn: async ({ signal }) =>
      parseOrThrow(
        onDutyListSchema,
        await apiRequest<unknown>(`/on-duty-requests?${listSearch(params)}`, { signal }),
        'on-duty requests',
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * Everything an approved request can move, invalidated together.
 *
 * The muster is the one that matters and the one most easily forgotten: the
 * server recomputes the affected days inline, so a client holding a cached
 * attendance day would keep showing PENDING next to a request it has just
 * watched turn green.
 */
function invalidateAfterWrite(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: REGULARIZATION_QUERY_ROOT });
  void queryClient.invalidateQueries({ queryKey: ['attendance'] });
}

/**
 * REQ-F-01. The body is parsed with the same schema the server uses, so a
 * field this form forgets to send, or a time the chosen kind does not accept,
 * fails here rather than as a 400 the reader has to interpret.
 */
export function useRaiseRegularization(): UseMutationResult<
  RegularizationRequest,
  Error,
  RegularizationInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegularizationInput) => {
      const body = regularizationInputSchema.parse(input);
      const response = await apiRequest<unknown>('/regularizations', { method: 'POST', body });
      return parseOrThrow(regularizationRequestSchema, response, 'regularization');
    },
    onSuccess: () => {
      invalidateAfterWrite(queryClient);
    },
  });
}

/**
 * `attendance.regularization_auto_file`'s other half: the reason (and, if the
 * employee changes their mind about the time, a corrected one) that turns a
 * system-raised draft into a real request. Same shape as `useRaiseRegularization`
 * beyond that — one mutation, invalidate, and the muster picks it up once an
 * approver decides.
 */
export function useCompleteRegularizationDraft(): UseMutationResult<
  RegularizationRequest,
  Error,
  { id: string; input: RegularizationComplete }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: RegularizationComplete }) => {
      const body = regularizationCompleteSchema.parse(input);
      const response = await apiRequest<unknown>(`/regularizations/${id}/complete`, {
        method: 'PATCH',
        body,
      });
      return parseOrThrow(regularizationRequestSchema, response, 'regularization');
    },
    onSuccess: () => {
      invalidateAfterWrite(queryClient);
    },
  });
}

/** REQ-F-04. */
export function useRaiseOnDuty(): UseMutationResult<OnDutyRequest, Error, OnDutyInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OnDutyInput) => {
      const body = onDutyInputSchema.parse(input);
      const response = await apiRequest<unknown>('/on-duty-requests', { method: 'POST', body });
      return parseOrThrow(onDutyRequestSchema, response, 'on-duty request');
    },
    onSuccess: () => {
      invalidateAfterWrite(queryClient);
    },
  });
}
