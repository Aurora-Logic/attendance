import { useState } from 'react';
import { CheckIcon, ProhibitIcon, TreePalmIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { SectionHeading } from '@/components/shared/section-heading';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
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
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { useSessionStore } from '@/lib/session/session-store';

import { actionErrorCopy, apiErrorCopy } from './api-error-copy';
import { formatDays } from './leave-days';
import { SampleDataNotice } from './sample-data-notice';
import type { LeaveRequest } from './types';
import { useDecideLeave, usePendingLeaveDecisions } from './use-leave';

/**
 * REQ-G-09's minimal decision surface (launch plan WS-B): approve or reject
 * pending leave, with a reason, against the existing
 * `/leave/requests/:id/approve|reject` endpoints.
 *
 * A band on the Approvals screen rather than rows in the inbox below it,
 * because the two read different tables: the inbox is the generic approvals
 * framework, and nothing raises a leave request into it yet -- that join is
 * deliberately supervised work (OPEN-QUESTIONS, "The leave / approvals join,
 * still unwired"). When it lands, leave arrives in the real inbox and this
 * band is deleted whole; nothing else references its query or its columns.
 *
 * The server re-checks everything this band renders: the approver keys gate
 * the endpoints, and REQ-I-05's "not your own request" answers 403 regardless
 * of what is clicked. What the band adds is honesty about both -- the parent
 * only mounts it for holders of a decide key, and an approver's own request
 * says "Yours" where its buttons would be.
 */

/** The server's floor for a rejection reason (REQ-F-05), mirrored in copy. */
const MIN_REASON_LENGTH = 3;

interface PendingDecision {
  action: 'APPROVE' | 'REJECT';
  request: LeaveRequest;
}

function subjectOf(request: LeaveRequest): string {
  const range =
    request.fromDate === request.toDate
      ? formatDate(request.fromDate)
      : `${formatDate(request.fromDate)} – ${formatDate(request.toDate)}`;
  return `${request.employee.name} — ${request.leaveType.name}, ${range} (${formatDays(request.totalDays)})`;
}

function DecisionsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading pending leave" className="border">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
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

export function LeaveDecisionsSection() {
  const ownEmployeeId = useSessionStore((s) => s.employeeId);
  const query = usePendingLeaveDecisions(true);
  const decide = useDecideLeave();
  const [decision, setDecision] = useState<PendingDecision | null>(null);

  const rows = query.data?.data ?? [];
  const total = query.data?.meta.total ?? 0;
  const sample = query.data?.sample ?? false;

  function runDecision(reason: string) {
    if (!decision) return;
    const { action, request } = decision;

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

    decide.mutate(
      { id: request.id, action, reason: reason.trim() },
      {
        onSuccess: () => {
          // PRD §6.6: the toast repeats the action the button named.
          toast.add({
            type: 'success',
            title: action === 'APPROVE' ? 'Leave approved' : 'Leave rejected',
            description:
              action === 'APPROVE'
                ? 'The balance moved and the attendance days now show the leave.'
                : 'The employee is notified with your reason.',
          });
          setDecision(null);
        },
        onError: (error) => {
          const copy = actionErrorCopy(
            error,
            action === 'APPROVE' ? 'Approve leave' : 'Reject leave',
          );
          toast.add({ type: 'error', title: copy.title, description: copy.description });
        },
      },
    );
  }

  const decideCell = (row: LeaveRequest, iconOnly: boolean) => {
    if (ownEmployeeId !== null && row.employee.id === ownEmployeeId) {
      // REQ-I-05: the server answers APPROVER_IS_REQUESTER; the band says why
      // there are no buttons instead of offering two that can only fail.
      return <span className="text-muted-foreground text-xs">Yours — another approver decides</span>;
    }
    return (
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size={iconOnly ? 'icon-sm' : 'sm'}
          aria-label={`Approve ${subjectOf(row)}`}
          disabled={decide.isPending}
          className={APPROVE_CLASSES}
          onClick={() => {
            setDecision({ action: 'APPROVE', request: row });
          }}
        >
          <CheckIcon data-icon={iconOnly ? undefined : 'inline-start'} />
          {iconOnly ? null : 'Approve'}
        </Button>
        <Button
          variant="ghost"
          size={iconOnly ? 'icon-sm' : 'sm'}
          aria-label={`Reject ${subjectOf(row)}`}
          disabled={decide.isPending}
          className={REJECT_CLASSES}
          onClick={() => {
            setDecision({ action: 'REJECT', request: row });
          }}
        >
          <ProhibitIcon data-icon={iconOnly ? undefined : 'inline-start'} />
          {iconOnly ? null : 'Reject'}
        </Button>
      </div>
    );
  };

  const columns: RecordColumn<LeaveRequest>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => <span className="font-medium">{row.employee.name}</span>,
    },
    { key: 'type', header: 'Type', cell: (row) => row.leaveType.name },
    {
      key: 'from',
      header: 'From',
      cell: (row) => formatDate(row.fromDate),
      className: 'tabular-nums',
    },
    { key: 'to', header: 'To', cell: (row) => formatDate(row.toDate), className: 'tabular-nums' },
    { key: 'days', header: 'Days', cell: (row) => row.totalDays, numeric: true },
    {
      key: 'reason',
      header: 'Reason',
      cell: (row) => <span className="line-clamp-1">{row.reason ?? '—'}</span>,
      secondary: true,
    },
    {
      key: 'applied',
      header: 'Applied',
      cell: (row) => formatDate(row.appliedAt.slice(0, 10)),
      className: 'tabular-nums',
      secondary: true,
    },
    {
      key: 'decide',
      header: 'Decide',
      cell: (row) => decideCell(row, false),
      className: 'text-right',
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      {sample ? <SampleDataNotice endpoint="/api/v1/leave/requests" /> : null}

      <SectionHeading
        title="Leave to decide"
        note={
          total > rows.length
            ? `${String(total)} waiting; the first ${String(rows.length)} are shown — decide some to see the rest.`
            : 'Pending leave in your scope. Approving moves the balance and the muster at once.'
        }
      />

      {query.isPending ? <DecisionsSkeleton /> : null}

      {query.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>
            {apiErrorCopy(query.error, { subject: 'pending leave', permission: 'leave.approve.team' }).title}
          </AlertTitle>
          <AlertDescription>
            {
              apiErrorCopy(query.error, {
                subject: 'pending leave',
                permission: 'leave.approve.team',
              }).description
            }
            {query.error instanceof ApiError && query.error.requestId ? (
              <span className="mt-1 block font-mono text-[0.6875rem]">
                Request {query.error.requestId}
              </span>
            ) : null}
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void query.refetch();
              }}
            >
              <ACTION_ICONS.retry data-icon="inline-start" />
              Try again
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {query.isSuccess && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TreePalmIcon />
            </EmptyMedia>
            <EmptyTitle>No leave waiting on you</EmptyTitle>
            <EmptyDescription>
              Applications from your team arrive here the moment they are made.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {rows.length > 0 ? (
        <RecordTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          mobilePrimary={(row) => row.employee.name}
          mobileSupporting={(row) =>
            `${row.leaveType.name} · ${formatDate(row.fromDate)} – ${formatDate(row.toDate)} · ${formatDays(row.totalDays)}`
          }
          mobileStatus={(row) => decideCell(row, true)}
        />
      ) : null}

      <DecisionDialog
        open={decision !== null}
        onOpenChange={(next) => {
          if (!next) setDecision(null);
        }}
        action={decision?.action ?? 'APPROVE'}
        count={1}
        subject={decision ? subjectOf(decision.request) : ''}
        pending={decide.isPending}
        onConfirm={runDecision}
      />
    </section>
  );
}
