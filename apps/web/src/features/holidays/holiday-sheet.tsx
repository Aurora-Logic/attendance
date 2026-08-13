import { useState } from 'react';
import { FloppyDiskIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { DateField } from '@/features/attendance/pickers';
import { fromDateParam, toDateParam } from '@/features/attendance/format';
import { actionErrorCopy } from '@/features/leave/api-error-copy';
import { useIsMobile } from '@/hooks/use-mobile';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';

import type { HolidayDraft } from './drafts';
import { useDeleteHoliday, useSaveHoliday } from './use-holidays';

/**
 * One dated holiday (REQ-H-01), added to or edited inside a calendar.
 *
 * The date goes through `DateField`, which is the shadcn Calendar in a Popover
 * on a desktop and a bottom Sheet on a phone. There is no `<input type="date">`
 * here or anywhere else in this app (CLAUDE.md §3).
 *
 * Saving is not the end of the story: the server recomputes every affected
 * attendance day (REQ-H-04), so the toast says so rather than reporting a
 * write that quietly did more than the reader asked for.
 */

interface HolidaySheetProps {
  draft: HolidayDraft | null;
  onOpenChange: (open: boolean) => void;
}

export function HolidaySheet({ draft, onOpenChange }: HolidaySheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={draft !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-md max-md:max-h-[90vh]"
      >
        {draft ? (
          <HolidaySheetBody
            key={draft.id ?? `new-${draft.date}`}
            initial={draft}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function HolidaySheetBody({ initial, onClose }: { initial: HolidayDraft; onClose: () => void }) {
  const [draft, setDraft] = useState<HolidayDraft>(initial);
  const save = useSaveHoliday();
  const remove = useDeleteHoliday();
  const isNew = initial.id === undefined;
  const pending = save.isPending || remove.isPending;

  function submit() {
    if (draft.name.trim().length === 0) return;
    save.mutate(draft, {
      onSuccess: (saved) => {
        toast.add({
          type: 'success',
          title: isNew ? 'Holiday added' : 'Holiday saved',
          // REQ-H-04. Said out loud because it changed rows the reader is not
          // looking at, and a silent recompute is a surprise later.
          description: `${saved.name}. Affected attendance days were recomputed.`,
        });
        onClose();
      },
      // No onError toast: the failure is rendered inside the sheet, next to
      // the edits it did not save.
    });
  }

  function destroy() {
    const id = initial.id;
    if (id === undefined) return;
    remove.mutate(id, {
      onSuccess: () => {
        toast.add({
          type: 'success',
          title: 'Holiday removed',
          description: `${initial.name}. Affected attendance days were recomputed.`,
        });
        onClose();
      },
    });
  }

  const failure = save.error ?? remove.error;
  const copy = actionErrorCopy(failure, save.error ? 'Saving the holiday' : 'Removing the holiday');

  return (
    <ShortcutLayer id={`modal:holiday-${initial.id ?? 'new'}`}>
      <SaveShortcut onSave={submit} />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>{isNew ? 'Add a holiday' : initial.name}</SheetTitle>
        <SheetDescription>
          A date in {String(initial.year)}. Changing it recomputes every attendance day it touches,
          except in a locked period.
        </SheetDescription>
      </SheetHeader>

      <Form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {failure ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>{copy.description}</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="holiday-name">Name</FieldLabel>
            <Input
              id="holiday-name"
              autoFocus
              className="pointer-coarse:h-11"
              value={draft.name}
              onChange={(event) => {
                setDraft((current) => ({ ...current, name: event.target.value }));
              }}
            />
          </Field>

          <Field orientation="responsive">
            <FieldLabel>Date</FieldLabel>
            <DateField
              label="Holiday date"
              value={fromDateParam(draft.date)}
              onValueChange={(next) => {
                setDraft((current) => ({ ...current, date: toDateParam(next) }));
              }}
              // The calendar covers one year, so a date outside it is not a
              // holiday this list can hold. Disabled here and refused by the
              // server; the reader never reaches the refusal.
              disabled={(date) => date.getFullYear() !== initial.year}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="holiday-restricted">Restricted</FieldLabel>
            <Switch
              id="holiday-restricted"
              checked={draft.restricted}
              onCheckedChange={(next: boolean) => {
                setDraft((current) => ({ ...current, restricted: next }));
              }}
            />
          </Field>
          <FieldDescription>
            REQ-H-03: a restricted day is a holiday only for the employees who elect it, and each
            election spends one of the calendar&rsquo;s allowance.
          </FieldDescription>
        </FieldGroup>
      </Form>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t">
        {isNew ? null : (
          <Button
            variant="outline"
            className="mr-auto"
            disabled={pending}
            onClick={destroy}
            aria-label={`Remove ${initial.name}`}
          >
            <TrashIcon data-icon="inline-start" />
            Remove
          </Button>
        )}
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="flex-1 sm:flex-none"
          disabled={pending || draft.name.trim().length === 0}
          onClick={submit}
        >
          {save.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <FloppyDiskIcon data-icon="inline-start" />
          )}
          {save.isPending ? 'Saving' : 'Save'}
          <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
        </Button>
      </SheetFooter>
    </ShortcutLayer>
  );
}

function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({
    id: 'holiday-sheet.save',
    keys: 'ctrl+a',
    label: 'Accept / Save',
    scope: 'modal',
    allowInInput: true,
    run: onSave,
  });
  return null;
}
