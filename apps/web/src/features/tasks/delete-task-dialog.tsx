import { TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { actionErrorCopy } from '@/features/leave/api-error-copy';

import { useDeleteTask } from './use-tasks';

/** Same shape as the CRM delete dialogs, for the same reasons; a task takes no reason. */
export function DeleteTaskDialog({
  target,
  onOpenChange,
  onDeleted,
}: {
  target: { id: string; title: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const remove = useDeleteTask();
  const copy = actionErrorCopy(remove.error, 'Deleting the task');
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open: boolean) => {
        if (!open) remove.reset();
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TrashIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{target === null ? 'Delete task' : `Delete "${target.title}"?`}</AlertDialogTitle>
          <AlertDialogDescription>
            It leaves every list and the board. Closing it instead keeps the record — delete only what should never have existed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription>{copy.description} Nothing was deleted.</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>
            <ACTION_ICONS.cancel data-icon="inline-start" />
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (target === null) return;
              remove.mutate(target.id, {
                onSuccess: () => {
                  toast.add({ type: 'success', title: 'Task deleted', description: target.title });
                  onDeleted?.();
                  onOpenChange(false);
                },
              });
            }}
          >
            {remove.isPending ? <Spinner data-icon="inline-start" /> : <TrashIcon data-icon="inline-start" />}
            {remove.isPending ? 'Deleting' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
