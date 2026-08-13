import { useState } from 'react';
import {
  LockKeyIcon,
  LockKeyOpenIcon,
  LockSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { parseISO } from 'date-fns';

import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { toDateParam } from '@/features/attendance/format';
import { MonthField } from '@/features/attendance/pickers';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { SampleDataNotice } from '@/features/attendance/sample-data-notice';
import { ApiError } from '@/lib/api/client';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import {
  MAX_UNLOCK_REASON,
  MIN_UNLOCK_REASON,
  isLive,
  periodLabel,
  type PeriodLock,
} from './types';
import { useLockPeriod, usePeriodLocks, useUnlockPeriod } from './use-period-locks';

/**
 * REQ-E-09 / PRD §5 screen 19: closing a month.
 *
 * The screen's job is to make the consequence obvious before the button is
 * pressed. A locked month refuses punches, leave, regularizations, overrides
 * and recomputes, and it is the precondition for the payroll handoff
 * (REQ-J-04), so it is the one action here that other people notice
 * immediately.
 */

function printInstant(value: string | null): string {
  if (value === null) return EMPTY_VALUE;
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  return formatDate(toDateParam(parsed));
}

const COLUMNS: RecordColumn<PeriodLock>[] = [
  {
    key: 'period',
    header: 'Period',
    cell: (row) => <span className="font-medium">{periodLabel(row.year, row.month)}</span>,
  },
  {
    key: 'scope',
    header: 'Scope',
    cell: (row) => row.locationName ?? 'Whole organisation',
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) =>
      isLive(row) ? <Badge>Locked</Badge> : <Badge variant="outline">Unlocked</Badge>,
  },
  {
    key: 'lockedBy',
    header: 'Locked by',
    cell: (row) => row.lockedBy?.name ?? EMPTY_VALUE,
    secondary: true,
  },
  {
    key: 'lockedAt',
    header: 'Locked on',
    cell: (row) => printInstant(row.lockedAt),
    className: 'tabular-nums',
  },
  {
    key: 'unlockedAt',
    header: 'Unlocked on',
    cell: (row) => printInstant(row.unlockedAt),
    className: 'tabular-nums',
    secondary: true,
  },
  {
    key: 'reason',
    header: 'Reason',
    cell: (row) => row.reason ?? EMPTY_VALUE,
    secondary: true,
  },
];

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading period locks" className="border">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-28 shrink-0" />
          <Skeleton className="hidden h-3 w-32 shrink-0 sm:block" />
          <Skeleton className="ml-auto h-4 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function PeriodLockPage() {
  const canLock = usePermission(PERMISSIONS.ATTENDANCE_LOCK);

  if (!canLock) {
    return (
      <>
        <PageHeader description="Closing a month freezes it against any further change." />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockKeyIcon />
            </EmptyMedia>
            <EmptyTitle>You cannot lock or unlock a period</EmptyTitle>
            <EmptyDescription>
              This needs the attendance.lock permission, which HR and Admin hold. A locked month is
              what payroll is calculated from, so the control is narrow on purpose.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }

  return <PeriodLockBody />;
}

function PeriodLockBody() {
  // Last month rather than this one: locking a month that is still running is
  // almost never what somebody means, and a default that has to be corrected
  // every time is a default that will eventually not be.
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  });
  const [periodOpen, setPeriodOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unlocking, setUnlocking] = useState<PeriodLock | null>(null);

  const query = usePeriodLocks();
  const lock = useLockPeriod();

  const rows = query.data?.value.data ?? [];
  const year = period.getFullYear();
  const month = period.getMonth() + 1;
  const already = rows.find((row) => row.year === year && row.month === month && isLive(row));

  // PRD §6.4: Alt+F2 changes the period.
  useShortcut({
    id: 'period-lock.change-period',
    keys: 'alt+f2',
    label: 'Change period',
    scope: 'screen',
    run: () => {
      setPeriodOpen(true);
    },
  });

  function submitLock() {
    lock.mutate(
      { year, month, locationId: null },
      {
        onSuccess: () => {
          toast.add({
            type: 'success',
            title: `${periodLabel(year, month)} locked`,
            description: 'Nothing in this month can change until it is unlocked.',
          });
          setConfirming(false);
        },
        // No success toast on failure and no optimistic row. The dialog stays
        // open with the error, because a month that was not locked must never
        // look locked.
      },
    );
  }

  return (
    <>
      <PageHeader description="Closing a month freezes it against any further change. Both locking and unlocking are audited." />

      <div className="flex flex-col gap-4">
        {/* Toolbar row (PRD §6.2). */}
        <div className="flex flex-wrap items-center gap-2">
          <MonthField
            value={period}
            onValueChange={setPeriod}
            label="Month to lock"
            open={periodOpen}
            onOpenChange={setPeriodOpen}
            hint={<ShortcutHint keys="alt+f2" className="ml-1 hidden md:inline-flex" />}
          />
          <Button
            className="pointer-coarse:h-11"
            disabled={already !== undefined}
            onClick={() => {
              lock.reset();
              setConfirming(true);
            }}
          >
            <LockSimpleIcon data-icon="inline-start" />
            Lock {periodLabel(year, month)}
          </Button>
          {already !== undefined ? (
            <p className="text-muted-foreground text-xs">
              {periodLabel(year, month)} is already locked.
            </p>
          ) : null}
        </div>

        {query.data?.sample ? <SampleDataNotice what="period lock" /> : null}

        {query.isPending ? <ListSkeleton /> : null}

        {query.isError ? (
          <QueryErrorAlert
            error={query.error}
            subject="period locks"
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : null}

        {query.isSuccess && rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LockKeyOpenIcon />
              </EmptyMedia>
              <EmptyTitle>No month has been locked</EmptyTitle>
              <EmptyDescription>
                Every month is still open, so punches, leave and corrections can still change any
                past day. The payroll handoff only runs from a locked period.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {rows.length > 0 ? (
          <>
            <RecordTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              mobilePrimary={(row) => periodLabel(row.year, row.month)}
              mobileStatus={(row) =>
                isLive(row) ? <Badge>Locked</Badge> : <Badge variant="outline">Unlocked</Badge>
              }
              mobileSupporting={(row) =>
                `${row.locationName ?? 'Whole organisation'} · ${printInstant(row.lockedAt)}`
              }
            />

            <div className="flex flex-col gap-2">
              {rows.filter(isLive).map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-2">
                  <p className="text-muted-foreground min-w-0 flex-1 text-xs">
                    {periodLabel(row.year, row.month)} is locked. Unlocking needs a reason and is
                    recorded against your name.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUnlocking(row);
                    }}
                  >
                    <LockKeyOpenIcon data-icon="inline-start" />
                    Unlock {periodLabel(row.year, row.month)}
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <ConfirmLockDialog
        open={confirming}
        period={periodLabel(year, month)}
        pending={lock.isPending}
        error={lock.error}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={submitLock}
      />

      <UnlockDialog
        lock={unlocking}
        onClose={() => {
          setUnlocking(null);
        }}
      />
    </>
  );
}

function writeFailureCopy(error: unknown, verb: string): { title: string; description: string } {
  if (error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.status === 404)) {
    return {
      title: `Not ${verb}: the period lock endpoint is not built yet`,
      description:
        'POST /attendance/locks does not exist on the server, so nothing was recorded. Nothing about this month has changed.',
    };
  }
  if (error instanceof ApiError && error.code === 'FORBIDDEN') {
    return {
      title: `Not ${verb}`,
      description: 'The server refused this. It needs a permission your account does not hold.',
    };
  }
  return {
    title: `Not ${verb}`,
    description:
      error instanceof ApiError ? error.message : 'Something went wrong on the way. Try again.',
  };
}

function ConfirmLockDialog({
  open,
  period,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  period: string;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lock {period}?</DialogTitle>
          <DialogDescription>
            This is what the rest of the system will refuse afterwards.
          </DialogDescription>
        </DialogHeader>

        <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>No punch can be recorded against a day in this month.</li>
          <li>No leave, regularization or on-duty request can affect it.</li>
          <li>No manual override, and the day engine will not recompute it.</li>
          <li>Unlocking needs an Admin and a typed reason, and both are audited.</li>
        </ul>

        {error != null ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>{writeFailureCopy(error, 'locked').title}</AlertTitle>
            <AlertDescription>{writeFailureCopy(error, 'locked').description}</AlertDescription>
          </Alert>
        ) : null}

        {/* Two short actions fit one row at 360px, so they stay in one row
            rather than stacking and putting the confirm furthest from the
            thumb. */}
        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="flex-1 sm:flex-none" disabled={pending} onClick={onConfirm}>
            {pending ? <Spinner data-icon="inline-start" /> : <LockSimpleIcon data-icon="inline-start" />}
            {pending ? 'Locking' : 'Lock the month'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnlockDialog({ lock, onClose }: { lock: PeriodLock | null; onClose: () => void }) {
  return (
    <Dialog
      open={lock !== null}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {/* Remounted per lock, so the typed reason belongs to the month that
            was opened rather than to whichever was opened first. */}
        {lock ? <UnlockDialogBody key={lock.id} lock={lock} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function UnlockDialogBody({ lock, onClose }: { lock: PeriodLock; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const unlock = useUnlockPeriod();

  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_UNLOCK_REASON;

  function submit() {
    if (tooShort) return;
    unlock.mutate(
      { id: lock.id, reason: trimmed },
      {
        onSuccess: () => {
          toast.add({
            type: 'success',
            title: `${periodLabel(lock.year, lock.month)} unlocked`,
            description: 'Your reason is recorded in the audit log.',
          });
          onClose();
        },
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Unlock {periodLabel(lock.year, lock.month)}?</DialogTitle>
        <DialogDescription>
          The month becomes changeable again. Anything recomputed afterwards can differ from what
          payroll was already given.
        </DialogDescription>
      </DialogHeader>

      {unlock.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>{writeFailureCopy(unlock.error, 'unlocked').title}</AlertTitle>
          <AlertDescription>
            {writeFailureCopy(unlock.error, 'unlocked').description}
          </AlertDescription>
        </Alert>
      ) : null}

      <Field>
        <FieldLabel htmlFor="unlock-reason">Why is this being unlocked?</FieldLabel>
        <Textarea
          id="unlock-reason"
          rows={3}
          maxLength={MAX_UNLOCK_REASON}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <FieldDescription>
          REQ-E-09 requires a reason. It is stored on the lock row and shown in the audit log, so
          write what a reader in six months would need.
        </FieldDescription>
      </Field>

      <DialogFooter className="flex-row justify-end gap-2">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          className="flex-1 sm:flex-none"
          disabled={tooShort || unlock.isPending}
          onClick={submit}
        >
          {unlock.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <LockKeyOpenIcon data-icon="inline-start" />
          )}
          {unlock.isPending ? 'Unlocking' : 'Unlock'}
        </Button>
      </DialogFooter>
    </>
  );
}
