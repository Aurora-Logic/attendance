import { useState } from 'react';
import { PaperPlaneTiltIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useShortcut } from '@/lib/keyboard/registry';
import { cn } from '@/lib/utils';
import { LEAVE_PREVIEW_BLOCKER_LABELS } from '@vyuha/shared';

import { actionErrorCopy, apiErrorCopy } from './api-error-copy';
import { CheckboxRow } from './control-row';
import { DateField } from './date-field';
import { formatDays, toIsoDate } from './leave-days';
import { useApplyForLeave, usePreviewLeave } from './use-leave';
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

  const singleDay =
    fromDate !== undefined && toDate !== undefined && toIsoDate(fromDate) === toIsoDate(toDate);
  const halfDayAllowed = selectedType?.allowsHalfDay ?? false;

  /**
   * A half day at the start of a range means the leave begins after lunch, so
   * that day's second half is the part consumed; a half day at the end means
   * the return is after lunch, so the first half is. On a single-day
   * application the two collapse into one choice, and first half is the one
   * people mean by "half day" far more often.
   *
   * Computed here rather than in `submit` because the preview has to ask for
   * exactly the portions the application will send -- otherwise the number on
   * screen is for a slightly different application than the one submitted.
   */
  const fromPortion: LeaveDayPortion =
    halfDayAllowed && halfDayStart ? (singleDay ? 'FIRST_HALF' : 'SECOND_HALF') : 'FULL';
  const toPortion: LeaveDayPortion = singleDay
    ? fromPortion
    : halfDayAllowed && halfDayEnd
      ? 'FIRST_HALF'
      : 'FULL';

  /**
   * REQ-G-06's "computed working days consumed and the balance before/after".
   *
   * Asked of the server, not worked out here. The employee's weekly-off
   * pattern, their holiday calendar, the sandwich rule on the type and the
   * balance behind it all live there, and `GET /leave/preview` runs the same
   * evaluation the application will -- so this number is the number that gets
   * deducted rather than an estimate the submission contradicts.
   *
   * Null while the form is incomplete, so a half-filled form asks nothing.
   */
  const previewParams =
    leaveTypeId !== null && fromDate !== undefined && toDate !== undefined &&
    toDate.getTime() >= fromDate.getTime()
      ? {
          leaveTypeId,
          fromDate: toIsoDate(fromDate),
          toDate: toIsoDate(toDate),
          fromPortion,
          toPortion,
        }
      : null;

  const preview = usePreviewLeave(previewParams);
  const count = preview.data ?? null;

  const balanceBefore = count?.balanceBefore ?? balance?.closing ?? null;
  const balanceAfter = count?.balanceAfter ?? null;

  // REQ-G-08: a negative balance is allowed up to the per-type limit and
  // rejected beyond it. Zero on the type means not allowed at all.
  const negativeLimit = count?.negativeBalanceLimit ?? selectedType?.negativeBalanceLimit ?? 0;
  const overdrawn = balanceAfter !== null && balanceAfter < 0;
  const blockers = count?.blockers ?? [];
  const beyondLimit =
    blockers.includes('NEGATIVE_LIMIT_EXCEEDED') || blockers.includes('INSUFFICIENT_BALANCE');

  // REQ-G-07 asks the server to enforce the notice period, and it does. This
  // states the same rule early as a warning rather than a block: an
  // application for leave that already started is a normal thing to file
  // (illness), and this screen is not the place to decide which of those HR
  // will accept.
  const noticeShort = blockers.includes('NOTICE_PERIOD');

  /**
   * Blockers the summary shows as warnings rather than as a refusal to submit.
   *
   * The rest are stated once, next to the button, and the server refuses them
   * anyway -- so a form that also refused them would be a second copy of a
   * policy that is allowed to change without this file being redeployed.
   */
  const otherBlockers = blockers.filter(
    (blocker) =>
      blocker !== 'NEGATIVE_LIMIT_EXCEEDED' &&
      blocker !== 'INSUFFICIENT_BALANCE' &&
      blocker !== 'NOTICE_PERIOD' &&
      blocker !== 'NO_WORKING_DAYS',
  );

  const errors: FormErrors = {};
  if (leaveTypeId === null) errors.leaveType = 'Choose a leave type.';
  if (!fromDate) errors.fromDate = 'Choose the first day.';
  if (!toDate) errors.toDate = 'Choose the last day.';
  if (fromDate && toDate && toDate.getTime() < fromDate.getTime()) {
    errors.toDate = 'The last day cannot be before the first day.';
  }
  if (reason.trim().length === 0) errors.reason = 'A reason is required.';
  if (blockers.includes('NO_WORKING_DAYS') && !errors.toDate) {
    errors.toDate = LEAVE_PREVIEW_BLOCKER_LABELS.NO_WORKING_DAYS;
  }
  if (beyondLimit) {
    errors.balance =
      negativeLimit === 0
        ? 'This type does not allow a negative balance.'
        : `This type allows a negative balance of up to ${formatDays(negativeLimit)}.`;
  }

  // The preview is what says whether these dates are allowed, so submitting
  // before it answers would be submitting blind.
  const valid = Object.keys(errors).length === 0 && count !== null;
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
      {/*
        The form is a grid rather than a single column. Stacked, every control
        got a row of its own and the form ran 609px tall while 368px of width
        sat empty beside it — vertical space spent to keep horizontal space
        unused.

        Two columns from sm, three from md, and no width cap: the balances row
        above and the history table below both run the full content width, so a
        form stopping short of them left a ragged right edge down the page. The
        three columns keep any single control from becoming the over-wide line
        the cap was there to prevent.

        Spans are declared per breakpoint so the pairing is deliberate at each
        one rather than whatever the flow happens to produce.
      */}
      <FieldGroup className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
        <Field
          className="sm:col-span-2 md:col-span-1"
          data-invalid={attempted && errors.leaveType ? true : undefined}
        >
          <FieldLabel htmlFor="leave-type">Leave type</FieldLabel>
          <Select
            value={leaveTypeId}
            onValueChange={(next: string | null) => {
              setLeaveTypeId(next);
              // A type that does not allow half days must not carry one over
              // from the previous selection into a hidden part of the payload.
              const nextType = leaveTypes.find((type) => type.id === next);
              if (!nextType?.allowsHalfDay) {
                setHalfDayStart(false);
                setHalfDayEnd(false);
              }
            }}
          >
            <SelectTrigger
              id="leave-type"
              aria-invalid={attempted && Boolean(errors.leaveType)}
              className="w-full"
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
              {selectedType.isPaid ? 'Paid' : 'Unpaid'}
              {selectedType.noticeDays > 0
                ? ` · ${String(selectedType.noticeDays)} days' notice`
                : ' · no notice required'}
              {selectedType.allowsHalfDay ? ' · half days allowed' : ' · full days only'}
            </FieldDescription>
          ) : null}
          {attempted ? <FieldError>{errors.leaveType}</FieldError> : null}
        </Field>

        {/* The dates are grid items in their own right now, so they pair with
            each other at sm and sit beside the leave type at md. One column at
            360px still, where a side-by-side pair of date buttons would each be
            150px and truncate the date. */}
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

        <Field className="sm:col-span-2 md:col-span-1">
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

        <Field
          className="sm:col-span-2"
          data-invalid={attempted && errors.reason ? true : undefined}
        >
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

        {/* Two columns, not one: this field is a disabled input with a four
            line explanation, and in a single column the explanation is taller
            than everything it explains. */}
        <Field className="sm:col-span-2" data-disabled>
          <FieldLabel htmlFor="leave-attachment">Attachment</FieldLabel>
          <Input id="leave-attachment" type="file" disabled />
          <FieldDescription>
            Optional, and not available yet: there is no file upload endpoint on the server, so an
            attachment chosen here could not be sent. The rest of the application submits without
            one.
          </FieldDescription>
        </Field>
      </FieldGroup>

      {/* The summary sits directly on the page surface with one border, like
          every other content surface here -- no card, and no card inside one. */}
      {preview.isError ? (
        <div
          role="alert"
          className="border-destructive/50 text-destructive flex flex-col gap-1 border p-3"
        >
          <p className="text-sm font-medium">
            {apiErrorCopy(preview.error, { subject: 'leave preview', permission: 'leave.apply.self' }).title}
          </p>
          <p className="text-xs">
            {apiErrorCopy(preview.error, { subject: 'leave preview', permission: 'leave.apply.self' }).description}
          </p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1"
              onClick={() => {
                void preview.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : previewParams !== null && count === null ? (
        <div
          role="status"
          aria-busy
          aria-label="Working out how many days this consumes"
          className="grid grid-cols-2 gap-x-6 gap-y-3 border p-3 sm:grid-cols-4"
        >
          {/* gap-0.5 with a 16px label and 20px value: the same line boxes as
              the dl this stands in for, so the form does not shift when the
              first preview lands. */}
          {['days', 'before', 'after', 'range'].map((key) => (
            <div key={key} className="flex flex-col gap-0.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-14" />
            </div>
          ))}
        </div>
      ) : (
        <dl
          id={summaryId}
          aria-live="polite"
          aria-busy={preview.isFetching || undefined}
          className="grid grid-cols-2 gap-x-6 gap-y-3 border p-3 sm:grid-cols-4"
        >
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Days consumed</dt>
            <dd className="text-sm font-medium tabular-nums">
              {count ? formatDays(count.totalDays) : '\u2014'}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Balance before</dt>
            <dd className="text-sm font-medium tabular-nums">
              {balanceBefore === null ? '\u2014' : formatDays(balanceBefore)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Balance after</dt>
            {/* REQ-G-08: a negative balance is shown in red. Theme token, not a
                raw colour, so it follows the theme and dark mode. */}
            <dd className={cn('text-sm font-medium tabular-nums', overdrawn && 'text-destructive')}>
              {balanceAfter === null ? '\u2014' : formatDays(balanceAfter)}
            </dd>
          </div>
          <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
            <dt className="text-muted-foreground text-xs">Range</dt>
            <dd className="text-sm font-medium tabular-nums">
              {count
                ? `${String(count.calendarDays)} calendar day${count.calendarDays === 1 ? '' : 's'}`
                : '\u2014'}
            </dd>
          </div>

          {count && (count.holidaysSkipped > 0 || count.weeklyOffsSkipped > 0) ? (
            <div className="col-span-2 sm:col-span-4">
              <p className="text-muted-foreground text-xs">
                Not consumed:{' '}
                {[
                  count.holidaysSkipped > 0
                    ? `${String(count.holidaysSkipped)} holiday${count.holidaysSkipped === 1 ? '' : 's'}`
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

          {count && count.sandwichDaysCounted > 0 ? (
            <div className="col-span-2 sm:col-span-4">
              <p className="text-muted-foreground text-xs">
                {count.leaveType.name} counts holidays and weekly offs inside the range, so{' '}
                {formatDays(count.sandwichDaysCounted)} of this are days off that still count.
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
                    : `This takes the balance negative. ${count?.leaveType.name ?? 'This type'} allows up to ${formatDays(negativeLimit)} negative, and it becomes a recovery item at exit.`}
                </span>
              </p>
            </div>
          ) : null}

          {noticeShort ? (
            <div className="col-span-2 sm:col-span-4">
              <p className="text-muted-foreground flex items-start gap-2 text-xs">
                <WarningCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {selectedType?.name} asks for {formatDays(selectedType?.noticeDays ?? 0)} of
                  notice, and these dates give less. The server will refuse this application.
                </span>
              </p>
            </div>
          ) : null}

          {otherBlockers.length > 0 ? (
            <div className="col-span-2 sm:col-span-4">
              <ul className="text-destructive flex flex-col gap-1 text-xs">
                {otherBlockers.map((blocker) => (
                  <li key={blocker} className="flex items-start gap-2">
                    <WarningCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <span>{LEAVE_PREVIEW_BLOCKER_LABELS[blocker]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!canApply || apply.isPending}>
          {apply.isPending ? <Spinner data-icon="inline-start" /> : <PaperPlaneTiltIcon data-icon="inline-start" />}
          Apply for leave
          <ShortcutHint keys="ctrl+a" className="ml-1 hidden md:inline-flex" />
        </Button>
        <Button type="button" variant="ghost" onClick={reset} disabled={apply.isPending}>
          <ACTION_ICONS.clearFilters data-icon="inline-start" />
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
