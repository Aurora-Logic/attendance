import { useState } from 'react';
import { FloppyDiskIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
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
import { TimeField } from '@/features/attendance/pickers';
import { useIsMobile } from '@/hooks/use-mobile';
import { ApiError } from '@/lib/api/client';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';

import { POLICY_FIELDS, type Shift, type ShiftPolicy } from './types';
import { useSaveShift } from './use-shifts';

/**
 * One shift master and its nine policy fields (REQ-C-01).
 *
 * A sheet rather than a page: a shift is nine numbers and four identity
 * fields, which is a form, not a screen, and opening it from the row keeps the
 * list in view behind it. Times go through TimeField - never a native time
 * input, on any screen, for any reason (CLAUDE.md §3).
 */

/**
 * A minutes field.
 *
 * `type="number"` on shadcn's Input, not a slider or a stepper: these are
 * exact policy values a manager types from a written policy document, and
 * every one of them is bounded but not small.
 */
function MinutesField({
  id,
  label,
  help,
  value,
  onValueChange,
}: {
  id: string;
  label: string;
  help: string;
  value: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={1440}
        className="pointer-coarse:h-11 tabular-nums"
        value={String(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          // An emptied field is Number('') === 0, which is a legitimate value
          // for most of these, so it is accepted rather than rejected. NaN is
          // not, and is dropped rather than written into the policy.
          if (!Number.isNaN(next)) onValueChange(next);
        }}
      />
      <FieldDescription>{help}</FieldDescription>
    </Field>
  );
}

interface ShiftSheetProps {
  shift: Shift | null;
  onOpenChange: (open: boolean) => void;
}

export function ShiftSheet({ shift, onOpenChange }: ShiftSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={shift !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-lg max-md:max-h-[90vh]"
      >
        {/* Remounted per shift, so the draft below starts from the row that was
            opened rather than from whichever row was opened first. */}
        {shift ? (
          <ShiftSheetBody key={shift.id} shift={shift} onClose={() => { onOpenChange(false); }} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ShiftSheetBody({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const [draft, setDraft] = useState<Shift>(shift);
  const save = useSaveShift();

  function patchPolicy(key: keyof ShiftPolicy, value: number) {
    setDraft((current) => ({ ...current, policy: { ...current.policy, [key]: value } }));
  }

  function submit() {
    save.mutate(draft, {
      onSuccess: () => {
        // PRD §6.6: the toast repeats the action the button named.
        toast.add({ type: 'success', title: 'Shift saved', description: `${draft.name} updated.` });
        onClose();
      },
      // No onError toast. The failure is rendered inside the sheet, next to
      // the edits it did not save, rather than in a corner the reader has
      // already looked away from.
    });
  }

  return (
    // The sheet's shortcuts take precedence and the screen's are suspended
    // while it is open (technical design §9).
    <ShortcutLayer id={`modal:shift-${shift.id}`}>
      <SaveShortcut onSave={submit} />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>{shift.name}</SheetTitle>
        <SheetDescription>
          Code {shift.code}. These fields decide how every punch on this shift is judged.
        </SheetDescription>
      </SheetHeader>

      {/* min-h-0 is load-bearing: without it this flex child refuses to shrink
          below its content and pushes the footer off the sheet. */}
      <Form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {save.isError ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>
                {save.error instanceof ApiError &&
                (save.error.code === 'NETWORK_ERROR' || save.error.status === 404)
                  ? 'Not saved — the shifts endpoint is not connected yet'
                  : 'Could not save this shift'}
              </AlertTitle>
              <AlertDescription>
                Your edits are still here. Nothing was sent to the server, so nothing changed.
              </AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="shift-name">Name</FieldLabel>
            <Input
              id="shift-name"
              className="pointer-coarse:h-11"
              value={draft.name}
              onChange={(event) => {
                setDraft((current) => ({ ...current, name: event.target.value }));
              }}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="shift-code">Code</FieldLabel>
            <Input
              id="shift-code"
              className="pointer-coarse:h-11"
              value={draft.code}
              onChange={(event) => {
                setDraft((current) => ({ ...current, code: event.target.value }));
              }}
            />
            <FieldDescription>Printed on every report. Unique per organisation.</FieldDescription>
          </Field>

          <FieldSet>
            <FieldLegend>Schedule</FieldLegend>
            <FieldGroup>
              <Field orientation="responsive">
                <FieldLabel>Scheduled in</FieldLabel>
                <TimeField
                  label="Scheduled in"
                  value={draft.scheduledIn}
                  onValueChange={(next) => {
                    setDraft((current) => ({ ...current, scheduledIn: next }));
                  }}
                />
              </Field>
              <Field orientation="responsive">
                <FieldLabel>Scheduled out</FieldLabel>
                <TimeField
                  label="Scheduled out"
                  value={draft.scheduledOut}
                  onValueChange={(next) => {
                    setDraft((current) => ({ ...current, scheduledOut: next }));
                  }}
                />
              </Field>

              <MinutesField
                id="shift-break"
                label="Break minutes"
                help="Subtracted from worked minutes (REQ-E-03)."
                value={draft.breakMinutes}
                onValueChange={(next) => {
                  setDraft((current) => ({ ...current, breakMinutes: next }));
                }}
              />

              <Field orientation="horizontal">
                <FieldLabel htmlFor="shift-crosses">Crosses midnight</FieldLabel>
                <Switch
                  id="shift-crosses"
                  checked={draft.crossesMidnight}
                  onCheckedChange={(next: boolean) => {
                    setDraft((current) => ({ ...current, crossesMidnight: next }));
                  }}
                />
              </Field>
              <FieldDescription>
                REQ-C-02: a night shift is attributed to the date it starts, not the date the OUT
                punch lands on.
              </FieldDescription>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>Policy</FieldLegend>
            <FieldGroup>
              {POLICY_FIELDS.map((field) => (
                <MinutesField
                  key={field.key}
                  id={`shift-${field.key}`}
                  label={field.label}
                  help={field.help}
                  value={draft.policy[field.key]}
                  onValueChange={(next) => {
                    patchPolicy(field.key, next);
                  }}
                />
              ))}
            </FieldGroup>
          </FieldSet>
        </FieldGroup>
      </Form>

      {/* Two short actions fit one row at 360px, so they stay in one row rather
          than stacking into full-width bars that put Save furthest from the
          thumb. */}
      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          Cancel
        </Button>
        <Button className="flex-1 sm:flex-none" disabled={save.isPending} onClick={submit}>
          {save.isPending ? <Spinner data-icon="inline-start" /> : <FloppyDiskIcon data-icon="inline-start" />}
          {save.isPending ? 'Saving' : 'Save'}
          <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
        </Button>
      </SheetFooter>
    </ShortcutLayer>
  );
}

/**
 * Separate so the registration lives inside the layer the sheet pushes.
 * `ShortcutLayer` provides that layer through context, and a hook called in
 * the same component that renders the provider would register into the layer
 * underneath it.
 */
function SaveShortcut({ onSave }: { onSave: () => void }) {
  useShortcut({
    id: 'shift-sheet.save',
    keys: 'ctrl+a',
    label: 'Accept / Save',
    scope: 'modal',
    // PRD §6.4: Ctrl+A saves from any field, so it fires inside inputs too.
    allowInInput: true,
    run: onSave,
  });
  return null;
}
