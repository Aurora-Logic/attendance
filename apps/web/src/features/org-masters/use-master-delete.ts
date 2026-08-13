import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';
import { parseOrThrow } from '@/features/attendance/api';
import { PERMISSIONS, type PermissionKey, type SoftDeletableEntity } from '@vyuha/shared';

/**
 * `DELETE /masters/:entityType/:id` — the one delete every master list uses
 * (REQ-B-09a, REQ-M-04).
 *
 * One hook rather than seven, because the route is one route: the server
 * resolves the entity type against `SOFT_DELETABLE_ENTITIES` and applies the
 * same reason floor, the same reference check and the same audit entry to all
 * of them. Seven copies would be seven chances for one screen to send a
 * shorter reason or forget to invalidate the bin.
 *
 * Nothing is removed from any cache by hand. The row leaves the list because
 * the list was refetched and the server no longer returns it — CLAUDE.md's
 * "optimistic nothing": a row that vanished and then came back on the next
 * refetch is worse than one that took 200ms to go.
 *
 * It lives here rather than beside the recycle bin because five screens across
 * four feature folders call it, and the bin is one of its readers rather than
 * its owner.
 */

const deleteResultSchema = z.object({
  entityType: z.string(),
  id: z.string(),
  name: z.string(),
  deleted: z.boolean(),
});

export type MasterDeleteResult = z.infer<typeof deleteResultSchema>;

export interface MasterDeleteInput {
  entityType: SoftDeletableEntity;
  id: string;
  reason: string;
}

/**
 * The permission the server checks for each master, mirrored so a screen can
 * disable a control before the press rather than explain a 403 after it. The
 * server re-checks every one of these and is the authority.
 */
export const MASTER_MANAGE_PERMISSION: Record<SoftDeletableEntity, PermissionKey> = {
  department: PERMISSIONS.EMPLOYEE_MANAGE,
  designation: PERMISSIONS.EMPLOYEE_MANAGE,
  location: PERMISSIONS.SETTINGS_MANAGE,
  shift: PERMISSIONS.SHIFT_MANAGE,
  leaveType: PERMISSIONS.LEAVE_POLICY_MANAGE,
  holidayCalendar: PERMISSIONS.HOLIDAY_MANAGE,
  role: PERMISSIONS.ROLES_MANAGE,
};

/** Singular, sentence case, for a title that reads "Delete department Engineering?". */
export const MASTER_LABEL: Record<SoftDeletableEntity, string> = {
  department: 'department',
  designation: 'designation',
  location: 'location',
  shift: 'shift',
  leaveType: 'leave type',
  holidayCalendar: 'holiday calendar',
  role: 'role',
};

/**
 * The caches a delete makes wrong, named rather than cleared wholesale.
 *
 * The same table the recycle bin keeps for a restore, and for the same reason:
 * the record disappears from its own list and from every picker built on that
 * list, and those are the only queries that can now be stale.
 */
function cachesTouchedBy(entityType: SoftDeletableEntity): readonly string[] {
  switch (entityType) {
    case 'department':
    case 'designation':
    case 'location':
      return ['departments', 'designations', 'locations', 'employees'];
    case 'shift':
      return ['shifts', 'rosters'];
    case 'leaveType':
      return ['leave'];
    case 'holidayCalendar':
      return ['holiday-calendars'];
    case 'role':
      return ['roles'];
  }
}

type QueryClient = ReturnType<typeof useQueryClient>;

export function invalidateAfterMasterWrite(
  queryClient: QueryClient,
  entityType: SoftDeletableEntity,
): void {
  void queryClient.invalidateQueries({ queryKey: ['recycle-bin'] });
  for (const key of cachesTouchedBy(entityType)) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useDeleteMaster(): UseMutationResult<MasterDeleteResult, Error, MasterDeleteInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: MasterDeleteInput) => {
      const body = await apiRequest<unknown>(`/masters/${input.entityType}/${input.id}`, {
        method: 'DELETE',
        body: { reason: input.reason },
      });
      return parseOrThrow(deleteResultSchema, body, 'delete result');
    },
    onSuccess: (_result, input) => {
      invalidateAfterMasterWrite(queryClient, input.entityType);
    },
  });
}
