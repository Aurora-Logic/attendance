import { useState } from 'react';
import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  EyeIcon,
  ProhibitIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { addDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
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
import { toDateParam } from '@/features/attendance/format';
import { DateRangeField } from '@/features/attendance/pickers';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatDate } from '@/lib/format';
import { ShortcutLayer, useShortcut } from '@/lib/keyboard/registry';
import type { DepartmentSummary } from '@vyuha/shared';

import { rosterErrorCopy } from './roster-error-copy';
import type { BulkRosterResult, Shift } from './types';
import { useBulkRoster } from './use-shifts';

/**
 * REQ-C-05: "pick a department/location + date range + shift, preview the
 * affected employee-days, confirm."
 *
 * Two steps in one surface, not two screens. The preview is the whole point of
 * the requirement -- somebody is about to write several hundred rows -- and a
 * preview the reader has to navigate away from to act on is a preview they
 * stop reading. Confirm is disabled until a preview for the *current* form
 * exists, so the number on the button is always the number the server just
 * counted.
 */

interface BulkRosterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shifts: readonly Shift[];
  departments: readonly DepartmentSummary[];
  defaultPeriod: DateRange;
}

export function BulkRosterSheet({
  open,
  onOpenChange,
  shifts,
  departments,
  defaultPeriod,
}: BulkRosterSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className="gap-0 sm:max-w-xl max-md:max-h-[90vh]"
      >
        {open ? (
          <BulkRosterSheetBody
            shifts={shifts}
            departments={departments}
            defaultPeriod={defaultPeriod}
            onClose={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Identifies the form the preview belongs to, so an edit invalidates it. */
function formKey(shiftId: string, departmentId: string, period: DateRange): string {
  const from = period.from ? toDateParam(period.from) : '';
  const to = period.to ? toDateParam(period.to) : from;
  return `${shiftId}|${departmentId}|${from}|${to}`;
}

function BulkRosterSheetBody({
  shifts,
  departments,
  defaultPeriod,
  onClose,
}: {
  shifts: readonly Shift[];
  departments: readonly DepartmentSummary[];
  defaultPeriod: DateRange;
  onClose: () => void;
}) {
  const bulk = useBulkRoster();

  const [shiftId, setShiftId] = useState<string>(shifts[0]?.id ?? '');
  const [departmentId, setDepartmentId] = useState<string>(departments[0]?.id ?? '');
  const [period, setPeriod] = useState<DateRange>(() => ({
    from: defaultPeriod.from ?? new Date(),
    to: defaultPeriod.to ?? addDays(defaultPeriod.from ?? new Date(), 6),
  }));

  const [preview, setPreview] = useState<BulkRosterResult | null>(null);
  /** The form the preview above was taken of. */
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const currentKey = formKey(shiftId, departmentId, period);
  const previewIsCurrent = previewKey === currentKey && preview !== null;
  const ready = shiftId !== '' && departmentId !== '' && period.from !== undefined;

  function run(dryRun: boolean) {
    if (!ready || !period.from) return;

    bulk.mutate(
      {
        shiftId,
        departmentId,
        from: toDateParam(period.from),
        to: toDateParam(period.to ?? period.from),
        preview: dryRun,
      },
      {
        onSuccess: (result) => {
          if (result.preview) {
            setPreview(result);
            setPreviewKey(currentKey);
            return;
          }
          toast.add({
            type: 'success',
            title: 'Roster assigned',
            description:
              result.recomputed > 0
                ? `${String(result.created)} people assigned. ${String(result.recomputed)} computed days were brought into line.`
                : `${String(result.created)} people assigned.`,
          });
          onClose();
        },
      },
    );
  }

  return (
    <ShortcutLayer id="modal:roster-bulk">
      <ConfirmShortcut
        onConfirm={() => {
          if (previewIsCurrent) run(false);
          else run(true);
        }}
      />

      <SheetHeader className="shrink-0 border-b">
        <SheetTitle>Assign a shift in bulk</SheetTitle>
        <SheetDescription>
          Pick a department, a period and a shift, then preview who it would affect before anything
          is written.
        </SheetDescription>
      </SheetHeader>

      <Form
        onSubmit={() => {
          run(previewIsCurrent ? false : true);
        }}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <FieldGroup>
          {bulk.isError ? (
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>{rosterErrorCopy(bulk.error).title}</AlertTitle>
              <AlertDescription>{rosterErrorCopy(bulk.error).description}</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel>Department</FieldLabel>
            <Select
              value={departmentId === '' ? null : departmentId}
              onValueChange={(next: string | null) => {
                if (next === null) return;
                setDepartmentId(next);
              }}
            >
              <SelectTrigger aria-label="Department" className="pointer-coarse:h-11 w-full">
                <SelectValue>
                  {(value: string) =>
                    departments.find((row) => row.id === value)?.name ?? 'Choose a department'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              Everybody in this department who is not already rostered for the period.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>Shift</FieldLabel>
            <Select
              value={shiftId === '' ? null : shiftId}
              onValueChange={(next: string | null) => {
                if (next === null) return;
                setShiftId(next);
              }}
            >
              <SelectTrigger aria-label="Shift" className="pointer-coarse:h-11 w-full">
                <SelectValue>
                  {(value: string) => {
                    const shift = shifts.find((row) => row.id === value);
                    return shift
                      ? `${shift.name} · ${shift.scheduledIn}–${shift.scheduledOut}`
                      : 'Choose a shift';
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

          <Separator />

          {preview === null ? (
            <p className="text-muted-foreground text-sm">
              Nothing has been counted yet. Preview to see who this would affect.
            </p>
          ) : (
            <PreviewSummary result={preview} stale={!previewIsCurrent} />
          )}
        </FieldGroup>
      </Form>

      <SheetFooter className="shrink-0 flex-col gap-2 border-t sm:flex-row sm:justify-end">
        <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>
          <ACTION_ICONS.cancel data-icon="inline-start" />
          Cancel
        </Button>
        <Button
          variant="outline"
          className="w-full sm:w-auto"
          disabled={!ready || bulk.isPending}
          onClick={() => {
            run(true);
          }}
        >
          {bulk.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <EyeIcon data-icon="inline-start" />
          )}
          Preview
        </Button>
        <Button
          className="w-full sm:w-auto"
          // Deliberately not enabled straight from the form. Confirming a count
          // nobody has seen is the mistake this whole sheet exists to prevent.
          disabled={!previewIsCurrent || bulk.isPending || (preview?.assignable ?? 0) === 0}
          onClick={() => {
            run(false);
          }}
        >
          {bulk.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <CheckCircleIcon data-icon="inline-start" />
          )}
          {previewIsCurrent && preview
            ? `Assign ${String(preview.assignable)}`
            : 'Assign'}
          <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
        </Button>
      </SheetFooter>
    </ShortcutLayer>
  );
}

function PreviewSummary({ result, stale }: { result: BulkRosterResult; stale: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {stale ? (
        <Alert>
          <ArrowCounterClockwiseIcon />
          <AlertTitle>This count is out of date</AlertTitle>
          <AlertDescription>
            The form changed after it was taken. Preview again before assigning.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{result.employeeDays}</span>{' '}
          <span className="text-muted-foreground">employee-days</span>
        </p>
        <p className="text-muted-foreground text-sm tabular-nums">
          {result.assignable} people over {result.days} days
        </p>
        {result.blocked > 0 ? (
          <Badge variant="secondary" className="tabular-nums">
            {result.blocked} blocked
          </Badge>
        ) : null}
      </div>

      {result.assignable === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nobody in this department is free for the whole period, so there is nothing to assign.
        </p>
      ) : null}

      {/* Capped in height rather than paged: this is a confirmation, and a
          pager would hide the very rows the reader is checking. */}
      <ScrollArea className="max-h-64 border">
        <ItemGroup>
          {result.targets.map((target, index) => (
            <div key={target.employee.id}>
              {index > 0 ? <ItemSeparator /> : null}
              <Item size="sm">
                <ItemContent>
                  <ItemTitle className="gap-2">
                    <span className="tabular-nums">{target.employee.employeeCode}</span>
                    <span>{target.employee.name}</span>
                  </ItemTitle>
                  <ItemDescription>
                    {target.conflict === null
                      ? (target.department ?? 'No department')
                      : `Already on ${target.conflict.shift.name} from ${formatDate(target.conflict.from)}${
                          target.conflict.to === null
                            ? ' with no end date'
                            : ` to ${formatDate(target.conflict.to)}`
                        }`}
                  </ItemDescription>
                </ItemContent>
                {target.conflict === null ? null : (
                  <Badge variant="secondary" className="shrink-0 gap-1">
                    <ProhibitIcon />
                    Skipped
                  </Badge>
                )}
              </Item>
            </div>
          ))}
        </ItemGroup>
      </ScrollArea>
    </div>
  );
}

function ConfirmShortcut({ onConfirm }: { onConfirm: () => void }) {
  useShortcut({
    id: 'roster-bulk.confirm',
    keys: 'ctrl+a',
    label: 'Accept / Save',
    scope: 'modal',
    allowInInput: true,
    run: onConfirm,
  });
  return null;
}
