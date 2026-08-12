import { TreePalmIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useSearchParams } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { RecordPagination } from '@/components/shared/record-pagination';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
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
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';
import { cn } from '@/lib/utils';
import {
  APPROVAL_STATUSES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PERMISSIONS,
  type ApprovalStatus,
} from '@vyuha/shared';

import { apiErrorCopy, type ErrorCopy } from './api-error-copy';
import { SampleDataNotice } from './sample-data-notice';
import { formatDays } from './leave-days';
import { LeaveApplicationForm } from './leave-application-form';
import {
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_VARIANT,
  type LeaveBalance,
  type LeaveRequest,
} from './types';
import { useLeaveBalances, useLeaveRequests, useLeaveTypes } from './use-leave';

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
    cell: (row) => <span className="line-clamp-1">{row.reason}</span>,
    secondary: true,
  },
  {
    key: 'approver',
    header: 'Approver',
    cell: (row) => row.approver?.name ?? '—',
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
];

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm">{note}</p>
    </div>
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
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
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
        <SectionHeading title="History" note="Every application you have made, newest first." />

        <div className="flex flex-wrap items-center gap-2">
          <Select value={status ?? ALL_STATUSES} onValueChange={setStatus}>
            <SelectTrigger aria-label="Filter history by status" className="w-full pointer-coarse:h-11 sm:w-44">
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
            />
            <RecordPagination page={page} pageSize={pageSize} total={total} />
          </>
        ) : null}
      </section>
    </>
  );
}
