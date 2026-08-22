import { useState } from 'react';
import { ArrowCounterClockwiseIcon, UserMinusIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { parseISO } from 'date-fns';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { toDateParam } from '@/features/attendance/format';
import {
  DateField,
  EMPLOYEE_DATE_YEARS_BACK,
  EMPLOYEE_DATE_YEARS_FORWARD,
} from '@/features/attendance/pickers';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { formatDate } from '@/lib/format';
import { employeeDisplayName, type EmployeeListItem } from '@vyuha/shared';

import { useChangeEmployeeLifecycle } from './use-employee-mutations';

/**
 * REQ-A-05: "activate, place on notice, deactivate with last working date".
 *
 * This is deliberately not a delete, and the copy never calls it one. There is
 * no `DELETE /employees/:id` and there should not be: a person's punches, leave
 * and report rows are the record the product exists to defend, and a delete
 * would either destroy them or leave orphans. Retiring keeps all of it and
 * stops the punching, which is what anybody reaching for "delete" on an
 * employee actually means.
 *
 * The last working date is the whole point of the dialog. The server refuses
 * INACTIVE without one and refuses ACTIVE with one, so the two travel together
 * in a single PATCH and the reader is asked for the date before the press
 * rather than told about it in a 400 afterwards.
 */

export type LifecycleMode = 'retire' | 'notice' | 'reactivate';

export interface LifecycleTarget {
  mode: LifecycleMode;
  employee: EmployeeListItem;
}

interface LifecycleDialogProps {
  target: LifecycleTarget | null;
  onOpenChange: (open: boolean) => void;
}

export function EmployeeLifecycleDialog({ target, onOpenChange }: LifecycleDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remounted per record, so a date picked for one person can never be
            submitted against the next one somebody opens. */}
        {target === null ? null : (
          <LifecycleBody
            key={`${target.employee.id}:${target.mode}`}
            target={target}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LifecycleBody({ target, onClose }: { target: LifecycleTarget; onClose: () => void }) {
  const { mode, employee } = target;
  const name = employeeDisplayName(employee.firstName, employee.lastName);

  const change = useChangeEmployeeLifecycle();
  const [lastDay, setLastDay] = useState<Date>(() =>
    employee.dateOfLeaving === null ? new Date() : parseISO(employee.dateOfLeaving),
  );

  // The server refuses a last day before the joining date; saying so here means
  // the reader sees it against the calendar rather than after a round trip.
  const beforeJoining = toDateParam(lastDay) < employee.dateOfJoining;

  const copy = actionErrorCopy(
    change.error,
    mode === 'reactivate' ? 'Reactivating the employee' : 'Changing the status',
  );

  function confirm() {
    if (mode !== 'reactivate' && beforeJoining) return;

    change.mutate(
      mode === 'reactivate'
        ? { id: employee.id, status: 'ACTIVE', dateOfLeaving: null }
        : {
            id: employee.id,
            status: mode === 'retire' ? 'INACTIVE' : 'ON_NOTICE',
            dateOfLeaving: toDateParam(lastDay),
          },
      {
        onSuccess: () => {
          // PRD §6.6: the toast repeats the action the button named.
          toast.add({
            type: 'success',
            title:
              mode === 'retire'
                ? `${name} retired`
                : mode === 'notice'
                  ? `${name} is on notice`
                  : `${name} reactivated`,
            description:
              mode === 'reactivate'
                ? 'They can punch again from today, and the last working date is cleared.'
                : `Last working date ${formatDate(toDateParam(lastDay))}. Their history is kept and still appears in past reports.`,
          });
          onClose();
        },
        // No toast and no row change on failure. The dialog keeps the error,
        // because a record that did not move must not look as though it did.
      },
    );
  }

  const title =
    mode === 'retire'
      ? `Retire ${name}?`
      : mode === 'notice'
        ? `Put ${name} on notice?`
        : `Reactivate ${name}?`;

  const description =
    mode === 'retire'
      ? 'They stop being able to punch from the day after their last working date. Nothing is deleted.'
      : mode === 'notice'
        ? 'They carry on working and punching. This only marks the record so managers can see it coming.'
        : 'The last working date is cleared and they can punch again.';

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      {/* The consequences sit above the field, not below it: somebody who reads
          only the title and then looks for the input should have passed them on
          the way. */}
      <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
        {mode === 'reactivate' ? (
          <>
            <li>Their punches, leave and attendance days are untouched.</li>
            <li>They reappear in every picker that offers active employees.</li>
          </>
        ) : (
          <>
            <li>Every punch, leave request and attendance day they already have is kept.</li>
            <li>They keep appearing in reports that cover dates they worked.</li>
            <li>
              {mode === 'retire'
                ? 'They disappear from the rostering and reporting-manager pickers, which offer active people only.'
                : 'They stay in every picker; on notice is a flag, not a removal.'}
            </li>
          </>
        )}
      </ul>

      {change.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>{copy.title}</AlertTitle>
          <AlertDescription>{copy.description} Nothing was changed.</AlertDescription>
        </Alert>
      ) : null}

      {mode === 'reactivate' ? null : (
        <Field>
          <FieldLabel>Last working date</FieldLabel>
          <DateField
            label="Last working date"
            value={lastDay}
            onValueChange={setLastDay}
            // A last working date can be back-dated to when somebody actually
            // left, or set ahead for a notice period, so it needs the same
            // reach as a joining date rather than the default two years.
            yearsBack={EMPLOYEE_DATE_YEARS_BACK}
            yearsForward={EMPLOYEE_DATE_YEARS_FORWARD}
            className="w-full"
          />
          <FieldDescription>
            {beforeJoining
              ? `That is before they joined on ${formatDate(employee.dateOfJoining)}. The server refuses it.`
              : `They joined on ${formatDate(employee.dateOfJoining)}. Punches after the last working date are refused.`}
          </FieldDescription>
        </Field>
      )}

      {/* Two short actions fit one row at 360px, so they stay in one row rather
          than stacking and putting the confirm furthest from the thumb. */}
      <DialogFooter className="flex-row justify-end gap-2">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          Cancel
        </Button>
        <Button
          variant={mode === 'reactivate' ? 'default' : 'destructive'}
          className="flex-1 sm:flex-none"
          disabled={change.isPending || (mode !== 'reactivate' && beforeJoining)}
          onClick={confirm}
        >
          {change.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : mode === 'reactivate' ? (
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
          ) : (
            <UserMinusIcon data-icon="inline-start" />
          )}
          {change.isPending
            ? 'Saving'
            : mode === 'retire'
              ? 'Retire'
              : mode === 'notice'
                ? 'Put on notice'
                : 'Reactivate'}
        </Button>
      </DialogFooter>

      {/* Deliberately last and deliberately plain. Somebody who came here
          looking for "delete" should leave knowing why there is not one. */}
      <p className="text-muted-foreground text-xs">
        There is no delete for an employee, by design. The record is what makes past
        attendance defensible, so it is retired rather than removed.
      </p>
    </>
  );
}
