import { useState } from 'react';
import { TreePalmIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { useSearchParams } from 'react-router';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { RecordHistorySheet } from '@/features/audit/record-history-sheet';
import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import { RecordPagination } from '@/components/shared/record-pagination';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { RestrictedHolidayPicker } from '@/features/holidays';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { useSessionStore } from '@/lib/session/session-store';
import { cn } from '@/lib/utils';
import {
  APPROVAL_STATUSES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PERMISSIONS,
  type ApprovalStatus,
} from '@vyuha/shared';

import { actionErrorCopy, apiErrorCopy, type ErrorCopy } from './api-error-copy';
import { COMP_OFF_STATES, type CompOffState } from './comp-off';
import { CompOffCredits } from './comp-off-credits';
import { SampleDataNotice } from './sample-data-notice';
import { formatDays } from './leave-days';
import { LeaveApplicationForm } from './leave-application-form';
import {
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_VARIANT,
  type LeaveBalance,
  type LeaveRequest,
} from './types';
import { useCancelLeave, useLeaveBalances, useLeaveRequests, useLeaveTypes } from './use-leave';

/**
 * REQ-G-03, G-06, G-08 / PRD §5 screen 5: balances, apply, history.
 *
 * One screen with three bands rather than three screens, because the three
 * questions a person has about their own leave — how much is left, can I take
 * these days, what happened to the last one — are asked together and answered
 * from the same numbers.
 *
 * History filter and page live in the query string for the same reason the
 * employee list's do: a filtered list has to survive a reload and be
 * shareable.
 */

const ALL_STATUSES = 'ALL';
const LEAVE_YEAR_START_MONTH = 3; // April, zero-based (REQ-G-04, 05-decisions).

/** The leave year a date falls in, named by the calendar year it starts in. */
function leaveYearOf(date: Date): number {
  return date.getMonth() >= LEAVE_YEAR_START_MONTH ? date.getFullYear() : date.getFullYear() - 1;
}

function isApprovalStatus(value: string | null): value is ApprovalStatus {
  return value !== null && (APPROVAL_STATUSES as readonly string[]).includes(value);
}

function isCompOffState(value: string | null): value is CompOffState {
  return value !== null && (COMP_OFF_STATES as readonly string[]).includes(value);
}

function readPositiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

const HISTORY_COLUMNS: RecordColumn<LeaveRequest>[] = [
  {
    key: 'leaveType',
    header: 'Type',
    cell: (row) => <span className="font-medium">{row.leaveType.name}</span>,
  },
  {
    key: 'from',
    header: 'From',
    cell: (row) => formatDate(row.fromDate),
    className: 'tabular-nums',
  },
  {
    key: 'to',
    header: 'To',
    cell: (row) => formatDate(row.toDate),
    className: 'tabular-nums',
  },
  { key: 'days', header: 'Days', cell: (row) => row.totalDays, numeric: true },
  {
    key: 'reason',
    header: 'Reason',
    cell: (row) => <span className="line-clamp-1">{row.reason ?? '—'}</span>,
    secondary: true,
  },
  {
    key: 'decidedBy',
    header: 'Decided by',
    cell: (row) => row.decidedBy?.name ?? '—',
    secondary: true,
  },
  {
    key: 'appliedAt',
    header: 'Applied',
    cell: (row) => formatDate(row.appliedAt.slice(0, 10)),
    className: 'tabular-nums',
    secondary: true,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (
      <Badge variant={LEAVE_STATUS_VARIANT[row.status]}>{LEAVE_STATUS_LABELS[row.status]}</Badge>
    ),
  },
  {
    key: 'cancel',
    header: '',
    // Wrapped so a press on Cancel does not also activate the row behind it and
    // open the history sheet on top of the confirm dialog. `RowActions` guards
    // its own trigger the same way, for the same reason.
    cell: (row) => (
      <span
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
      >
        <CancelLeaveAction request={row} />
      </span>
    ),
  },
];

/**
 * REQ-G-10: "before the start date by the employee directly; on or after the
 * start date via approval."
 *
 * The button is only offered for the half the employee can do themselves.
 * Leave that has started is not shown as disabled with a tooltip -- it is not
 * this person's action at all, and a control that is always dimmed teaches
 * people to stop reading it. The server enforces the same rule regardless.
 */
function CancelLeaveAction({ request }: { request: LeaveRequest }) {
  const [open, setOpen] = useState(false);
  const cancel = useCancelLeave();

  const startsInTheFuture = request.fromDate > new Date().toISOString().slice(0, 10);
  const cancellable =
    startsInTheFuture && (request.status === 'PENDING' || request.status === 'APPROVED');
  if (!cancellable) return null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <XCircleIcon data-icon="inline-start" />
            Cancel
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this leave?</AlertDialogTitle>
          <AlertDialogDescription>
            {request.leaveType.name} from {formatDate(request.fromDate)} to{' '}
            {formatDate(request.toDate)}, {formatDays(request.totalDays)}.
            {request.status === 'APPROVED'
              ? ' The days go back onto the balance.'
              : ' It has not been decided yet, so no balance moves.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate(
                { id: request.id, reason: null },
                {
                  onSuccess: () => {
                    setOpen(false);
                    toast.add({ type: 'success', title: 'Leave cancelled' });
                  },
                  onError: (error) => {
                    const copy = actionErrorCopy(error, 'Cancel leave');
                    toast.add({ type: 'error', title: copy.title, description: copy.description });
                  },
                },
              );
            }}
          >
            {cancel.isPending ? <Spinner data-icon="inline-start" /> : null}
            Cancel the leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LoadFailure({ copy, error, onRetry }: { copy: ErrorCopy; error: unknown; onRetry: () => void }) {
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

/**
 * The balance band.
 *
 * A tile grid rather than a row list: two columns at 360px puts five types on
 * one screen instead of pushing the last two below the fold, and the number is
 * the thing being read, not the label beside it.
 */
function BalanceTile({ balance }: { balance: LeaveBalance }) {
  const negative = balance.closing < 0;
  // The components, not a total of them. Opening and carried forward describe
  // the same days from two directions in a rolled-over year, so adding them
  // would state a credit twice — and a balance band that cannot be reconciled
  // by hand is the one thing nobody will believe.
  const movements = [
    balance.opening !== 0 ? `${String(balance.opening)} opening` : null,
    balance.accrued !== 0 ? `${String(balance.accrued)} accrued` : null,
    balance.availed !== 0 ? `${String(balance.availed)} availed` : null,
    balance.adjusted !== 0 ? `${String(balance.adjusted)} adjusted` : null,
  ].filter((part) => part !== null);

  return (
    <div className="flex flex-col gap-1 border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">{balance.leaveType.name}</span>
        <span className="text-muted-foreground shrink-0 text-[0.6875rem] tracking-wide uppercase">
          {balance.leaveType.code}
        </span>
      </div>
      {/* REQ-G-08: a negative balance is red, because it is a recovery item at
          exit rather than just a small number. */}
      <span className={cn('text-xl font-semibold tabular-nums', negative && 'text-destructive')}>
        {balance.closing}
      </span>
      <span className="text-muted-foreground text-[0.6875rem] leading-normal tabular-nums">
        {movements.length > 0 ? movements.join(' · ') : 'No movement yet'}
      </span>
    </div>
  );
}

function BalanceSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading leave balances"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} aria-hidden className="flex flex-col gap-2 border p-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      ))}
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading leave history" className="border">
      {/* min-h-14 below md, where RecordTable renders two-line cards, not
          36px table rows -- a skeleton at table height would grow 20px per
          row when the history arrived. */}
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-14 items-center gap-4 border-b px-3 py-2.5 last:border-b-0 md:min-h-9"
        >
          <Skeleton className="h-3 w-28 shrink-0" />
          <Skeleton className="h-3 w-20 shrink-0" />
          <Skeleton className="hidden h-3 w-20 shrink-0 sm:block" />
          <Skeleton className="ml-auto h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function MyLeavePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const canApply = usePermission(PERMISSIONS.LEAVE_APPLY_SELF);
  // REQ-M-02's per-record history. The row is only made activatable for a
  // reader who can actually read the trail, rather than made clickable for
  // everybody and then refused inside the sheet.
  const canReadTrail = usePermission(PERMISSIONS.AUDIT_VIEW);
  const [historyFor, setHistoryFor] = useState<LeaveRequest | null>(null);
  // Named explicitly on the comp-off read: `/leave/comp-off` is scoped rather
  // than filtered, so an HR account asking without an employee id would get
  // every credit in the organisation under a heading that says "yours".
  const employeeId = useSessionStore((s) => s.employeeId);
  const compOffState = isCompOffState(searchParams.get('compOff'))
    ? (searchParams.get('compOff') as CompOffState)
    : 'ACTIVE';

  const leaveYear = leaveYearOf(new Date());
  const page = readPositiveInt(searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = readPositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const statusParam = searchParams.get('status');
  const status = isApprovalStatus(statusParam) ? statusParam : null;

  const balancesQuery = useLeaveBalances(leaveYear);
  const typesQuery = useLeaveTypes();
  const historyQuery = useLeaveRequests({ page, pageSize, status });

  const balances = balancesQuery.data?.data ?? [];
  const leaveTypes = typesQuery.data?.data ?? [];
  const history = historyQuery.data?.data ?? [];
  const total = historyQuery.data?.meta.total ?? 0;

  const sample =
    (balancesQuery.data?.sample ?? false) ||
    (typesQuery.data?.sample ?? false) ||
    (historyQuery.data?.sample ?? false);

  function setStatus(next: string | null) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === null || next === ALL_STATUSES) params.delete('status');
      else params.set('status', next);
      // Page four of a one-page filter is an empty screen that reads as "no
      // results" rather than as a stale page number.
      params.delete('page');
      return params;
    });
  }

  return (
    <>
      {/* Delete with the fallback in dev-fixture-fallback.ts; nothing else on
          this screen changes when the endpoints land. */}
      {sample ? <SampleDataNotice endpoint="/api/v1/leave/*" /> : null}

      <PageHeader
        description={`Your leave balances, applications and history for the leave year starting April ${String(leaveYear)}.`}
      />

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Balances"
          note="Closing balance per type, after everything credited and everything taken."
        />

        {balancesQuery.isPending ? <BalanceSkeleton /> : null}

        {balancesQuery.isError ? (
          <LoadFailure
            copy={apiErrorCopy(balancesQuery.error, {
              subject: 'leave balances',
              permission: 'leave.apply.self',
            })}
            error={balancesQuery.error}
            onRetry={() => {
              void balancesQuery.refetch();
            }}
          />
        ) : null}

        {balancesQuery.isSuccess && balances.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TreePalmIcon />
              </EmptyMedia>
              <EmptyTitle>No leave balances yet</EmptyTitle>
              <EmptyDescription>
                Balances appear once leave types are set up and the year&apos;s opening entries are
                posted.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {balances.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {balances.map((balance) => (
              <BalanceTile key={balance.leaveType.id} balance={balance} />
            ))}
          </div>
        ) : null}
      </section>

      <Separator />

      {/* REQ-G-11. Its own band rather than a column on the balance tiles:
          the balance says how many days there are, and the only thing that
          matters about a comp-off credit is the date it stops existing. */}
      <CompOffCredits
        employeeId={employeeId}
        state={compOffState}
        onStateChange={(next) => {
          setSearchParams((current) => {
            const params = new URLSearchParams(current);
            if (next === 'ACTIVE') params.delete('compOff');
            else params.set('compOff', next);
            return params;
          });
        }}
      />

      <Separator />

      {/* REQ-H-03. On this screen rather than on Holidays, which is gated on
          holiday.manage: the employee is the actor here, and choosing a day
          off is what this screen is for. Holidays remains the administrator's
          screen for the calendar itself. */}
      <RestrictedHolidayPicker employeeId={employeeId} />

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Apply for leave"
          note="The days consumed and the balance after are worked out here, before you submit."
        />

        {typesQuery.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading leave types" className="flex flex-col gap-4">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}

        {typesQuery.isError ? (
          <LoadFailure
            copy={apiErrorCopy(typesQuery.error, {
              subject: 'leave types',
              permission: 'leave.apply.self',
            })}
            error={typesQuery.error}
            onRetry={() => {
              void typesQuery.refetch();
            }}
          />
        ) : null}

        {typesQuery.isSuccess && leaveTypes.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TreePalmIcon />
              </EmptyMedia>
              <EmptyTitle>No leave types are set up</EmptyTitle>
              <EmptyDescription>
                An administrator defines the types before anyone can apply.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {leaveTypes.length > 0 ? (
          <LeaveApplicationForm
            leaveTypes={leaveTypes}
            balances={balances}
            canApply={canApply}
          />
        ) : null}
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="History"
          note={
            canReadTrail
              ? 'Every application you have made, newest first. Activate a row for what changed on it and who changed it.'
              : 'Every application you have made, newest first.'
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Select value={status ?? ALL_STATUSES} onValueChange={setStatus}>
            <SelectTrigger aria-label="Filter history by status" className="w-full sm:w-44">
              <SelectValue>
                {(value: string) =>
                  isApprovalStatus(value) ? LEAVE_STATUS_LABELS[value] : 'All statuses'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                {APPROVAL_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {LEAVE_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          {status !== null ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus(null);
              }}
            >
              Clear filter
            </Button>
          ) : null}
        </div>

        {historyQuery.isPending ? <HistorySkeleton /> : null}

        {historyQuery.isError ? (
          <LoadFailure
            copy={apiErrorCopy(historyQuery.error, {
              subject: 'leave history',
              permission: 'leave.apply.self',
            })}
            error={historyQuery.error}
            onRetry={() => {
              void historyQuery.refetch();
            }}
          />
        ) : null}

        {historyQuery.isSuccess && history.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TreePalmIcon />
              </EmptyMedia>
              <EmptyTitle>{status ? 'No applications with this status' : 'No leave applied yet'}</EmptyTitle>
              <EmptyDescription>
                {status
                  ? 'Clear the filter to see the rest of your history.'
                  : 'Applications you make appear here with their approval status.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {history.length > 0 ? (
          <>
            <RecordTable
              columns={HISTORY_COLUMNS}
              rows={history}
              rowKey={(row) => row.id}
              mobilePrimary={(row) => row.leaveType.name}
              mobileStatus={(row) => (
                <Badge variant={LEAVE_STATUS_VARIANT[row.status]}>
                  {LEAVE_STATUS_LABELS[row.status]}
                </Badge>
              )}
              mobileSupporting={(row) =>
                `${formatDate(row.fromDate)} – ${formatDate(row.toDate)} · ${formatDays(row.totalDays)}`
              }
              // REQ-M-02. Row activation rather than a column button, because a
              // column cell is not rendered at all in the stacked mobile card —
              // an action only desktop readers could reach would satisfy the
              // requirement on one device and not the other.
              onRowActivate={canReadTrail ? setHistoryFor : undefined}
            />
            <RecordPagination page={page} pageSize={pageSize} total={total} />
          </>
        ) : null}
      </section>

      <RecordHistorySheet
        open={historyFor !== null}
        onOpenChange={(next) => {
          if (!next) setHistoryFor(null);
        }}
        entityType="leave_request"
        entityId={historyFor?.id ?? null}
        title={
          historyFor === null
            ? ''
            : `${historyFor.leaveType.name}, ${formatDate(historyFor.fromDate)}`
        }
        description="Applied, approved, rejected or cancelled — every step recorded against this request."
      />
    </>
  );
}
