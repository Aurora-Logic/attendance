import { useState } from 'react';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { z } from 'zod';

import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { toast } from '@/components/ui/toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { LEAVE_ACCRUAL_METHODS, type LeaveAccrualMethod } from '@vyuha/shared';

import { actionErrorCopy } from './api-error-copy';
import { SwitchRow } from './control-row';
import { ACCRUAL_METHOD_LABELS, type LeaveTypePolicy } from './types';
import { useSaveLeaveType } from './use-leave';

/**
 * REQ-G-01: the leave type policy, edited in a Sheet.
 *
 * A sheet rather than a page because the policy list is short and the reader
 * is comparing rows while they edit one — losing the table would cost them the
 * comparison. On a phone it arrives from the bottom edge; on a desktop from
 * the right, where it does not cover the row it came from.
 *
 * There is no rate, amount, or currency field anywhere in this form and there
 * must never be one (NFR-10). `Encashable` is a flag the payroll hand-off
 * reads; the money is calculated in the payroll system, not here.
 */

interface LeaveTypeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null when creating a new type. */
  editing: LeaveTypePolicy | null;
}

interface Draft {
  name: string;
  code: string;
  paid: boolean;
  accrualMethod: LeaveAccrualMethod;
  annualEntitlement: string;
  carryForwardCap: string;
  negativeBalanceLimit: string;
  noticeDays: string;
  halfDayAllowed: boolean;
  encashable: boolean;
  countsSandwichDays: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  code: '',
  paid: true,
  accrualMethod: 'MONTHLY',
  annualEntitlement: '0',
  carryForwardCap: '0',
  negativeBalanceLimit: '0',
  noticeDays: '0',
  halfDayAllowed: true,
  encashable: false,
  countsSandwichDays: false,
};

function draftFrom(policy: LeaveTypePolicy | null): Draft {
  if (!policy) return EMPTY_DRAFT;
  return {
    name: policy.name,
    code: policy.code,
    paid: policy.paid,
    accrualMethod: policy.accrualMethod,
    annualEntitlement: String(policy.annualEntitlement),
    carryForwardCap: String(policy.carryForwardCap),
    negativeBalanceLimit: String(policy.negativeBalanceLimit),
    noticeDays: String(policy.noticeDays),
    halfDayAllowed: policy.halfDayAllowed,
    encashable: policy.encashable,
    countsSandwichDays: policy.countsSandwichDays,
  };
}

/**
 * Numbers arrive from the inputs as strings, including the empty string
 * somebody leaves behind while retyping a value. `z.coerce.number()` would
 * read "" as 0 and silently accept it, so the check is explicit.
 */
const days = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
      message: `${label} must be zero or more.`,
    });

const draftSchema = z.object({
  name: z.string().trim().min(1, 'A name is required.').max(60),
  code: z
    .string()
    .trim()
    .min(1, 'A code is required.')
    .max(10)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, hyphen and underscore only.'),
  accrualMethod: z.enum(LEAVE_ACCRUAL_METHODS),
  annualEntitlement: days('Annual entitlement'),
  carryForwardCap: days('Carry-forward cap'),
  negativeBalanceLimit: days('Negative limit'),
  noticeDays: days('Notice days'),
});

type FieldErrors = Partial<Record<keyof z.infer<typeof draftSchema>, string>>;

export function LeaveTypeSheet({ open, onOpenChange, editing }: LeaveTypeSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 max-md:max-h-[90vh] md:w-full md:sm:max-w-md"
      >
        {/* Mounted only while open, and keyed on the row, so the draft is
            filled from the record it is editing at the moment it appears. An
            effect that copied the row in afterwards would render one frame of
            the previous type's values — and on a form of policy numbers that
            frame is indistinguishable from real data. */}
        {open ? (
          <LeaveTypeForm
            key={editing?.id ?? 'new'}
            editing={editing}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function LeaveTypeForm({
  editing,
  onClose,
}: {
  editing: LeaveTypePolicy | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(editing));
  const [attempted, setAttempted] = useState(false);
  const save = useSaveLeaveType();

  const parsed = draftSchema.safeParse(draft);
  const errors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !(key in errors)) {
        errors[key as keyof FieldErrors] = issue.message;
      }
    }
  }

  function submit() {
    setAttempted(true);
    if (!parsed.success) return;

    save.mutate(
      {
        id: editing?.id ?? null,
        name: parsed.data.name,
        code: parsed.data.code.toUpperCase(),
        paid: draft.paid,
        accrualMethod: parsed.data.accrualMethod,
        annualEntitlement: Number(parsed.data.annualEntitlement),
        carryForwardCap: Number(parsed.data.carryForwardCap),
        negativeBalanceLimit: Number(parsed.data.negativeBalanceLimit),
        noticeDays: Number(parsed.data.noticeDays),
        halfDayAllowed: draft.halfDayAllowed,
        encashable: draft.encashable,
        countsSandwichDays: draft.countsSandwichDays,
      },
      {
        onSuccess: () => {
          toast.add({
            type: 'success',
            title: editing ? 'Leave type saved' : 'Leave type created',
          });
          onClose();
        },
        onError: (error) => {
          const copy = actionErrorCopy(error, editing ? 'Save leave type' : 'Create leave type');
          toast.add({ type: 'error', title: copy.title, description: copy.description });
        },
      },
    );
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    // A modal's shortcuts take precedence and the screen's are suspended
    // (PRD §6.4), which is what stops Ctrl+A here from also firing the
    // apply-for-leave shortcut on a screen underneath.
    <ShortcutLayer id="modal:leave-type">
      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>{editing ? editing.name : 'New leave type'}</SheetTitle>
        <SheetDescription>
          {editing
            ? 'Changes apply to future applications; balances already posted are not recalculated.'
            : 'Define the policy. Balances start once the type is saved.'}
        </SheetDescription>
      </SheetHeader>

      <Form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              {/* min-h-0 is load-bearing: without it this band refuses to
                  shrink below its content and pushes the footer off screen. */}
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <FieldGroup>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field data-invalid={attempted && errors.name ? true : undefined}>
                      <FieldLabel htmlFor="lt-name">Name</FieldLabel>
                      <Input
                        id="lt-name"
                        value={draft.name}
                        maxLength={60}
                        placeholder="Casual Leave"
                        aria-invalid={attempted && Boolean(errors.name)}
                        className="pointer-coarse:h-11"
                        onChange={(event) => {
                          set('name', event.target.value);
                        }}
                      />
                      {attempted ? <FieldError>{errors.name}</FieldError> : null}
                    </Field>

                    <Field data-invalid={attempted && errors.code ? true : undefined}>
                      <FieldLabel htmlFor="lt-code">Code</FieldLabel>
                      <Input
                        id="lt-code"
                        value={draft.code}
                        maxLength={10}
                        placeholder="CL"
                        autoCapitalize="characters"
                        aria-invalid={attempted && Boolean(errors.code)}
                        className="pointer-coarse:h-11 uppercase"
                        onChange={(event) => {
                          set('code', event.target.value);
                        }}
                      />
                      <FieldDescription>Shown on registers and exports.</FieldDescription>
                      {attempted ? <FieldError>{errors.code}</FieldError> : null}
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="lt-accrual">Accrual method</FieldLabel>
                    <Select
                      value={draft.accrualMethod}
                      onValueChange={(next: string | null) => {
                        if (next !== null) set('accrualMethod', next as LeaveAccrualMethod);
                      }}
                    >
                      <SelectTrigger id="lt-accrual" className="w-full pointer-coarse:h-11">
                        <SelectValue>
                          {(value: string) => ACCRUAL_METHOD_LABELS[value as LeaveAccrualMethod]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {LEAVE_ACCRUAL_METHODS.map((method) => (
                            <SelectItem key={method} value={method}>
                              {ACCRUAL_METHOD_LABELS[method]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      How the entitlement is credited through the leave year (REQ-G-05 pro-rates it
                      for mid-year joiners).
                    </FieldDescription>
                  </Field>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field data-invalid={attempted && errors.annualEntitlement ? true : undefined}>
                      <FieldLabel htmlFor="lt-entitlement">Annual entitlement</FieldLabel>
                      <Input
                        id="lt-entitlement"
                        type="number"
                        min={0}
                        step={0.5}
                        inputMode="decimal"
                        value={draft.annualEntitlement}
                        aria-invalid={attempted && Boolean(errors.annualEntitlement)}
                        className="pointer-coarse:h-11 tabular-nums"
                        onChange={(event) => {
                          set('annualEntitlement', event.target.value);
                        }}
                      />
                      <FieldDescription>Days per leave year.</FieldDescription>
                      {attempted ? <FieldError>{errors.annualEntitlement}</FieldError> : null}
                    </Field>

                    <Field data-invalid={attempted && errors.carryForwardCap ? true : undefined}>
                      <FieldLabel htmlFor="lt-carry">Carry-forward cap</FieldLabel>
                      <Input
                        id="lt-carry"
                        type="number"
                        min={0}
                        step={0.5}
                        inputMode="decimal"
                        value={draft.carryForwardCap}
                        aria-invalid={attempted && Boolean(errors.carryForwardCap)}
                        className="pointer-coarse:h-11 tabular-nums"
                        onChange={(event) => {
                          set('carryForwardCap', event.target.value);
                        }}
                      />
                      <FieldDescription>Zero means nothing carries forward.</FieldDescription>
                      {attempted ? <FieldError>{errors.carryForwardCap}</FieldError> : null}
                    </Field>

                    <Field data-invalid={attempted && errors.negativeBalanceLimit ? true : undefined}>
                      <FieldLabel htmlFor="lt-negative">Negative limit</FieldLabel>
                      <Input
                        id="lt-negative"
                        type="number"
                        min={0}
                        step={0.5}
                        inputMode="decimal"
                        value={draft.negativeBalanceLimit}
                        aria-invalid={attempted && Boolean(errors.negativeBalanceLimit)}
                        className="pointer-coarse:h-11 tabular-nums"
                        onChange={(event) => {
                          set('negativeBalanceLimit', event.target.value);
                        }}
                      />
                      <FieldDescription>
                        REQ-G-08: how far a balance may go below zero. Zero disallows it.
                      </FieldDescription>
                      {attempted ? <FieldError>{errors.negativeBalanceLimit}</FieldError> : null}
                    </Field>

                    <Field data-invalid={attempted && errors.noticeDays ? true : undefined}>
                      <FieldLabel htmlFor="lt-notice">Notice days</FieldLabel>
                      <Input
                        id="lt-notice"
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={draft.noticeDays}
                        aria-invalid={attempted && Boolean(errors.noticeDays)}
                        className="pointer-coarse:h-11 tabular-nums"
                        onChange={(event) => {
                          set('noticeDays', event.target.value);
                        }}
                      />
                      <FieldDescription>Days of warning an application should give.</FieldDescription>
                      {attempted ? <FieldError>{errors.noticeDays}</FieldError> : null}
                    </Field>
                  </div>

                  <FieldSet>
                    <FieldLegend variant="label">Rules</FieldLegend>
                    <div className="flex flex-col gap-1">
                      <SwitchRow
                        id="lt-paid"
                        label="Paid leave"
                        description="Unpaid types still record attendance; no amount is held here."
                        checked={draft.paid}
                        onCheckedChange={(value) => {
                          set('paid', value);
                        }}
                      />
                      <SwitchRow
                        id="lt-half"
                        label="Half day allowed"
                        description="Lets an application take half of a boundary day."
                        checked={draft.halfDayAllowed}
                        onCheckedChange={(value) => {
                          set('halfDayAllowed', value);
                        }}
                      />
                      <SwitchRow
                        id="lt-sandwich"
                        label="Counts sandwich days"
                        description="Holidays and weekly offs inside a range are consumed too."
                        checked={draft.countsSandwichDays}
                        onCheckedChange={(value) => {
                          set('countsSandwichDays', value);
                        }}
                      />
                      <SwitchRow
                        id="lt-encashable"
                        label="Encashable"
                        description="Informational only. Encashment is calculated in payroll, never here."
                        checked={draft.encashable}
                        onCheckedChange={(value) => {
                          set('encashable', value);
                        }}
                      />
                    </div>
                  </FieldSet>
                </FieldGroup>
              </div>

              {/* One row, not the stacked default: three short actions fit at
                  360px, and stacking reverses them so the primary lands
                  furthest from the thumb. */}
              <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  disabled={save.isPending}
                  onClick={onClose}
                >
                  <XIcon data-icon="inline-start" />
                  Cancel
                  <ShortcutHint keys="ctrl+q" className="ml-1 hidden md:inline-flex" />
                </Button>
                <Button type="submit" className="flex-1 sm:flex-none" disabled={save.isPending}>
                  {save.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CheckIcon data-icon="inline-start" />
                  )}
                  Save
                  <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
                </Button>
              </SheetFooter>

              <SheetShortcuts onSave={submit} onQuit={onClose} />
      </Form>
    </ShortcutLayer>
  );
}

/**
 * The two Tally keys the sheet answers to, registered from a child so they
 * unregister with the sheet rather than with the page. Renders nothing: it
 * exists because hooks cannot be called conditionally, and these two must not
 * be registered while the sheet is closed.
 */
function SheetShortcuts({ onSave, onQuit }: { onSave: () => void; onQuit: () => void }) {
  useShortcut({
    id: 'leave-type.save',
    keys: 'ctrl+a',
    label: 'Accept / Save',
    scope: 'modal',
    run: onSave,
  });
  useShortcut({
    id: 'leave-type.quit',
    keys: 'ctrl+q',
    label: 'Quit without saving',
    scope: 'modal',
    run: onQuit,
  });
  return null;
}
