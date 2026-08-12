import { useMemo, useState } from 'react';
import { PaperPlaneTiltIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { differenceInCalendarDays, startOfToday } from 'date-fns';

import { Form } from '@/components/shared/form';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useHolidayCalendars } from '@/features/holidays/use-holidays';
import { useShortcut } from '@/lib/keyboard/registry';
import { cn } from '@/lib/utils';

import { actionErrorCopy } from './api-error-copy';
import { CheckboxRow } from './control-row';
import { DateField } from './date-field';
import { countLeaveDays, DEFAULT_WEEKLY_OFF_DAYS, formatDays, toIsoDate } from './leave-days';
import { useApplyForLeave } from './use-leave';
import type { LeaveBalance, LeaveDayPortion, LeaveTypePolicy } from './types';

/**
 * REQ-G-06: apply for leave.
 *
 * The requirement that shapes everything here is the last clause — "the form
 * shows the computed working days consumed and the balance before/after,
 * before submission". So the summary is not a confirmation step after the
 * button; it is part of the form, it updates as the fields move, and it shows
 * its own arithmetic (how many calendar days, how many were skipped and why)
 * rather than only its conclusion. A number a person cannot check is a number
 * they will not trust the first time it disagrees with them.
 */

interface LeaveApplicationFormProps {
  leaveTypes: LeaveTypePolicy[];
  balances: LeaveBalance[];
  /** False when the session lacks leave.apply.self; the form says why. */
  canApply: boolean;
}

interface FormErrors {
  leaveType?: string;
  fromDate?: string;
  toDate?: string;
  reason?: string;
  balance?: string;
}

export function LeaveApplicationForm({
  leaveTypes,
  balances,
  canApply,
}: LeaveApplicationFormProps) {
  const today = startOfToday();

  const [leaveTypeId, setLeaveTypeId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [halfDayStart, setHalfDayStart] = useState(false);
  const [halfDayEnd, setHalfDayEnd] = useState(false);
  const [reason, setReason] = useState('');
  // Errors appear after the first attempt rather than while someone is still
  // filling the form in; a field that is red before it has been touched reads
  // as a broken form.
  const [attempted, setAttempted] = useState(false);

  const selectedType = leaveTypes.find((type) => type.id === leaveTypeId) ?? null;
  const balance = balances.find((row) => row.leaveType.id === leaveTypeId) ?? null;

  // A range can cross a calendar year (28 December to 3 January), and the
  // holidays that matter then live in two calendars. Two calls with the same
  // year resolve to one request — React Query keys on the year.
  const fromYear = (fromDate ?? today).getFullYear();
  const toYear = (toDate ?? fromDate ?? today).getFullYear();
  const fromYearCalendars = useHolidayCalendars(fromYear);
  const toYearCalendars = useHolidayCalendars(toYear);

  /**
   * REQ-H-02 gives each employee a calendar through their location, and there
   * is no endpoint yet that says which one is theirs — so the first calendar
   * is used and named on the screen. Naming it is the point: an assumption a
   * reader can see is one they can correct, and the count below prints how
   * many days it removed.
   */
  const calendar = fromYearCalendars.data?.data[0] ?? null;
  const holidays = useMemo(() => {
    const dates = new Set<string>();
    for (const list of [fromYearCalendars.data?.data ?? [], toYearCalendars.data?.data ?? []]) {
      const first = list[0];
      if (!first) continue;
      for (const holiday of first.holidays) dates.add(holiday.date);
    }
    return dates;
  }, [fromYearCalendars.data, toYearCalendars.data]);

  const singleDay =
    fromDate !== undefined && toDate !== undefined && toIsoDate(fromDate) === toIsoDate(toDate);
  const halfDayAllowed = selectedType?.halfDayAllowed ?? false;

  const count =
    fromDate && toDate
      ? countLeaveDays({
          from: fromDate,
          to: toDate,
          halfDayStart: halfDayAllowed && halfDayStart,
          halfDayEnd: halfDayAllowed && (singleDay ? halfDayStart : halfDayEnd),
          holidays,
          weeklyOffDays: DEFAULT_WEEKLY_OFF_DAYS,
          countsSandwichDays: selectedType?.countsSandwichDays ?? false,
        })
      : null;

  const balanceBefore = balance?.closing ?? null;
  const balanceAfter =
    balanceBefore !== null && count !== null ? balanceBefore - count.totalDays : null;

  // REQ-G-08: a negative balance is allowed up to the per-type limit and
  // rejected beyond it. Zero on the type means not allowed at all.
  const negativeLimit = selectedType?.negativeBalanceLimit ?? 0;
  const overdrawn = balanceAfter !== null && balanceAfter < 0;
  const beyondLimit = balanceAfter !== null && -balanceAfter > negativeLimit;

  // REQ-G-07 asks the server to enforce the notice period. This is the same
  // rule stated early, as a warning rather than a block: an application for
  // leave that already started is a normal thing to file (illness), and this
  // screen is not the place to decide which of those HR will accept.
  const noticeShortfall =
    selectedType && fromDate
      ? selectedType.noticeDays - differenceInCalendarDays(fromDate, today)
      : 0;
  const noticeShort = selectedType !== null && fromDate !== undefined && noticeShortfall > 0;

  const errors: FormErrors = {};
  if (leaveTypeId === null) errors.leaveType = 'Choose a leave type.';
  if (!fromDate) errors.fromDate = 'Choose the first day.';
  if (!toDate) errors.toDate = 'Choose the last day.';
  if (fromDate && toDate && toDate.getTime() < fromDate.getTime()) {
    errors.toDate = 'The last day cannot be before the first day.';
  }
  if (reason.trim().length === 0) errors.reason = 'A reason is required.';
  if (count !== null && count.totalDays === 0 && !errors.toDate) {
    errors.toDate = 'Every day in this range is a holiday or a weekly off, so nothing is consumed.';
  }
  if (beyondLimit) {
    errors.balance =
      negativeLimit === 0
        ? 'This type does not allow a negative balance.'
        : `This type allows a negative balance of up to ${formatDays(negativeLimit)}.`;
  }

  const valid = Object.keys(errors).length === 0;
  const apply = useApplyForLeave();

  function reset() {
    setLeaveTypeId(null);
    setFromDate(undefined);
    setToDate(undefined);
    setHalfDayStart(false);
    setHalfDayEnd(false);
    setReason('');
    setAttempted(false);
  }

  function submit() {
    setAttempted(true);
    if (!valid || !fromDate || !toDate || leaveTypeId === null) return;

    // A half day at the start of a range means the leave begins after lunch,
    // so that day's second half is the part consumed; a half day at the end
    // means the return is after lunch, so the first half is consumed. On a
    // single-day application the two collapse into one choice, and first half
    // is the one people mean by "half day" far more often.
    const fromPortion: LeaveDayPortion = halfDayAllowed && halfDayStart
      ? singleDay
        ? 'FIRST_HALF'
        : 'SECOND_HALF'
      : 'FULL';
    const toPortion: LeaveDayPortion = singleDay
      ? fromPortion
      : halfDayAllowed && halfDayEnd
        ? 'FIRST_HALF'
        : 'FULL';

    apply.mutate(
      {
        leaveTypeId,
        fromDate: toIsoDate(fromDate),
        toDate: toIsoDate(toDate),
        fromPortion,
        toPortion,
        reason: reason.trim(),
        // The attachment field is disabled until the upload endpoint exists;
        // sending null is honest, and nothing the reader chose is discarded.
        attachmentFileId: null,
      },
      {
        onSuccess: () => {
          // PRD §6.6: the toast repeats the action the button named.
          toast.add({ type: 'success', title: 'Leave applied', description: 'It is now waiting for approval.' });
          reset();
        },
        onError: (error) => {
          const copy = actionErrorCopy(error, 'Apply for leave');
          toast.add({ type: 'error', title: copy.title, description: copy.description });
        },
      },
    );
  }

  // PRD §6.4: Ctrl+A accepts from any field in the form.
  useShortcut({
    id: 'my-leave.apply',
    keys: 'ctrl+a',
    label: 'Apply for leave',
    scope: 'screen',
    when: () => canApply && !apply.isPending,
    run: submit,
  });

  const summaryId = 'leave-application-summary';

  return (
    <Form onSubmit={submit} className="flex flex-col gap-5">
      <FieldGroup className="max-w-3xl">
        <Field data-invalid={attempted && errors.leaveType ? true : undefined}>
          <FieldLabel htmlFor="leave-type">Leave type</FieldLabel>
          <Select
            value={leaveTypeId}
            onValueChange={(next: string | null) => {
              setLeaveTypeId(next);
              // A type that does not allow half days must not carry one over
              // from the previous selection into a hidden part of the payload.
              const nextType = leaveTypes.find((type) => type.id === next);
              if (!nextType?.halfDayAllowed) {
                setHalfDayStart(false);
                setHalfDayEnd(false);
              }
            }}
          >
            <SelectTrigger
              id="leave-type"
              aria-invalid={attempted && Boolean(errors.leaveType)}
              className="w-full pointer-coarse:h-11 sm:w-72"
            >
              <SelectValue>
                {(value: string | null) =>
                  leaveTypes.find((type) => type.id === value)?.name ?? 'Choose a leave type'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {leaveTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {selectedType ? (
            <FieldDescription>
              {selectedType.paid ? 'Paid' : 'Unpaid'}
              {selectedType.noticeDays > 0
                ? ` · ${String(selectedType.noticeDays)} days' notice`
                : ' · no notice required'}
              {selectedType.halfDayAllowed ? ' · half days allowed' : ' · full days only'}
            </FieldDescription>
          ) : null}
          {attempted ? <FieldError>{errors.leaveType}</FieldError> : null}
        </Field>

        {/* Two columns from sm; one at 360px, where a side-by-side pair of
            date buttons would each be 150px and truncate the date. */}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={attempted && errors.fromDate ? true : undefined}>
            <FieldLabel htmlFor="leave-from">First day</FieldLabel>
            <DateField
              id="leave-from"
              label="First day of leave"
              value={fromDate}
              invalid={attempted && Boolean(errors.fromDate)}
              onValueChange={(next) => {
                setFromDate(next);
                // Moving the start past the end would leave an inverted range
                // on screen; the end follows rather than going red.
                if (next && toDate && toDate.getTime() < next.getTime()) setToDate(next);
              }}
            />
            {attempted ? <FieldError>{errors.fromDate}</FieldError> : null}
          </Field>

          <Field data-invalid={attempted && errors.toDate ? true : undefined}>
            <FieldLabel htmlFor="leave-to">Last day</FieldLabel>
            <DateField
              id="leave-to"
              label="Last day of leave"
              value={toDate}
              defaultMonth={fromDate}
              invalid={attempted && Boolean(errors.toDate)}
              disabled={fromDate ? { before: fromDate } : undefined}
              onValueChange={setToDate}
            />
            {attempted ? <FieldError>{errors.toDate}</FieldError> : null}
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="leave-half-start">Half days</FieldLabel>
          <div className="flex flex-col gap-2">
            <CheckboxRow
              id="leave-half-start"
              label={singleDay ? 'Take this as a half day' : 'First day is a half day'}
              checked={halfDayStart}
              disabled={!halfDayAllowed}
              onCheckedChange={setHalfDayStart}
            />
            {!singleDay ? (
              <CheckboxRow
                id="leave-half-end"
                label="Last day is a half day"
                checked={halfDayEnd}
                disabled={!halfDayAllowed}
                onCheckedChange={setHalfDayEnd}
              />
            ) : null}
          </div>
          <FieldDescription>
            {selectedType === null
              ? 'Choose a leave type first — half days are allowed per type.'
              : halfDayAllowed
                ? 'A half day counts as 0.5 against the balance.'
                : `${selectedType.name} is taken in full days only.`}
          </FieldDescription>
        </Field>

        <Field data-invalid={attempted && errors.reason ? true : undefined}>
          <FieldLabel htmlFor="leave-reason">Reason</FieldLabel>
          <Textarea
            id="leave-reason"
            value={reason}
            rows={3}
            maxLength={500}
            placeholder="Say what the leave is for."
            aria-invalid={attempted && Boolean(errors.reason)}
            aria-describedby={summaryId}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            onKeyDown={(event) => {
              // PRD §6.4: Esc clears the field it is typed in, and only stops
              // there when it had something to clear.
              if (event.key === 'Escape' && reason.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                setReason('');
              }
            }}
          />
          {attempted ? <FieldError>{errors.reason}</FieldError> : null}
        </Field>

        <Field data-disabled>
          <FieldLabel htmlFor="leave-attachment">Attachment</FieldLabel>
          <Input id="leave-attachment" type="file" disabled className="pointer-coarse:h-11" />
          <FieldDescription>
            Optional, and not available yet: there is no file upload endpoint on the server, so an
            attachment chosen here could not be sent. The rest of the application submits without
            one.
          </FieldDescription>
        </Field>
      </FieldGroup>

      {/* The summary sits directly on the page surface with one border, like
          every other content surface here — no card, and no card inside one. */}
      <dl
        id={summaryId}
        aria-live="polite"
        className="grid max-w-3xl grid-cols-2 gap-x-6 gap-y-3 border p-3 sm:grid-cols-4"
      >
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">Days consumed</dt>
          <dd className="text-sm font-medium tabular-nums">
            {count ? formatDays(count.totalDays) : '—'}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">Balance before</dt>
          <dd className="text-sm font-medium tabular-nums">
            {balanceBefore === null ? '—' : formatDays(balanceBefore)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs">Balance after</dt>
          {/* REQ-G-08: a negative balance is shown in red. Theme token, not a
              raw colour, so it follows the theme and dark mode. */}
          <dd
            className={cn(
              'text-sm font-medium tabular-nums',
              overdrawn && 'text-destructive',
            )}
          >
            {balanceAfter === null ? '—' : formatDays(balanceAfter)}
          </dd>
        </div>
        <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
          <dt className="text-muted-foreground text-xs">Range</dt>
          <dd className="text-sm font-medium tabular-nums">
            {count ? `${String(count.calendarDays)} calendar days` : '—'}
          </dd>
        </div>

        {count && (count.holidaysSkipped > 0 || count.weeklyOffsSkipped > 0) ? (
          <div className="col-span-2 sm:col-span-4">
            <p className="text-muted-foreground text-xs">
              Not consumed:{' '}
              {[
                count.holidaysSkipped > 0
                  ? `${String(count.holidaysSkipped)} holiday${count.holidaysSkipped === 1 ? '' : 's'}${calendar ? ` from the ${calendar.name} calendar` : ''}`
                  : null,
                count.weeklyOffsSkipped > 0
                  ? `${String(count.weeklyOffsSkipped)} weekly off${count.weeklyOffsSkipped === 1 ? '' : 's'}`
                  : null,
              ]
                .filter((part) => part !== null)
                .join(' and ')}
              .
            </p>
          </div>
        ) : null}

        {count && count.holidaysSkipped === 0 && count.weeklyOffsSkipped === 0 && selectedType?.countsSandwichDays ? (
          <div className="col-span-2 sm:col-span-4">
            <p className="text-muted-foreground text-xs">
              {selectedType.name} counts holidays and weekly offs inside the range.
            </p>
          </div>
        ) : null}

        {overdrawn ? (
          <div className="col-span-2 sm:col-span-4">
            <p
              className={cn(
                'flex items-start gap-2 text-xs',
                beyondLimit ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <WarningCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {beyondLimit
                  ? errors.balance
                  : `This takes the balance negative. ${selectedType?.name ?? 'This type'} allows up to ${formatDays(negativeLimit)} negative, and it becomes a recovery item at exit.`}
              </span>
            </p>
          </div>
        ) : null}

        {noticeShort ? (
          <div className="col-span-2 sm:col-span-4">
            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <WarningCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {selectedType?.name} asks for {formatDays(selectedType?.noticeDays ?? 0)} of notice.
                This application is {formatDays(noticeShortfall)} short, so an approver may return
                it.
              </span>
            </p>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!canApply || apply.isPending}>
          {apply.isPending ? <Spinner data-icon="inline-start" /> : <PaperPlaneTiltIcon data-icon="inline-start" />}
          Apply for leave
          <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
        </Button>
        <Button type="button" variant="ghost" onClick={reset} disabled={apply.isPending}>
          Clear
        </Button>
        {!canApply ? (
          <span className="text-muted-foreground text-xs">
            Applying needs the leave.apply.self permission.
          </span>
        ) : null}
      </div>
    </Form>
  );
}
