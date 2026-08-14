import { useState } from 'react';
import {
  BriefcaseIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  ProhibitIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SectionHeading } from '@/components/shared/section-heading';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { DecisionDialog } from '@/features/approvals/decision-dialog';
import { APPROVE_CLASSES, REJECT_CLASSES } from '@/features/approvals/decision-styles';
import { actionErrorCopy, apiErrorCopy } from '@/features/leave/api-error-copy';
import { formatClock } from '@/features/attendance/format';
import { ApiError } from '@/lib/api/client';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { useSessionStore } from '@/lib/session/session-store';
import {
  REGULARIZATION_KIND_LABELS,
  type OnDutyRequest,
  type RegularizationRequest,
} from '@vyuha/shared';

import {
  useDecideOnDuty,
  useDecideRegularization,
  usePendingOnDuty,
  usePendingRegularizations,
} from './use-regularization';

/**
 * REQ-F-03 and REQ-F-05: approve or decline a correction or an on-duty
 * request, with a reason, against this slice's own endpoints.
 *
 * Bands on the Approvals screen rather than rows in the inbox below them,
 * because the two read different tables: the inbox is the generic approvals
 * framework (REQ-I-01) and nothing raises a regularization into it yet — that
 * join is deliberately supervised work (OPEN-QUESTIONS, "The leave / approvals
 * join, still unwired"), and leave is in exactly the same position with exactly
 * the same shape. When the join lands, both arrive in the real inbox and these
 * bands are deleted whole; nothing else references their queries or columns.
 *
 * The server re-checks everything rendered here: the approver key gates the
 * endpoints, and REQ-I-05's "not your own request" answers 403 regardless of
 * what is clicked. What the bands add is honesty about both — the parent only
 * mounts them for a holder of the decide key, and an approver's own request
 * says "Yours" where its buttons would be.
 */

/** The server's floor for a rejection reason (REQ-F-05), mirrored in copy. */
const MIN_REASON_LENGTH = 3;

type Kind = 'regularization' | 'on-duty';

interface PendingDecision {
  kind: Kind;
  action: 'APPROVE' | 'REJECT';
  id: string;
  subject: string;
}

function DecisionsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="border">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-14 items-center gap-4 border-b px-3 py-2.5 last:border-b-0 md:min-h-9"
        >
          <Skeleton className="h-3 w-28 shrink-0" />
          <Skeleton className="h-3 w-24 shrink-0" />
          <Skeleton className="hidden h-3 w-32 shrink-0 sm:block" />
          <Skeleton className="ml-auto h-4 w-24 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function BandFailure({
  error,
  subject,
  onRetry,
}: {
  error: unknown;
  subject: string;
  onRetry: () => void;
}) {
  const copy = apiErrorCopy(error, { subject, permission: 'regularization.approve' });
  return (
    <Alert variant="destructive">
      <WarningCircleIcon />
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>
        {copy.description}
        {error instanceof ApiError && error.requestId ? (
          <span className="mt-1 block font-mono text-[0.6875rem]">Request {error.requestId}</span>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <ACTION_ICONS.retry data-icon="inline-start" />
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

function regularizationSubject(row: RegularizationRequest): string {
  const times = [
    row.requestedIn === null ? null : `in ${formatClock(row.requestedIn)}`,
    row.requestedOut === null ? null : `out ${formatClock(row.requestedOut)}`,
  ]
    .filter((part) => part !== null)
    .join(', ');
  return `${row.employee.name} — ${formatDate(row.date)}, ${REGULARIZATION_KIND_LABELS[row.kind].toLowerCase()} (${times})`;
}

function onDutySubject(row: OnDutyRequest): string {
  const range =
    row.fromDate === row.toDate
      ? formatDate(row.fromDate)
      : `${formatDate(row.fromDate)} – ${formatDate(row.toDate)}`;
  return `${row.employee.name} — on duty ${range}${row.siteName === null ? '' : ` at ${row.siteName}`}`;
}

export function RegularizationDecisionsSection() {
  const ownEmployeeId = useSessionStore((s) => s.employeeId);
  const regularizations = usePendingRegularizations(true);
  const onDuty = usePendingOnDuty(true);
  const decideRegularization = useDecideRegularization();
  const decideOnDuty = useDecideOnDuty();
  const [decision, setDecision] = useState<PendingDecision | null>(null);

  const pending = decideRegularization.isPending || decideOnDuty.isPending;
  const regularizationRows = regularizations.data?.data ?? [];
  const onDutyRows = onDuty.data?.data ?? [];

  function runDecision(reason: string) {
    if (!decision) return;
    const { kind, action, id } = decision;

    // The server refuses a rejection under three characters (REQ-F-05);
    // saying so here keeps the dialog open with the reason still typed,
    // instead of round-tripping to a 400.
    if (action === 'REJECT' && reason.trim().length < MIN_REASON_LENGTH) {
      toast.add({
        type: 'error',
        title: 'Say a little more',
        description: `A rejection reason needs at least ${String(MIN_REASON_LENGTH)} characters; the employee is sent it.`,
      });
      return;
    }

    const noun = kind === 'regularization' ? 'Correction' : 'On-duty request';
    const handlers = {
      onSuccess: () => {
        // PRD §6.6: the toast repeats the action the button named.
        toast.add({
          type: 'success',
          title: action === 'APPROVE' ? `${noun} approved` : `${noun} declined`,
          description:
            action === 'APPROVE'
              ? kind === 'regularization'
                ? 'The correction was written and the day has been recomputed.'
                : 'Those days now count as present.'
              : 'The employee is notified with your reason.',
        });
        setDecision(null);
      },
      onError: (error: Error) => {
        const copy = actionErrorCopy(
          error,
          `${action === 'APPROVE' ? 'Approve' : 'Decline'} ${noun.toLowerCase()}`,
        );
        toast.add({ type: 'error', title: copy.title, description: copy.description });
      },
    };

    const input = { id, action, reason: reason.trim() };
    if (kind === 'regularization') decideRegularization.mutate(input, handlers);
    else decideOnDuty.mutate(input, handlers);
  }

  function decideCell(
    kind: Kind,
    id: string,
    employeeId: string,
    subject: string,
    iconOnly: boolean,
  ) {
    if (ownEmployeeId !== null && employeeId === ownEmployeeId) {
      // REQ-I-05: the server answers APPROVER_IS_REQUESTER; the band says why
      // there are no buttons instead of offering two that can only fail.
      return (
        <span className="text-muted-foreground text-xs">Yours — another approver decides</span>
      );
    }
    return (
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size={iconOnly ? 'icon-sm' : 'sm'}
          aria-label={`Approve ${subject}`}
          disabled={pending}
          className={APPROVE_CLASSES}
          onClick={() => {
            setDecision({ kind, action: 'APPROVE', id, subject });
          }}
        >
          <CheckIcon data-icon={iconOnly ? undefined : 'inline-start'} />
          {iconOnly ? null : 'Approve'}
        </Button>
        <Button
          variant="ghost"
          size={iconOnly ? 'icon-sm' : 'sm'}
          aria-label={`Decline ${subject}`}
          disabled={pending}
          className={REJECT_CLASSES}
          onClick={() => {
            setDecision({ kind, action: 'REJECT', id, subject });
          }}
        >
          <ProhibitIcon data-icon={iconOnly ? undefined : 'inline-start'} />
          {iconOnly ? null : 'Decline'}
        </Button>
      </div>
    );
  }

  const regularizationColumns: RecordColumn<RegularizationRequest>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => <span className="font-medium">{row.employee.name}</span>,
    },
    { key: 'date', header: 'Day', cell: (row) => formatDate(row.date), className: 'tabular-nums' },
    { key: 'kind', header: 'What went wrong', cell: (row) => REGULARIZATION_KIND_LABELS[row.kind] },
    { key: 'in', header: 'In', cell: (row) => formatClock(row.requestedIn), numeric: true },
    { key: 'out', header: 'Out', cell: (row) => formatClock(row.requestedOut), numeric: true },
    {
      key: 'reason',
      header: 'Reason',
      cell: (row) => <span className="line-clamp-2">{row.reason}</span>,
    },
    {
      key: 'decide',
      header: 'Decide',
      cell: (row) =>
        decideCell('regularization', row.id, row.employee.id, regularizationSubject(row), false),
      className: 'text-right',
    },
  ];

  const onDutyColumns: RecordColumn<OnDutyRequest>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => <span className="font-medium">{row.employee.name}</span>,
    },
    {
      key: 'from',
      header: 'From',
      cell: (row) => formatDate(row.fromDate),
      className: 'tabular-nums',
    },
    { key: 'to', header: 'To', cell: (row) => formatDate(row.toDate), className: 'tabular-nums' },
    { key: 'site', header: 'Client or site', cell: (row) => row.siteName ?? EMPTY_VALUE },
    {
      key: 'reason',
      header: 'Reason',
      cell: (row) => <span className="line-clamp-2">{row.reason}</span>,
      secondary: true,
    },
    {
      key: 'decide',
      header: 'Decide',
      cell: (row) => decideCell('on-duty', row.id, row.employee.id, onDutySubject(row), false),
      className: 'text-right',
    },
  ];

  const regularizationTotal = regularizations.data?.meta.total ?? 0;
  const onDutyTotal = onDuty.data?.meta.total ?? 0;

  return (
    <>
      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Corrections to decide"
          note={
            regularizationTotal > regularizationRows.length
              ? `${String(regularizationTotal)} waiting; the first ${String(regularizationRows.length)} are shown — decide some to see the rest.`
              : 'Approving writes the correction and recomputes that day at once. The original punches are left alone.'
          }
        />

        {regularizations.isPending ? (
          <DecisionsSkeleton label="Loading corrections to decide" />
        ) : null}

        {regularizations.isError ? (
          <BandFailure
            error={regularizations.error}
            subject="pending corrections"
            onRetry={() => {
              void regularizations.refetch();
            }}
          />
        ) : null}

        {regularizations.isSuccess && regularizationRows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClockCounterClockwiseIcon />
              </EmptyMedia>
              <EmptyTitle>No corrections waiting on you</EmptyTitle>
              <EmptyDescription>
                A missing punch your team raises arrives here the moment it is raised.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {regularizationRows.length > 0 ? (
          <RecordTable
            columns={regularizationColumns}
            rows={regularizationRows}
            rowKey={(row) => row.id}
            mobilePrimary={(row) => row.employee.name}
            mobileSupporting={(row) =>
              `${formatDate(row.date)} · ${REGULARIZATION_KIND_LABELS[row.kind]} · ${row.reason}`
            }
            mobileStatus={(row) =>
              decideCell('regularization', row.id, row.employee.id, regularizationSubject(row), true)
            }
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="On duty to decide"
          note={
            onDutyTotal > onDutyRows.length
              ? `${String(onDutyTotal)} waiting; the first ${String(onDutyRows.length)} are shown.`
              : 'Approving marks every day in the range as on duty, which counts as present.'
          }
        />

        {onDuty.isPending ? <DecisionsSkeleton label="Loading on-duty requests to decide" /> : null}

        {onDuty.isError ? (
          <BandFailure
            error={onDuty.error}
            subject="pending on-duty requests"
            onRetry={() => {
              void onDuty.refetch();
            }}
          />
        ) : null}

        {onDuty.isSuccess && onDutyRows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BriefcaseIcon />
              </EmptyMedia>
              <EmptyTitle>No on-duty requests waiting on you</EmptyTitle>
              <EmptyDescription>
                Field duty your team declares arrives here before the days it covers.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {onDutyRows.length > 0 ? (
          <RecordTable
            columns={onDutyColumns}
            rows={onDutyRows}
            rowKey={(row) => row.id}
            mobilePrimary={(row) => row.employee.name}
            mobileSupporting={(row) =>
              `${formatDate(row.fromDate)} – ${formatDate(row.toDate)} · ${row.siteName ?? row.reason}`
            }
            mobileStatus={(row) =>
              decideCell('on-duty', row.id, row.employee.id, onDutySubject(row), true)
            }
          />
        ) : null}
      </section>

      <DecisionDialog
        open={decision !== null}
        onOpenChange={(next) => {
          if (!next) setDecision(null);
        }}
        action={decision?.action ?? 'APPROVE'}
        count={1}
        subject={decision?.subject ?? ''}
        pending={pending}
        onConfirm={runDecision}
      />
    </>
  );
}
