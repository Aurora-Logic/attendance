import { useState } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
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
import { toast } from '@/components/ui/toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';

import { apiErrorCopy } from '@/features/leave/api-error-copy';
import type { CalendarDraft } from './drafts';
import { useSaveCalendar } from './use-holidays';

/**
 * One holiday calendar: its name, its year, and REQ-H-03's allowance.
 *
 * A sheet rather than a page, for the same reason the shift master uses one --
 * three fields are a form, not a screen, and the calendar being edited stays
 * visible behind it.
 *
 * The year is entered only when the calendar is created. It is half of the
 * calendar's identity: every holiday in the list was filed against it, and the
 * server refuses to move it rather than silently re-dating a year's work.
 */

interface CalendarSheetProps {
  draft: CalendarDraft | null;
  onOpenChange: (open: boolean) => void;
}

export function CalendarSheet({ draft, onOpenChange }: CalendarSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={draft !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-md max-md:max-h-[90vh]"
      >
        {/* Remounted per calendar, so the draft starts from the row that was
            opened rather than from whichever row was opened first. */}
        {draft ? (
          <CalendarSheetBody
            key={draft.id ?? 'new'}
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

function CalendarSheetBody({
  initial,
  onClose,
}: {
  initial: CalendarDraft;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CalendarDraft>(initial);
  const save = useSaveCalendar();
  const isNew = initial.id === undefined;

  function submit() {
    if (draft.name.trim().length === 0) return;
    save.mutate(draft, {
      onSuccess: (saved) => {
        toast.add({
          type: 'success',
          title: isNew ? 'Calendar created' : 'Calendar saved',
          description: `${saved.name} · ${String(saved.year)}`,
        });
        onClose();
      },
    });
  }

  const copy = apiErrorCopy(save.error, {
    subject: 'holiday calendar',
    permission: 'holiday.manage',
  });

  return (
    <ShortcutLayer id={`modal:holiday-calendar-${initial.id ?? 'new'}`}>
      <SaveShortcut onSave={submit} />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>{isNew ? 'New holiday calendar' : initial.name}</SheetTitle>
        <SheetDescription>
          A named list of dated holidays for one year. Locations point at it, and employees inherit
          it from their location.
        </SheetDescription>
      </SheetHeader>

      {/* min-h-0 is load-bearing: without it this flex child refuses to shrink
          below its content and pushes the footer off the sheet. */}
      <Form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {save.isError ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>
                {copy.description} Your edits are still here.
              </AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="calendar-name">Name</FieldLabel>
            <Input
              id="calendar-name"
              autoFocus
              value={draft.name}
              onChange={(event) => {
                setDraft((current) => ({ ...current, name: event.target.value }));
              }}
            />
            <FieldDescription>
              How it is chosen on this screen and on an employee record, for example
              &ldquo;Maharashtra&rdquo;.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="calendar-year">Year</FieldLabel>
            <Input
              id="calendar-year"
              type="number"
              inputMode="numeric"
              min={2000}
              max={2100}
              disabled={!isNew}
              className="tabular-nums"
              value={String(draft.year)}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isNaN(next)) setDraft((current) => ({ ...current, year: next }));
              }}
            />
            <FieldDescription>
              {isNew
                ? 'One calendar per year. Next year is a new calendar, not an edit of this one.'
                : 'Fixed once the calendar exists, because every date in it was entered against this year.'}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="calendar-allowance">Restricted holidays per employee</FieldLabel>
            <Input
              id="calendar-allowance"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              className="tabular-nums"
              value={String(draft.restrictedAllowance)}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isNaN(next)) {
                  setDraft((current) => ({ ...current, restrictedAllowance: next }));
                }
              }}
            />
            <FieldDescription>
              Zero means this calendar does not offer restricted holidays; a restricted
              date then counts as an ordinary working day for everyone.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </Form>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          Cancel
        </Button>
        <Button
          className="flex-1 sm:flex-none"
          disabled={save.isPending || draft.name.trim().length === 0}
          onClick={submit}
        >
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
 * Separate so the registration lives inside the layer the sheet pushes.
 * `ShortcutLayer` provides that layer through context, and a hook called in the
 * same component that renders the provider would register into the layer
 * underneath it.
 */
function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({
    id: 'holiday-calendar-sheet.save',
    keys: 'ctrl+a',
    label: 'Accept / Save',
    scope: 'modal',
    // PRD §6.4: Ctrl+A saves from any field, so it fires inside inputs too.
    allowInInput: true,
    run: onSave,
  });
  return null;
}
