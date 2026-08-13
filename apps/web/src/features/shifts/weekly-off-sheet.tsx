import { useState } from 'react';
import { FloppyDiskIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useIsMobile } from '@/hooks/use-mobile';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import { ISO_WEEKDAY_LABELS, describeWeeklyOffPattern } from '@vyuha/shared';

import { rosterErrorCopy } from './roster-error-copy';
import type { WeeklyOffConfig, WeeklyOffPattern } from './types';
import { useSaveWeeklyOffPattern } from './use-shifts';

/**
 * A weekly-off rule (REQ-C-03), as 05-decisions describes it: "Admin ticks the
 * off days, alternate-Saturday rule as a toggle, per-person override
 * available. Nothing hardcoded."
 *
 * So: seven checkboxes and one switch, and the sentence the rule produces is
 * printed underneath as it is edited. That sentence comes from
 * `describeWeeklyOffPattern` in the contract package, which is the same
 * function the table uses -- a rule that reads one way in the form and another
 * in the list is a rule nobody trusts.
 */

/** Monday first, matching how a week is written on a roster. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7] as const;
const SATURDAY = 6;
const ALTERNATE_SATURDAYS = [2, 4];

interface WeeklyOffSheetProps {
  /** The pattern being edited, `'new'` to create, or null when closed. */
  pattern: WeeklyOffPattern | 'new' | null;
  onOpenChange: (open: boolean) => void;
}

export function WeeklyOffSheet({ pattern, onOpenChange }: WeeklyOffSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={pattern !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-lg max-md:max-h-[90vh]"
      >
        {/* Remounted per pattern, so the draft starts from the row that was
            opened rather than from whichever row was opened first. */}
        {pattern === null ? null : (
          <WeeklyOffSheetBody
            key={pattern === 'new' ? 'new' : pattern.id}
            pattern={pattern}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function WeeklyOffSheetBody({
  pattern,
  onClose,
}: {
  pattern: WeeklyOffPattern | 'new';
  onClose: () => void;
}) {
  const existing = pattern === 'new' ? null : pattern;
  const save = useSaveWeeklyOffPattern();

  const [name, setName] = useState(existing?.name ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(() => [...(existing?.config.weekdays ?? [7])]);
  const [alternateSaturdays, setAlternateSaturdays] = useState(
    () => (existing?.config.saturdaysOfMonth?.length ?? 0) > 0,
  );
  const [touched, setTouched] = useState(false);

  const config: WeeklyOffConfig = {
    weekdays: [...weekdays].sort((left, right) => left - right),
    ...(alternateSaturdays ? { saturdaysOfMonth: ALTERNATE_SATURDAYS } : {}),
  };

  const nameMissing = name.trim().length === 0;
  // Both rules naming Saturday is not an error, but it is almost never what
  // somebody means: the weekday tick already makes every Saturday off, so the
  // alternate rule can only narrow nothing.
  const saturdayStated = weekdays.includes(SATURDAY) && alternateSaturdays;

  function submit() {
    setTouched(true);
    if (nameMissing) return;

    save.mutate(
      { id: existing?.id ?? null, name: name.trim(), config },
      {
        onSuccess: (saved) => {
          toast.add({
            type: 'success',
            title: existing === null ? 'Pattern created' : 'Pattern saved',
            description: `${saved.name}: ${describeWeeklyOffPattern(saved.config)}.`,
          });
          onClose();
        },
      },
    );
  }

  return (
    <ShortcutLayer id={`modal:weekly-off-${existing?.id ?? 'new'}`}>
      <SaveShortcut onSave={submit} />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>{existing === null ? 'New weekly off pattern' : existing.name}</SheetTitle>
        <SheetDescription>
          Which days of the week are off. Assign a pattern to a person on their employee record.
        </SheetDescription>
      </SheetHeader>

      <Form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {save.isError ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{rosterErrorCopy(save.error).title}</AlertTitle>
              <AlertDescription>
                {rosterErrorCopy(save.error).description} Your edits are still here.
              </AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="weekly-off-name">Name</FieldLabel>
            <Input
              id="weekly-off-name"
              className="pointer-coarse:h-11"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <FieldDescription>
              {touched && nameMissing
                ? 'A pattern needs a name; it is how it is picked on the employee form.'
                : 'How this rule appears in the picker on an employee record.'}
            </FieldDescription>
          </Field>

          <FieldSet>
            <FieldLegend>Days off</FieldLegend>
            <FieldGroup>
              {/* A checkbox each rather than a multi-select: seven options is
                  a list you read, not one you search, and every row here is a
                  44px target on a phone. */}
              <div className="flex flex-col">
                {WEEKDAY_ORDER.map((day) => {
                  const id = `weekly-off-day-${String(day)}`;
                  return (
                    <Label
                      key={day}
                      htmlFor={id}
                      className="pointer-coarse:min-h-11 flex min-h-9 items-center gap-3 border-b py-1 font-normal last:border-b-0"
                    >
                      <Checkbox
                        id={id}
                        checked={weekdays.includes(day)}
                        onCheckedChange={(checked: boolean) => {
                          setWeekdays((current) =>
                            checked
                              ? [...current, day]
                              : current.filter((value) => value !== day),
                          );
                        }}
                      />
                      {ISO_WEEKDAY_LABELS[day]}
                    </Label>
                  );
                })}
              </div>
            </FieldGroup>
          </FieldSet>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="weekly-off-alternate">2nd and 4th Saturday off</FieldLabel>
            <Switch
              id="weekly-off-alternate"
              checked={alternateSaturdays}
              onCheckedChange={setAlternateSaturdays}
            />
          </Field>
          <FieldDescription>
            REQ-C-03&apos;s alternate-Saturday rule. This is not the same as ticking Saturday
            above, which makes every Saturday off.
          </FieldDescription>

          {saturdayStated ? (
            <Alert>
              <WarningCircleIcon />
              <AlertTitle>Saturday is already off every week</AlertTitle>
              <AlertDescription>
                The alternate rule cannot narrow that. Untick Saturday above if you meant only the
                2nd and 4th.
              </AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel>This rule reads as</FieldLabel>
            <p className="text-sm font-medium">{describeWeeklyOffPattern(config)}</p>
          </Field>
        </FieldGroup>
      </Form>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          Cancel
        </Button>
        <Button className="flex-1 sm:flex-none" disabled={save.isPending} onClick={submit}>
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
    id: 'weekly-off-sheet.save',
    keys: 'ctrl+a',
    label: 'Accept / Save',
    scope: 'modal',
    allowInInput: true,
    run: onSave,
  });
  return null;
}
