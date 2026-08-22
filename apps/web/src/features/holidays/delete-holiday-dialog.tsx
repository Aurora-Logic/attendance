import { TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { format, parseISO } from 'date-fns';

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
import { formatDate } from '@/lib/format';

import type { Holiday } from './types';
import { useDeleteHoliday } from './use-holidays';

/**
 * REQ-H-01: removing one dated holiday from a calendar.
 *
 * Deliberately *not* the reason dialog every master delete uses, and the
 * difference is not cosmetic. `DELETE /holidays/:id` takes no body at all — it
 * is a hard delete of a row inside a calendar, not a soft delete into the
 * recycle bin — so a reason field here would collect a sentence the server
 * discards, under a hint claiming it was kept in the audit log. Asking for
 * something and then throwing it away is worse than not asking.
 *
 * What it does keep from the master dialog: it names the record, it says what
 * else changes, it never paints success before the server agreed, and it
 * surfaces the refusal in place rather than in a toast.
 *
 * The mismatch between this and every other delete in the product is worth
 * raising rather than papering over — see the note in the report.
 */

interface DeleteHolidayDialogProps {
  /** The holiday being removed, or null when closed. */
  holiday: Holiday | null;
  calendarName: string;
  onOpenChange: (open: boolean) => void;
}

export function DeleteHolidayDialog({
  holiday,
  calendarName,
  onOpenChange,
}: DeleteHolidayDialogProps) {
  const remove = useDeleteHoliday();
  const copy = actionErrorCopy(remove.error, 'Removing the holiday');

  return (
    <AlertDialog
      open={holiday !== null}
      onOpenChange={(next: boolean) => {
        if (!next) {
          remove.reset();
          onOpenChange(false);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TrashIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {holiday === null ? 'Remove holiday' : `Remove ${holiday.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {holiday === null
              ? ''
              : `${formatDate(holiday.date)}, a ${format(parseISO(holiday.date), 'EEEE')}, leaves ${calendarName}. Everybody on this calendar works that day unless it is a weekly off, and the attendance days it covered are recomputed.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {remove.isError ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>{copy.title}</AlertTitle>
            <AlertDescription>{copy.description} Nothing was removed.</AlertDescription>
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
              if (holiday === null) return;
              remove.mutate(holiday.id, {
                onSuccess: () => {
                  // PRD §6.6: the toast repeats the action the button named.
                  toast.add({
                    type: 'success',
                    title: `${holiday.name} removed`,
                    description: `${formatDate(holiday.date)} is a working day on ${calendarName} again.`,
                  });
                  onOpenChange(false);
                },
                // No toast and no row removal on failure — the dialog stays
                // open holding the reason it did not go through.
              });
            }}
          >
            {remove.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <TrashIcon data-icon="inline-start" />
            )}
            {remove.isPending ? 'Removing' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
