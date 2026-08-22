import { useState } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { parseISO } from 'date-fns';
import type { DateRange } from 'react-day-picker';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { toDateParam } from '@/features/attendance/format';
import { DateRangeField } from '@/features/attendance/pickers';
import { useIsMobile } from '@/hooks/use-mobile';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';

import { rosterErrorCopy } from './roster-error-copy';
import type { RosterEntry, Shift } from './types';
import { useUpdateRosterAssignment } from './use-shifts';

/**
 * An existing roster row, changed (REQ-C-04).
 *
 * A second sheet rather than a mode on the assign sheet, because the two forms
 * are not the same form: this one cannot move the assignment to somebody else
 * and does not need an employee picker at all, and folding both into one would
 * mean a disabled control on every edit explaining a rule the reader never
 * tried to break.
 *
 * Dates go through `DateRangeField` and never a native date input, on any
 * screen, for any reason (CLAUDE.md §3).
 */

interface RosterEditSheetProps {
  /** The assignment being changed, or null when closed. */
  entry: RosterEntry | null;
  onOpenChange: (open: boolean) => void;
  shifts: readonly Shift[];
}

export function RosterEditSheet({ entry, onOpenChange, shifts }: RosterEditSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-lg max-md:max-h-[90vh]"
      >
        {/* Remounted per assignment, so the draft starts from the row that was
            opened rather than from whichever row was opened first. */}
        {entry === null ? null : (
          <RosterEditBody
            key={entry.id}
            entry={entry}
            shifts={shifts}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function RosterEditBody({
  entry,
  shifts,
  onClose,
}: {
  entry: RosterEntry;
  shifts: readonly Shift[];
  onClose: () => void;
}) {
  const save = useUpdateRosterAssignment();

  const [shiftId, setShiftId] = useState(entry.shift.id);
  const [period, setPeriod] = useState<DateRange>(() => ({
    from: parseISO(entry.from),
    to: entry.to === null ? parseISO(entry.from) : parseISO(entry.to),
  }));
  const [openEnded, setOpenEnded] = useState(entry.to === null);

  function submit() {
    if (!period.from) return;
    save.mutate(
      {
        id: entry.id,
        shiftId,
        from: toDateParam(period.from),
        to: openEnded ? null : toDateParam(period.to ?? period.from),
      },
      {
        onSuccess: (saved) => {
          // PRD §6.6: the toast repeats the action the button named.
          toast.add({
            type: 'success',
            title: 'Assignment saved',
            description: `${saved.employee.name} is on ${saved.shift.name} from ${saved.from}.`,
          });
          onClose();
        },
        // No error toast. The failure — usually an overlap with another
        // assignment — is rendered beside the dates that caused it rather than
        // in a corner the reader has already looked away from.
      },
    );
  }

  const copy = rosterErrorCopy(save.error);

  return (
    <ShortcutLayer id={`modal:roster-edit-${entry.id}`}>
      <SaveShortcut onSave={submit} />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>{entry.employee.name}</SheetTitle>
        <SheetDescription>
          {entry.employee.employeeCode}. Changing the shift or the dates recomputes the attendance
          days this assignment covers, unless the period is locked.
        </SheetDescription>
      </SheetHeader>

      <Form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {save.isError ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>{copy.description} Your edits are still here.</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel>Shift</FieldLabel>
            <Select
              value={shiftId}
              onValueChange={(next: string | null) => {
                if (next !== null) setShiftId(next);
              }}
            >
              <SelectTrigger aria-label="Shift" className="w-full">
                <SelectValue>
                  {(value: string) => {
                    const shift = shifts.find((row) => row.id === value);
                    return shift
                      ? `${shift.name} · ${shift.scheduledIn}–${shift.scheduledOut}`
                      : entry.shift.name;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {shifts.map((shift) => (
                    <SelectItem key={shift.id} value={shift.id}>
                      {shift.name} · {shift.scheduledIn}–{shift.scheduledOut}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Period</FieldLabel>
            <DateRangeField
              value={period}
              onValueChange={setPeriod}
              label="Assignment period"
              className="w-full"
            />
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="roster-edit-open-ended">Open-ended</FieldLabel>
            <Switch
              id="roster-edit-open-ended"
              checked={openEnded}
              onCheckedChange={setOpenEnded}
            />
          </Field>
          <FieldDescription>
            An open-ended assignment has no end date and runs until a later one supersedes it. The
            end date above is ignored while this is on.
          </FieldDescription>

          <FieldDescription>
            There is no delete for a roster row: the server has no such route. End the assignment by
            setting its last date instead, which is what a person actually means by removing one.
          </FieldDescription>
        </FieldGroup>
      </Form>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          Cancel
        </Button>
        <Button className="flex-1 sm:flex-none" disabled={save.isPending} onClick={submit}>
          {save.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ACTION_ICONS.save data-icon="inline-start" />
          )}
          {save.isPending ? 'Saving' : 'Save'}
          <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
        </Button>
      </SheetFooter>
    </ShortcutLayer>
  );
}

/**
 * Separate so the registration lands inside the layer the sheet pushes. A hook
 * called in the component that renders the provider would register into the
 * layer underneath it.
 */
function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({
    id: 'roster-edit-sheet.save',
    keys: 'ctrl+a',
    label: 'Accept / Save',
    scope: 'modal',
    // PRD §6.4: Ctrl+A saves from any field, so it fires inside inputs too.
    allowInInput: true,
    run: onSave,
  });
  return null;
}
