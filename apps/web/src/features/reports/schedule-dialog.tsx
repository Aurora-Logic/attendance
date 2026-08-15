import { useState } from 'react';
import {
  EXPORT_FORMATS,
  EXPORT_FORMAT_LABELS,
  MAX_SCHEDULE_DAY_OF_MONTH,
  REPORT_DEFINITIONS,
  SCHEDULE_CADENCES,
  SCHEDULE_CADENCE_LABELS,
  SCHEDULE_NAME_MAX,
  SCHEDULE_WEEKDAY_LABELS,
  describeSchedule,
  scheduleWindow,
  type ExportFormat,
  type ReportFilters,
  type ReportKey,
  type ScheduleCadence,
} from '@vyuha/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { TimeField } from '@/features/attendance/pickers';
import { formatDate } from '@/lib/format';

import { useCreateSchedule } from './api';

/**
 * REQ-J-05: turning the report on screen into one that arrives on a timer.
 *
 * Created from the report shell rather than from a settings screen, because
 * everything a schedule needs -- which report, which filters, which columns --
 * is already set up there. Asking somebody to rebuild it in a different place
 * is how the two end up disagreeing.
 *
 * The period is deliberately not on this form. It is derived from the cadence
 * when the schedule runs, and the sentence at the bottom says which days that
 * will be, so nobody has to guess whether "daily" means today or yesterday.
 */

interface ScheduleDialogProps {
  readonly reportKey: ReportKey;
  /** The filter set on screen, minus the period, which a schedule never stores. */
  readonly filters: Omit<ReportFilters, 'from' | 'to'>;
  readonly columns: readonly string[];
  readonly sort: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const HOUR_FALLBACK = 6;

/** 1-28. Beyond that a month can skip a run, so the contract refuses it. */
const DAYS_OF_MONTH = Array.from({ length: MAX_SCHEDULE_DAY_OF_MONTH }, (_, i) => i + 1);

export function ScheduleDialog({
  reportKey,
  filters,
  columns,
  sort,
  open,
  onOpenChange,
}: ScheduleDialogProps) {
  const definition = REPORT_DEFINITIONS[reportKey];
  const create = useCreateSchedule();

  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<ScheduleCadence>('DAILY');
  const [clock, setClock] = useState(`${String(HOUR_FALLBACK).padStart(2, '0')}:00`);
  const [weekday, setWeekday] = useState('1');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [format, setFormat] = useState<ExportFormat>('XLSX');

  const [hourText = '06', minuteText = '00'] = clock.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);

  const summary = describeSchedule({
    cadence,
    hour,
    minute,
    weekday: Number(weekday),
    dayOfMonth: Number(dayOfMonth),
  });

  /*
   * Which days the *next* run would cover, worked out with the same function
   * the server uses. Shown because "every day" is ambiguous until you know it
   * means yesterday -- a schedule running at 06:00 that included today would
   * carry three hours of punches.
   */
  const window = scheduleWindow(cadence, new Date().toISOString().slice(0, 10));
  const covers =
    window.from === window.to
      ? formatDate(window.from)
      : `${formatDate(window.from)} to ${formatDate(window.to)}`;

  function submit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast.add({
        type: 'error',
        title: 'Name it first',
        description: 'The list shows the name, so a schedule without one cannot be told apart.',
      });
      return;
    }

    create.mutate(
      {
        reportKey,
        name: trimmed,
        filters,
        columns: [...columns],
        ...(sort === '' ? {} : { sort }),
        format,
        cadence,
        hour,
        minute,
        // Sent only for the cadence that uses them, so a daily schedule does
        // not carry a weekday that means nothing and reads as if it did.
        ...(cadence === 'WEEKLY' ? { weekday: Number(weekday) } : {}),
        ...(cadence === 'MONTHLY' ? { dayOfMonth: Number(dayOfMonth) } : {}),
        isActive: true,
      },
      {
        onSuccess: (schedule) => {
          toast.add({
            type: 'success',
            title: 'Schedule created',
            description: `${schedule.name} will appear in Downloads. ${describeSchedule(schedule)}.`,
          });
          setName('');
          onOpenChange(false);
        },
        onError: (error: Error) => {
          toast.add({ type: 'error', title: 'Could not schedule', description: error.message });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="block max-w-lg min-w-0">
        <DialogHeader>
          <DialogTitle>Schedule this report</DialogTitle>
          <DialogDescription>
            {definition.label} runs on its own and the file waits in Downloads. The filters on
            screen are kept; the dates are worked out each time it runs.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="schedule-name">Name</FieldLabel>
            <Input
              id="schedule-name"
              value={name}
              maxLength={SCHEDULE_NAME_MAX}
              placeholder={`${definition.label} for the team`}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <FieldDescription>How it will be listed in Downloads.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="schedule-cadence">How often</FieldLabel>
            <Select
              value={cadence}
              onValueChange={(next) => {
                setCadence(next as ScheduleCadence);
              }}
            >
              <SelectTrigger id="schedule-cadence" className="pointer-coarse:h-11 w-full">
                <SelectValue>
                  {(current: string) => SCHEDULE_CADENCE_LABELS[current as ScheduleCadence]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_CADENCES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {SCHEDULE_CADENCE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {cadence === 'WEEKLY' ? (
            <Field>
              <FieldLabel htmlFor="schedule-weekday">On</FieldLabel>
              <Select
                value={weekday}
                onValueChange={(next) => {
                  // Base UI reports a deselect as null. There is no "no day"
                  // for a weekly schedule, so the current one stands.
                  if (next !== null) setWeekday(next);
                }}
              >
                <SelectTrigger id="schedule-weekday" className="pointer-coarse:h-11 w-full">
                  <SelectValue>
                    {(current: string) => SCHEDULE_WEEKDAY_LABELS[Number(current)] ?? 'Monday'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SCHEDULE_WEEKDAY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {cadence === 'MONTHLY' ? (
            <Field>
              <FieldLabel htmlFor="schedule-day">On day</FieldLabel>
              <Select
                value={dayOfMonth}
                onValueChange={(next) => {
                  if (next !== null) setDayOfMonth(next);
                }}
              >
                <SelectTrigger id="schedule-day" className="pointer-coarse:h-11 w-full">
                  <SelectValue>{(current: string) => current}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_MONTH.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {String(day)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Up to the 28th, so no month is ever skipped.
              </FieldDescription>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="schedule-time">At</FieldLabel>
            {/* The shared composition, not `<input type="time">` -- CLAUDE.md
                section 3 rule 1 forbids the native control, and this one opens
                as a Sheet on a phone. */}
            <TimeField id="schedule-time" label="Time of day" value={clock} onValueChange={setClock} />
          </Field>

          <Field>
            <FieldLabel htmlFor="schedule-format">As</FieldLabel>
            <Select
              value={format}
              onValueChange={(next) => {
                setFormat(next as ExportFormat);
              }}
            >
              <SelectTrigger id="schedule-format" className="pointer-coarse:h-11 w-full">
                <SelectValue>
                  {(current: string) => EXPORT_FORMAT_LABELS[current as ExportFormat]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {EXPORT_FORMATS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {EXPORT_FORMAT_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* The whole schedule in one sentence, including the days it will
              cover. Built from the same functions the server runs, so the
              screen cannot promise a different report from the one that
              arrives. */}
          <p className="text-muted-foreground border-t pt-3 text-xs">
            {summary}. The first file would cover {covers}.
          </p>
        </FieldGroup>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={submit}>
            {create.isPending ? 'Creating' : 'Create schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
