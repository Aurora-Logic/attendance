import { useState } from 'react';
import { CalendarBlankIcon, PlusIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { apiErrorCopy } from './api-error-copy';
import { SampleDataNotice } from './sample-data-notice';
import { LeaveTypeSheet } from './leave-type-sheet';
import { ACCRUAL_METHOD_LABELS, type LeaveTypePolicy } from './types';
import { useLeaveTypes } from './use-leave';

/**
 * REQ-G-01, G-03 / PRD §5 screen 12: the leave policy table.
 *
 * Every number in this table is a count of days. There is no rate, no amount
 * and no currency anywhere on this screen, and none may be added (NFR-10):
 * this product produces the inputs to payroll and does not run it.
 */

/** Yes/no as a word, not a tick: a scan down the column has to be readable. */
function YesNo({ value }: { value: boolean }) {
  return value ? <Badge variant="secondary">Yes</Badge> : <span className="text-muted-foreground">No</span>;
}

/** Zero means "not allowed" for both caps, and reads better said than shown. */
/**
 * Null means the rule does not apply -- the type carries nothing forward, or
 * carries everything. Zero means it applies and the answer is none, which is a
 * different fact and reads differently.
 */
function DaysOrNone({ value, unlimited }: { value: number | null; unlimited?: boolean }) {
  if (unlimited === true) return <span className="text-muted-foreground">Unlimited</span>;
  if (value === null || value <= 0) return <span className="text-muted-foreground">None</span>;
  return <span className="tabular-nums">{value}</span>;
}

const COLUMNS: RecordColumn<LeaveTypePolicy>[] = [
  {
    key: 'name',
    header: 'Type',
    cell: (row) => <span className="font-medium">{row.name}</span>,
  },
  {
    key: 'code',
    header: 'Code',
    cell: (row) => <span className="tabular-nums">{row.code}</span>,
  },
  { key: 'paid', header: 'Paid', cell: (row) => <YesNo value={row.isPaid} /> },
  {
    key: 'accrual',
    header: 'Accrual',
    cell: (row) => ACCRUAL_METHOD_LABELS[row.accrualMethod],
    secondary: true,
  },
  {
    key: 'entitlement',
    header: 'Entitlement',
    cell: (row) => row.annualEntitlement,
    numeric: true,
  },
  {
    key: 'carry',
    header: 'Carry-forward cap',
    cell: (row) => (
      <DaysOrNone
        value={row.carryForwardAllowed ? row.carryForwardCap : null}
        unlimited={row.carryForwardAllowed && row.carryForwardCap === null}
      />
    ),
    numeric: true,
  },
  {
    key: 'negative',
    header: 'Negative limit',
    cell: (row) => <DaysOrNone value={row.negativeBalanceLimit} />,
    numeric: true,
  },
  {
    key: 'notice',
    header: 'Notice days',
    cell: (row) => row.noticeDays,
    numeric: true,
    secondary: true,
  },
  { key: 'halfDay', header: 'Half day', cell: (row) => <YesNo value={row.allowsHalfDay} /> },
  {
    key: 'encashable',
    header: 'Encashable',
    cell: (row) => <YesNo value={row.isEncashable} />,
    secondary: true,
  },
];

function TypesSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading leave types" className="border">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-32 shrink-0" />
          <Skeleton className="h-3 w-10 shrink-0" />
          <Skeleton className="hidden h-3 w-16 shrink-0 sm:block" />
          <Skeleton className="hidden h-3 w-20 shrink-0 xl:block" />
          <Skeleton className="ml-auto h-4 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function LeaveTypesPage() {
  const canManage = usePermission(PERMISSIONS.LEAVE_POLICY_MANAGE);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveTypePolicy | null>(null);

  const query = useLeaveTypes();
  const rows = query.data?.data ?? [];
  const sample = query.data?.sample ?? false;

  function openNew() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(row: LeaveTypePolicy) {
    setEditing(row);
    setSheetOpen(true);
  }

  // PRD §6.4: Alt+C creates a master on the fly. A leave type is a master.
  useShortcut({
    id: 'leave-types.create',
    keys: 'alt+c',
    label: 'New leave type',
    scope: 'screen',
    when: () => canManage,
    run: openNew,
  });

  return (
    <>
      {sample ? <SampleDataNotice endpoint="/api/v1/leave/types" /> : null}

      <PageHeader
        description="How each kind of leave accrues, carries forward and may be taken. Days only — no amounts are held in this product."
        action={
          canManage ? (
            <Button onClick={openNew}>
              <PlusIcon data-icon="inline-start" />
              New leave type
              <ShortcutHint keys="alt+c" className="ml-1 hidden md:inline-flex" />
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">
              Editing needs the leave.policy.manage permission.
            </span>
          )
        }
      />

      {query.isPending ? <TypesSkeleton /> : null}

      {query.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>
            {apiErrorCopy(query.error, {
              subject: 'leave types',
              permission: 'leave.policy.manage',
            }).title}
          </AlertTitle>
          <AlertDescription>
            {
              apiErrorCopy(query.error, {
                subject: 'leave types',
                permission: 'leave.policy.manage',
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
              Try again
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {query.isSuccess && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarBlankIcon />
            </EmptyMedia>
            <EmptyTitle>No leave types yet</EmptyTitle>
            <EmptyDescription>
              Nobody can apply for leave until at least one type exists. Casual, sick and earned
              leave are the usual starting set.
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={openNew}>
                <PlusIcon data-icon="inline-start" />
                New leave type
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : null}

      {rows.length > 0 ? (
        <RecordTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(row) => row.id}
          onRowActivate={canManage ? openEdit : undefined}
          mobilePrimary={(row) => row.name}
          mobileStatus={(row) => <Badge variant="outline">{row.code}</Badge>}
          mobileSupporting={(row) =>
            `${row.isPaid ? 'Paid' : 'Unpaid'} · ${String(row.annualEntitlement)} days a year · ${
              row.allowsHalfDay ? 'half days allowed' : 'full days only'
            }`
          }
        />
      ) : null}

      <LeaveTypeSheet open={sheetOpen} onOpenChange={setSheetOpen} editing={editing} />
    </>
  );
}
