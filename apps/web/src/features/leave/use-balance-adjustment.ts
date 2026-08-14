import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import {
  LEAVE_MOVEMENT_TYPES,
  leaveAdjustmentSchema,
  type LeaveAdjustment,
  type LeaveLedgerEntry,
  type Paginated,
} from '@vyuha/shared';

import { ApiError, apiRequest } from '@/lib/api/client';

import { leaveBalanceSchema, leaveTypeRefSchema, paginatedSchema, type LeaveBalance } from './types';
import { LEAVE_QUERY_ROOT } from './use-leave';

/**
 * `POST /leave/balances/adjust` and the ledger behind it (REQ-G-03).
 *
 * The adjustment is the one movement with no cause of its own: an accrual
 * points at a period and an availed at a request, while this points only at
 * whoever typed it. That is why the reason is mandatory in the shared schema
 * and why the ledger is read here beside the form — the trail is the only
 * account of why a number changed, and it is worth putting it in front of the
 * person writing the next one.
 *
 * No fixture fallback anywhere in this file, reads included. It writes an
 * append-only ledger the database physically refuses to delete from, so a
 * screen that showed invented balances beside a live write would be the worst
 * possible place for a sample to appear.
 */

const ledgerEntrySchema = z.object({
  id: z.string(),
  leaveType: leaveTypeRefSchema,
  leaveYear: z.number().int(),
  movementType: z.enum(LEAVE_MOVEMENT_TYPES),
  days: z.number(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<LeaveLedgerEntry>;

const ledgerListSchema = paginatedSchema(ledgerEntrySchema);
const balanceListSchema = paginatedSchema(leaveBalanceSchema);

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new ApiError({
    code: 'INTERNAL_ERROR',
    message: `The ${what} came back in a shape this screen cannot read.`,
    status: 0,
    details: { issues: z.treeifyError(parsed.error) },
  });
}

/**
 * One employee's balances for a leave year.
 *
 * Named rather than defaulted: `GET /leave/balances` without an employee id
 * answers with the caller's own, which on an HR screen would show HR's leave
 * beside somebody else's name.
 */
export function useEmployeeBalances(
  employeeId: string | null,
  year: number,
): UseQueryResult<Paginated<LeaveBalance>, Error> {
  return useQuery({
    enabled: employeeId !== null,
    queryKey: [...LEAVE_QUERY_ROOT, 'balances', 'of', employeeId, year],
    queryFn: async ({ signal }) => {
      if (employeeId === null) throw new Error('The balance query ran with no employee.');
      const search = new URLSearchParams({ year: String(year), employeeId });
      return parseOrThrow(
        balanceListSchema,
        await apiRequest<unknown>(`/leave/balances?${search.toString()}`, { signal }),
        'leave balances',
      );
    },
  });
}

/** REQ-G-03's trail, narrowed to the corrections somebody made by hand. */
export function useAdjustmentLedger(
  employeeId: string | null,
  year: number,
): UseQueryResult<Paginated<LeaveLedgerEntry>, Error> {
  return useQuery({
    enabled: employeeId !== null,
    queryKey: [...LEAVE_QUERY_ROOT, 'ledger', 'adjustments', employeeId, year],
    queryFn: async ({ signal }) => {
      if (employeeId === null) throw new Error('The ledger query ran with no employee.');
      const search = new URLSearchParams({
        year: String(year),
        employeeId,
        movementType: 'ADJUSTMENT',
        pageSize: '20',
      });
      return parseOrThrow(
        ledgerListSchema,
        await apiRequest<unknown>(`/leave/ledger?${search.toString()}`, { signal }),
        'leave ledger',
      );
    },
  });
}

export function useAdjustBalance(): UseMutationResult<LeaveBalance, Error, LeaveAdjustment> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LeaveAdjustment) => {
      // Parsed with the server's own schema, so a zero or a two-character
      // reason fails here with the field named rather than as a 400 the
      // reader has to interpret.
      const body = leaveAdjustmentSchema.parse(input);
      const response = await apiRequest<unknown>('/leave/balances/adjust', {
        method: 'POST',
        body,
      });
      return parseOrThrow(leaveBalanceSchema, response, 'adjusted balance');
    },
    onSuccess: () => {
      // The ledger, the balance, and this person's own My Leave band all move.
      void queryClient.invalidateQueries({ queryKey: LEAVE_QUERY_ROOT });
    },
  });
}

export type { LeaveLedgerEntry };
