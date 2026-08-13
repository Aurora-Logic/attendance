import { useEffect, useState } from 'react';
import {
  CalendarBlankIcon,
  CalendarPlusIcon,
  ClockIcon,
  PlusIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { addDays, startOfMonth } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { useSearchParams } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { RecordPagination } from '@/components/shared/record-pagination';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { SearchField } from '@/components/shared/search-field';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { TabsToolbar, TabsToolbarAction } from '@/components/shared/tabs-toolbar';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatClock, formatDuration, toDateParam } from '@/features/attendance/format';
import { DateRangeField } from '@/features/attendance/pickers';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { SampleDataNotice } from '@/features/attendance/sample-data-notice';
import { useDepartments } from '@/features/attendance/use-attendance-days';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { useShortcut } from '@/lib/keyboard/registry';
import { usePermission } from '@/lib/session/permissions';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PERMISSIONS,
  describeWeeklyOffPattern,
} from '@vyuha/shared';

import { BulkRosterSheet } from './bulk-roster-sheet';
import { RosterSheet } from './roster-sheet';
import { ShiftSheet } from './shift-sheet';
import type { RosterEntry, Shift, WeeklyOffPattern } from './types';
import { WeeklyOffSheet } from './weekly-off-sheet';
import { useRoster, useShifts, useWeeklyOffPatterns } from './use-shifts';

/**
 * REQ-C-01 … REQ-C-05 / PRD section 5 screen 11: shift masters, the weekly-off
 * rules, and who is on which shift.
 *
 * Three tabs rather than three routes. A roster is meaningless without the
 * shift definitions beside it -- "Night, 22:00-06:00" is the only thing that
 * makes a roster row readable -- and a weekly-off pattern is the other half of
 * what decides whether a given date is a working day at all. Splitting them
 * would make checking one against another a navigation.
 */

const ALL = 'ALL';

function readPositiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/** The period both roster surfaces default to: this month, not today. */
function defaultPeriod(): DateRange {
  const first = startOfMonth(new Date());
  return { from: first, to: addDays(first, 30) };
}

const SHIFT_COLUMNS: RecordColumn<Shift>[] = [
  {
    key: 'name',
    header: 'Shift',
    cell: (row) => <span className="font-medium">{row.name}</span>,
  },
  { key: 'code', header: 'Code', cell: (row) => row.code, className: 'tabular-nums' },
  { key: 'in', header: 'In', cell: (row) => formatClock(row.scheduledIn), numeric: true },
  { key: 'out', header: 'Out', cell: (row) => formatClock(row.scheduledOut), numeric: true },
  {
    key: 'break',
    header: 'Break',
    cell: (row) => formatDuration(row.breakMinutes),
    numeric: true,
  },
  {
    key: 'late',
    header: 'Late after',
    cell: (row) => `${String(row.policy.lateAfter)}m`,
    numeric: true,
    secondary: true,
  },
  {
    key: 'fullDay',
    header: 'Full day',
    cell: (row) => formatDuration(row.policy.minFullDayMinutes),
    numeric: true,
    secondary: true,
  },
  {
    key: 'ot',
    header: 'OT after',
    cell: (row) => `${String(row.policy.otAfterMinutes)}m`,
    numeric: true,
    secondary: true,
  },
  {
    key: 'midnight',
    header: 'Midnight',
    cell: (row) => (row.crossesMidnight ? <Badge variant="secondary">Crosses</Badge> : EMPTY_VALUE),
  },
];

const ROSTER_COLUMNS: RecordColumn<RosterEntry>[] = [
  {
    key: 'employee',
    header: 'Employee',
    cell: (row) => <span className="font-medium">{row.employee.name}</span>,
  },
  {
    key: 'code',
    header: 'Code',
    cell: (row) => <span className="tabular-nums">{row.employee.employeeCode}</span>,
  },
  {
    key: 'department',
    header: 'Department',
    cell: (row) => row.department ?? EMPTY_VALUE,
    secondary: true,
  },
  { key: 'shift', header: 'Shift', cell: (row) => row.shift.name },
  {
    key: 'from',
    header: 'From',
    cell: (row) => formatDate(row.from),
    className: 'tabular-nums',
  },
  {
    key: 'to',
    header: 'To',
    // REQ-C-04: an assignment with no end runs until a later one supersedes
    // it. "Open-ended" is the fact; an em dash would read as missing data.
    cell: (row) => (row.to ? formatDate(row.to) : 'Open-ended'),
    className: 'tabular-nums',
  },
];

const PATTERN_COLUMNS: RecordColumn<WeeklyOffPattern>[] = [
  {
    key: 'name',
    header: 'Pattern',
    cell: (row) => <span className="font-medium">{row.name}</span>,
  },
  { key: 'rule', header: 'Days off', cell: (row) => describeWeeklyOffPattern(row.config) },
  {
    key: 'people',
    header: 'People',
    cell: (row) => row.employeeCount,
    numeric: true,
  },
];

function ListSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="border">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
        >
          <Skeleton className="h-3 w-28 shrink-0" />
          <Skeleton className="hidden h-3 w-16 shrink-0 sm:block" />
          <Skeleton className="h-3 w-12 shrink-0" />
          <Skeleton className="ml-auto h-4 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * A write action, or the reason it is unavailable.
 *
 * CLAUDE.md Definition of Done asks for RBAC to be "reflected in the UI
 * (hidden or disabled with a reason)". Disabled with a reason rather than
 * hidden, because a button that is simply absent leaves somebody looking for
 * a screen they think is broken.
 */
function ManageAction({ children, label }: { children: React.ReactElement; label: string }) {
  const allowed = usePermission(PERMISSIONS.SHIFT_MANAGE);
  if (allowed) return children;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // The disabled button cannot receive pointer events, so the span is
          // what the tooltip hangs off.
          <span tabIndex={0} className="inline-flex">
            {children}
          </span>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ShiftsTab() {
  const [open, setOpen] = useState<Shift | 'new' | null>(null);
  const canManage = usePermission(PERMISSIONS.SHIFT_MANAGE);
  const query = useShifts();
  const shifts = query.data?.value.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <TabsToolbarAction>
        <ManageAction label="You need the shift.manage permission to create a shift.">
          <Button
            size="sm"
            className="pointer-coarse:h-11"
            disabled={!canManage}
            onClick={() => {
              setOpen('new');
            }}
          >
            <PlusIcon data-icon="inline-start" />
            New shift
          </Button>
        </ManageAction>
      </TabsToolbarAction>

      {query.data?.sample ? <SampleDataNotice what="shift" /> : null}

      {query.isPending ? <ListSkeleton rows={4} label="Loading shifts" /> : null}

      {query.isError ? (
        <QueryErrorAlert
          error={query.error}
          subject="shifts"
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}

      {query.isSuccess && shifts.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClockIcon />
            </EmptyMedia>
            <EmptyTitle>No shifts yet</EmptyTitle>
            <EmptyDescription>
              A shift names the scheduled hours and the thresholds that turn punches into a day.
              Create one before rostering anybody.
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen('new');
                }}
              >
                <PlusIcon data-icon="inline-start" />
                New shift
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : null}

      {shifts.length > 0 ? (
        <>
          <RecordTable
            columns={SHIFT_COLUMNS}
            rows={shifts}
            rowKey={(row) => row.id}
            mobilePrimary={(row) => row.name}
            mobileStatus={(row) =>
              row.crossesMidnight ? <Badge variant="secondary">Crosses</Badge> : null
            }
            mobileSupporting={(row) =>
              `${row.code} · ${formatClock(row.scheduledIn)}–${formatClock(row.scheduledOut)}`
            }
            onRowActivate={setOpen}
          />
          <p className="text-muted-foreground text-xs">
            Open a shift to see and edit all nine policy fields.
          </p>
        </>
      ) : null}

      <ShiftSheet
        shift={open}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </div>
  );
}

function WeeklyOffsTab() {
  const [open, setOpen] = useState<WeeklyOffPattern | 'new' | null>(null);
  const canManage = usePermission(PERMISSIONS.SHIFT_MANAGE);
  const query = useWeeklyOffPatterns();
  const patterns = query.data?.value.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <TabsToolbarAction>
        <ManageAction label="You need the shift.manage permission to create a pattern.">
          <Button
            size="sm"
            className="pointer-coarse:h-11"
            disabled={!canManage}
            onClick={() => {
              setOpen('new');
            }}
          >
            <PlusIcon data-icon="inline-start" />
            New pattern
          </Button>
        </ManageAction>
      </TabsToolbarAction>

      {query.isPending ? <ListSkeleton rows={3} label="Loading weekly off patterns" /> : null}

      {query.isError ? (
        <QueryErrorAlert
          error={query.error}
          subject="weekly off patterns"
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}

      {query.isSuccess && patterns.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarBlankIcon />
            </EmptyMedia>
            <EmptyTitle>No weekly off patterns</EmptyTitle>
            <EmptyDescription>
              A pattern decides which days of the week are off. Without one, every date is a
              working day and the day engine marks a missed Sunday as absent.
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen('new');
                }}
              >
                <PlusIcon data-icon="inline-start" />
                New pattern
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : null}

      {patterns.length > 0 ? (
        <>
          <RecordTable
            columns={PATTERN_COLUMNS}
            rows={patterns}
            rowKey={(row) => row.id}
            mobilePrimary={(row) => row.name}
            mobileStatus={(row) =>
              row.employeeCount > 0 ? (
                <Badge variant="secondary">{row.employeeCount}</Badge>
              ) : null
            }
            mobileSupporting={(row) => describeWeeklyOffPattern(row.config)}
            onRowActivate={setOpen}
          />
          <p className="text-muted-foreground text-xs">
            A pattern is assigned to a person on their employee record. REQ-C-03&apos;s location
            and department levels are not built yet.
          </p>
        </>
      ) : null}

      <WeeklyOffSheet
        pattern={open}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </div>
  );
}

function RosterTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [periodOpen, setPeriodOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const canManage = usePermission(PERMISSIONS.SHIFT_MANAGE);

  const page = readPositiveInt(searchParams.get('page'), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = readPositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const q = searchParams.get('q')?.trim() ?? '';
  const departmentId = searchParams.get('departmentId');

  // The period defaults to this month rather than to today, because a roster
  // is a range and a one-day range shows nothing that ends tomorrow.
  const [period, setPeriod] = useState<DateRange>(defaultPeriod);

  const [draft, setDraft] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (syncedQ !== q) {
    setSyncedQ(q);
    if (draft.trim() !== q) setDraft(q);
  }

  useEffect(() => {
    if (draft.trim() === q) return undefined;
    const timer = window.setTimeout(() => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          const value = draft.trim();
          if (value) next.set('q', value);
          else next.delete('q');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [draft, q, setSearchParams]);

  // PRD section 6.4: Alt+F2 changes the period.
  useShortcut({
    id: 'shifts.change-period',
    keys: 'alt+f2',
    label: 'Change period',
    scope: 'screen',
    run: () => {
      setPeriodOpen(true);
    },
  });

  const departments = useDepartments();
  const shifts = useShifts();
  const query = useRoster({
    from: toDateParam(period.from ?? new Date()),
    to: toDateParam(period.to ?? period.from ?? new Date()),
    departmentId,
    q,
    page,
    pageSize,
  });

  const rows = query.data?.value.data ?? [];
  const total = query.data?.value.meta.total ?? 0;
  const filtered = q.length > 0 || departmentId !== null;
  const departmentOptions = departments.data?.value.data ?? [];
  const shiftOptions = shifts.data?.value.data ?? [];

  function clearFilters() {
    setDraft('');
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('q');
      next.delete('departmentId');
      next.delete('page');
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeField
          value={period}
          onValueChange={setPeriod}
          label="Roster period"
          open={periodOpen}
          onOpenChange={setPeriodOpen}
          hint={<ShortcutHint keys="alt+f2" className="ml-1 hidden md:inline-flex" />}
        />

        <SearchField
          id="roster-search"
          label="Search employees"
          placeholder="Code or name"
          value={draft}
          onValueChange={setDraft}
          className="w-full sm:w-56"
        />

        <Select
          value={departmentId ?? ALL}
          onValueChange={(next: string | null) => {
            setSearchParams((current) => {
              const params = new URLSearchParams(current);
              if (next === null || next === ALL) params.delete('departmentId');
              else params.set('departmentId', next);
              params.delete('page');
              return params;
            });
          }}
        >
          <SelectTrigger
            aria-label="Filter by department"
            className="pointer-coarse:h-11 w-full sm:w-44"
          >
            <SelectValue>
              {(value: string) =>
                departmentOptions.find((option) => option.id === value)?.name ?? 'All departments'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>All departments</SelectItem>
              {departmentOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        {filtered ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}

        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <ManageAction label="You need the shift.manage permission to change a roster.">
            <Button
              variant="outline"
              size="sm"
              className="pointer-coarse:h-11 flex-1 sm:flex-none"
              disabled={!canManage}
              onClick={() => {
                setBulkOpen(true);
              }}
            >
              <UsersThreeIcon data-icon="inline-start" />
              Bulk assign
            </Button>
          </ManageAction>
          <ManageAction label="You need the shift.manage permission to change a roster.">
            <Button
              size="sm"
              className="pointer-coarse:h-11 flex-1 sm:flex-none"
              disabled={!canManage}
              onClick={() => {
                setAssignOpen(true);
              }}
            >
              <CalendarPlusIcon data-icon="inline-start" />
              Assign
            </Button>
          </ManageAction>
        </div>
      </div>

      {query.data?.sample ? <SampleDataNotice what="roster" /> : null}

      {query.isPending ? <ListSkeleton rows={8} label="Loading the roster" /> : null}

      {query.isError ? (
        <QueryErrorAlert
          error={query.error}
          subject="rosters"
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}

      {query.isSuccess && rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarBlankIcon />
            </EmptyMedia>
            <EmptyTitle>{filtered ? 'No matching assignments' : 'Nobody rostered'}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? 'No assignment matches this search and department in the chosen period.'
                : 'Nobody is assigned to a shift in this period. Without an assignment an employee falls back to their default shift.'}
            </EmptyDescription>
          </EmptyHeader>
          {filtered ? (
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : null}

      {rows.length > 0 ? (
        <>
          <RecordTable
            columns={ROSTER_COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            mobilePrimary={(row) => row.employee.name}
            mobileStatus={(row) => <Badge variant="secondary">{row.shift.code}</Badge>}
            mobileSupporting={(row) =>
              `${row.employee.employeeCode} · ${formatDate(row.from)} – ${row.to ? formatDate(row.to) : 'open'}`
            }
          />
          <RecordPagination page={page} pageSize={pageSize} total={total} />
        </>
      ) : null}

      <RosterSheet
        open={assignOpen}
        onOpenChange={setAssignOpen}
        shifts={shiftOptions}
        defaultPeriod={period}
      />
      <BulkRosterSheet
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        shifts={shiftOptions}
        departments={departmentOptions}
        defaultPeriod={period}
      />
    </div>
  );
}

export function ShiftsPage() {
  return (
    <>
      <PageHeader description="Shift definitions, weekly off rules, and who is assigned to them." />

      <Tabs defaultValue="shifts" className="gap-4">
        <TabsToolbar
          list={
            <TabsList>
              <TabsTrigger value="shifts" className="pointer-coarse:min-h-11 px-3">
                Shifts
              </TabsTrigger>
              <TabsTrigger value="roster" className="pointer-coarse:min-h-11 px-3">
                Roster
              </TabsTrigger>
              <TabsTrigger value="weekly-offs" className="pointer-coarse:min-h-11 px-3">
                Weekly offs
              </TabsTrigger>
            </TabsList>
          }
        >
          <TabsContent value="shifts">
            <ShiftsTab />
          </TabsContent>
          <TabsContent value="roster">
            <RosterTab />
          </TabsContent>
          <TabsContent value="weekly-offs">
            <WeeklyOffsTab />
          </TabsContent>
        </TabsToolbar>
      </Tabs>
    </>
  );
}
