import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { z } from 'zod';

import {
  EMPLOYEE_IMPORT_ACTIONS,
  employeeImportSchema,
  type EmployeeImportReport,
  type EmployeeImportRow,
  type EmployeeImportRowResult,
} from '@vyuha/shared';

import { ApiError, apiRequest } from '@/lib/api/client';

/**
 * REQ-A-06: `POST /employees/import/validate` and `/commit`.
 *
 * One mutation for both halves, the way the holiday import does it, because
 * the reader moves between them — preview, fix the file, preview again, commit
 * — and two hooks would hold two copies of the last report with the screen
 * having to decide which one it is showing.
 *
 * The response is parsed rather than trusted. A per-row error list is the one
 * thing on this screen a person will act on, and an unvalidated shape would
 * fail inside a table cell with a stack trace naming RecordTable.
 */

const rowResultSchema = z.object({
  rowNumber: z.number().int(),
  employeeCode: z.string(),
  action: z.enum(EMPLOYEE_IMPORT_ACTIONS),
  errors: z.array(z.string()),
}) satisfies z.ZodType<EmployeeImportRowResult>;

const reportSchema = z.object({
  rows: z.array(rowResultSchema),
  counts: z.object({ CREATE: z.number().int(), ERROR: z.number().int() }),
  committed: z.boolean(),
  createdCount: z.number().int(),
}) satisfies z.ZodType<EmployeeImportReport>;

export interface EmployeeImportRequest {
  rows: EmployeeImportRow[];
  /** `validate` writes nothing; `commit` creates the valid rows (REQ-A-06). */
  mode: 'validate' | 'commit';
}

export function useImportEmployees(): UseMutationResult<
  EmployeeImportReport,
  Error,
  EmployeeImportRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: EmployeeImportRequest) => {
      // Parsed with the server's own schema first, so a file over the 500-row
      // cap fails here naming the limit rather than as a 400 the reader has to
      // interpret.
      const body = employeeImportSchema.parse({ rows: request.rows });
      const response = await apiRequest<unknown>(`/employees/import/${request.mode}`, {
        method: 'POST',
        body,
      });
      const parsed = reportSchema.safeParse(response);
      if (!parsed.success) {
        throw new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'The import report came back in a shape this screen cannot read.',
          status: 0,
          details: { issues: z.treeifyError(parsed.error) },
        });
      }
      return parsed.data;
    },
    onSuccess: (_report, request) => {
      // Only a commit changes anything. Invalidating after a preview would
      // refetch the register for nothing, several times, while somebody is
      // still editing their file.
      if (request.mode === 'commit') {
        void queryClient.invalidateQueries({ queryKey: ['employees'] });
        void queryClient.invalidateQueries({ queryKey: ['departments'] });
      }
    },
  });
}

export type { EmployeeImportReport, EmployeeImportRowResult };
