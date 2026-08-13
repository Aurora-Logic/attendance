import { TrashIcon } from '@phosphor-icons/react';

import { ReasonDialog } from '@/components/shared/reason-dialog';
import { toast } from '@/components/ui/toast';
import type { SoftDeletableEntity } from '@vyuha/shared';

import { MASTER_LABEL, useDeleteMaster } from './use-master-delete';

/**
 * The confirm step for deleting any master (REQ-B-09a, REQ-M-04).
 *
 * One component for all seven kinds, so five screens cannot end up with five
 * slightly different accounts of what a delete does. The reason floor, the
 * disabled button and the server's refusal all come from `ReasonDialog`; what
 * this adds is the copy that is true of a soft delete specifically — the record
 * leaves every list and picker, it does not stop existing, and the reason is
 * the thing the recycle bin will show whoever finds it later.
 *
 * `target` is null when closed, which is also what remounts the body: a reason
 * typed against one row can never be submitted against the next.
 */

export interface DeleteTarget {
  entityType: SoftDeletableEntity;
  id: string;
  name: string;
  /** Extra lines above the reason field: what else this delete takes with it. */
  consequences?: readonly string[];
}

interface DeleteMasterDialogProps {
  target: DeleteTarget | null;
  onOpenChange: (open: boolean) => void;
}

export function DeleteMasterDialog({ target, onOpenChange }: DeleteMasterDialogProps) {
  const remove = useDeleteMaster();
  const label = target === null ? '' : MASTER_LABEL[target.entityType];

  return (
    <ReasonDialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) {
          remove.reset();
          onOpenChange(false);
        }
      }}
      title={target === null ? 'Delete' : `Delete ${label} ${target.name}?`}
      description={
        target === null
          ? ''
          : `It leaves every list and picker it appears in. Nothing is destroyed — it can be put back from the recycle bin.`
      }
      consequences={
        target === null
          ? []
          : [
              ...(target.consequences ?? []),
              'Records that already cite it keep citing it; past reports do not change.',
              'The delete is refused if anything still points at it, and the refusal names what.',
            ]
      }
      prompt="Why is this being deleted?"
      hint="Shown in the recycle bin beside your name, and kept in the audit log."
      confirmLabel="Delete"
      pendingLabel="Deleting"
      confirmIcon={<TrashIcon data-icon="inline-start" />}
      destructive
      pending={remove.isPending}
      error={remove.error}
      onConfirm={(reason) => {
        if (target === null) return;
        remove.mutate(
          { entityType: target.entityType, id: target.id, reason },
          {
            onSuccess: (result) => {
              // PRD §6.6: the toast repeats the action the button named, and
              // says where the record went rather than only that it left.
              toast.add({
                type: 'success',
                title: `${result.name} deleted`,
                description: 'It is in the recycle bin with your reason, and can be restored.',
              });
              onOpenChange(false);
            },
            // No toast and no row removal on failure. The dialog keeps the
            // error — including the list of rows still pointing at this one —
            // because that list is the only thing that says what to do next.
          },
        );
      }}
    />
  );
}
