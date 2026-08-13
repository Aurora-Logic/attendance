import { useState } from 'react';
import { WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
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
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { SHIFT_POLICY_DEFAULTS, SHIFT_POLICY_FIELDS } from '@vyuha/shared';

import { rosterErrorCopy } from './roster-error-copy';
import type { Shift, ShiftPolicy } from './types';
import { useCreateShift, useSaveShift, type ShiftDraft } from './use-shifts';

/**
 * One shift master and its nine policy fields (REQ-C-01).
 *
 * A sheet rather than a page: a shift is nine numbers and four identity
 * fields, which is a form, not a screen, and opening it from the row keeps the
 * list in view behind it. Times go through TimeField - never a native time
 * input, on any screen, for any reason (CLAUDE.md section 3).
 *
 * The nine labels and the nine defaults come from `@vyuha/shared`, beside the
 * schema that validates them. A tenth policy field cannot be added to the
 * contract without appearing here.
 */

/** REQ-C-01 has no default timing for the general shift, so a new one starts blank-ish. */
const NEW_SHIFT: ShiftDraft = {
  name: '',
  code: '',
  scheduledIn: '09:00',
  scheduledOut: '18:00',
  breakMinutes: 60,
  crossesMidnight: false,
  policy: SHIFT_POLICY_DEFAULTS,
};

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
  /** The shift being edited, `'new'` to create, or null when closed. */
  shift: Shift | 'new' | null;
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
        {shift === null ? null : (
          <ShiftSheetBody
            key={shift === 'new' ? 'new' : shift.id}
            shift={shift}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ShiftSheetBody({ shift, onClose }: { shift: Shift | 'new'; onClose: () => void }) {
  const existing = shift === 'new' ? null : shift;
  const [draft, setDraft] = useState<ShiftDraft>(() =>
    existing === null
      ? NEW_SHIFT
      : {
          name: existing.name,
          code: existing.code,
          scheduledIn: existing.scheduledIn,
          scheduledOut: existing.scheduledOut,
          breakMinutes: existing.breakMinutes,
          crossesMidnight: existing.crossesMidnight,
          policy: existing.policy,
        },
  );
  const [touched, setTouched] = useState(false);

  const save = useSaveShift();
  const create = useCreateShift();
  const pending = save.isPending || create.isPending;
  const error: unknown = save.error ?? create.error;
  const failed = save.isError || create.isError;

  function patchPolicy(key: keyof ShiftPolicy, value: number) {
    setDraft((current) => ({ ...current, policy: { ...current.policy, [key]: value } }));
  }

  const identityMissing = draft.name.trim() === '' || draft.code.trim() === '';
  /**
   * The two cross-field rules, checked here as well as on the server so the
   * reader is told which field is wrong before a round trip. The server checks
   * them too, and Postgres checks them again -- this is the message, not the
   * enforcement.
   */
  const scheduleReversed = !draft.crossesMidnight && draft.scheduledOut <= draft.scheduledIn;
  const thresholdsInverted = draft.policy.minHalfDayMinutes > draft.policy.minFullDayMinutes;
  const blocked = identityMissing || scheduleReversed || thresholdsInverted;

  function submit() {
    setTouched(true);
    if (blocked) return;

    const body: ShiftDraft = { ...draft, name: draft.name.trim(), code: draft.code.trim() };

    const onSuccess = (saved: Shift) => {
      // PRD section 6.6: the toast repeats the action the button named.
      toast.add({
        type: 'success',
        title: existing === null ? 'Shift created' : 'Shift saved',
        description: `${saved.name} (${saved.code}).`,
      });
      onClose();
    };

    if (existing === null) create.mutate(body, { onSuccess });
    else save.mutate({ ...body, id: existing.id }, { onSuccess });
  }

  return (
    // The sheet's shortcuts take precedence and the screen's are suspended
    // while it is open (technical design section 9).
    <ShortcutLayer id={`modal:shift-${existing?.id ?? 'new'}`}>
      <SaveShortcut onSave={submit} />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>{existing === null ? 'New shift' : existing.name}</SheetTitle>
        <SheetDescription>
          {existing === null
            ? 'These fields decide how every punch on this shift is judged.'
            : `Code ${existing.code}. These fields decide how every punch on this shift is judged.`}
        </SheetDescription>
      </SheetHeader>

      {/* min-h-0 is load-bearing: without it this flex child refuses to shrink
          below its content and pushes the footer off the sheet. */}
      <Form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {failed ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{rosterErrorCopy(error).title}</AlertTitle>
              <AlertDescription>
                {rosterErrorCopy(error).description} Your edits are still here.
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
            {touched && draft.name.trim() === '' ? (
              <FieldDescription>A shift needs a name.</FieldDescription>
            ) : null}
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
            <FieldDescription>
              {touched && draft.code.trim() === ''
                ? 'A shift needs a code; it is what appears on every report.'
                : 'Printed on every report. Unique per organisation.'}
            </FieldDescription>
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

              {scheduleReversed ? (
                <Alert variant="destructive">
                  <WarningCircleIcon />
                  <AlertTitle>This shift ends before it starts</AlertTitle>
                  <AlertDescription>
                    Turn on &quot;crosses midnight&quot; for a night shift, or move the end time
                    later. Left as it is, every punch on this shift would be judged against a
                    window of no length.
                  </AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>Policy</FieldLegend>
            <FieldGroup>
              {SHIFT_POLICY_FIELDS.map((field) => (
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

              {thresholdsInverted ? (
                <Alert variant="destructive">
                  <WarningCircleIcon />
                  <AlertTitle>Half day can never be reached</AlertTitle>
                  <AlertDescription>
                    The minimum half day is above the minimum full day, so no number of worked
                    minutes falls between them.
                  </AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
          </FieldSet>
        </FieldGroup>
      </Form>

      {/* Two short actions fit one row at 360px, so they stay in one row rather
          than stacking into full-width bars that put Save furthest from the
          thumb. */}
      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          Cancel
        </Button>
        <Button className="flex-1 sm:flex-none" disabled={pending} onClick={submit}>
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ACTION_ICONS.save data-icon="inline-start" />
          )}
          {pending ? 'Saving' : 'Save'}
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
    // PRD section 6.4: Ctrl+A saves from any field, so it fires inside inputs too.
    allowInInput: true,
    run: onSave,
  });
  return null;
}
