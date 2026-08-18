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

import { useDeleteCompany, useDeleteContact } from './use-crm';

/**
 * The confirm step for a CRM delete. Same shape as the holiday dialog and for
 * the same reason: `DELETE /crm/contacts/:id` takes no reason, so none is
 * asked for. What it keeps: it names the record, it never paints success
 * before the server agreed, and it surfaces the refusal in place — a company
 * that still has contacts is refused with the count, and the count is shown.
 */

export interface DeleteRecordTarget {
  id: string;
  name: string;
}

interface DeleteDialogProps {
  target: DeleteRecordTarget | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export function DeleteContactDialog({ target, onOpenChange, onDeleted }: DeleteDialogProps) {
  const remove = useDeleteContact();
  return (
    <DeleteRecordDialog
      kind="contact"
      target={target}
      description="It leaves every list, and its tasks and deals lose the link. The delete is written to the audit log."
      pending={remove.isPending}
      error={remove.error}
      onOpenChange={(open) => {
        if (!open) remove.reset();
        onOpenChange(open);
      }}
      onConfirm={() => {
        if (target === null) return;
        remove.mutate(target.id, {
          onSuccess: () => {
            toast.add({ type: 'success', title: `${target.name} deleted` });
            onDeleted?.();
            onOpenChange(false);
          },
        });
      }}
    />
  );
}

export function DeleteCompanyDialog({ target, onOpenChange, onDeleted }: DeleteDialogProps) {
  const remove = useDeleteCompany();
  return (
    <DeleteRecordDialog
      kind="company"
      target={target}
      description="It leaves every list and picker. A company that still has contacts is refused — move or delete them first."
      pending={remove.isPending}
      error={remove.error}
      onOpenChange={(open) => {
        if (!open) remove.reset();
        onOpenChange(open);
      }}
      onConfirm={() => {
        if (target === null) return;
        remove.mutate(target.id, {
          onSuccess: () => {
            toast.add({ type: 'success', title: `${target.name} deleted` });
            onDeleted?.();
            onOpenChange(false);
          },
        });
      }}
    />
  );
}

function DeleteRecordDialog({
  kind,
  target,
  description,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  kind: 'contact' | 'company';
  target: DeleteRecordTarget | null;
  description: string;
  pending: boolean;
  error: Error | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const copy = actionErrorCopy(error, `Deleting the ${kind}`);
  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TrashIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{target === null ? `Delete ${kind}` : `Delete ${target.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {error !== null ? (
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
          <AlertDialogAction variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? <Spinner data-icon="inline-start" /> : <TrashIcon data-icon="inline-start" />}
            {pending ? 'Deleting' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
