import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { z } from 'zod';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { ApiError, apiRequest } from '@/lib/api/client';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

/**
 * REQ-M-05: ask for everything the system holds about one employee.
 *
 * Mount this on the employee detail screen's header actions
 * (`features/employees/employee-detail-page.tsx`), beside Edit. It is here in
 * `components/shared/` rather than in the employees feature because the
 * employees slice was owned by another change while this was written; it has no
 * dependency on that feature and can move into it whenever somebody wants.
 *
 * Gated on `employee.manage`, which is the key the requirement names and which
 * the endpoint enforces again server-side. Hidden rather than disabled when the
 * permission is absent: a disabled control with a reason is right for something
 * a person could gain, and "you are not allowed to take a copy of somebody's
 * whole record" is not a state anybody should be invited to fix from here.
 *
 * A confirmation, because it is not an ordinary read. The file holds every
 * punch, leave decision and audit entry about a person, the request is recorded
 * against their record with the requester's name on it, and the person pressing
 * it should know both before they press it rather than after.
 */

const exportJobSchema = z.object({
  id: z.string(),
  filename: z.string(),
  status: z.string(),
});

interface EmployeeDataExportButtonProps {
  readonly employeeId: string;
  /** Only for the copy. The server names the subject on the file itself. */
  readonly employeeName: string;
}

export function EmployeeDataExportButton({
  employeeId,
  employeeName,
}: EmployeeDataExportButtonProps) {
  const canManage = usePermission(PERMISSIONS.EMPLOYEE_MANAGE);
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const request = useMutation({
    mutationFn: async () => {
      const body = await apiRequest<unknown>(`/employees/${employeeId}/data-export`, {
        method: 'POST',
      });
      const parsed = exportJobSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'The export request came back in a shape this screen cannot read.',
          status: 0,
          details: { issues: z.treeifyError(parsed.error) },
        });
      }
      return parsed.data;
    },
    onSuccess: (job) => {
      setConfirming(false);
      // The tray reads `export_jobs`, and this just added a row to it.
      void queryClient.invalidateQueries({ queryKey: ['reports', 'exports'] });
      toast.add({
        type: 'success',
        title: 'Export started',
        description: `${job.filename} will appear in Downloads when it is ready.`,
      });
    },
    onError: (error: Error) => {
      setConfirming(false);
      toast.add({ type: 'error', title: 'Export refused', description: error.message });
    },
  });

  if (!canManage) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={request.isPending}
        onClick={() => {
          setConfirming(true);
        }}
      >
        <DownloadSimpleIcon data-icon="inline-start" />
        {request.isPending ? 'Requesting' : 'Export data'}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Export everything held about {employeeName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The file covers identity, employment, attendance, punches, leave, regularizations,
              approvals and the audit trail. It appears in Downloads, expires after seven days, and
              the request is recorded against this employee with your name on it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={request.isPending}
              onClick={(event) => {
                // The dialog closes itself on action; the mutation decides when,
                // so a failure does not close over a screen with no error on it.
                event.preventDefault();
                request.mutate();
              }}
            >
              Export data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
