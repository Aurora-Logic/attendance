import { useMemo, useState } from 'react';
import { CalendarXIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { endOfMonth, isSameMonth, startOfMonth } from 'date-fns';

import { PageHeader } from '@/components/shared/page-header';
import { RecordTable, type RecordColumn } from '@/components/shared/record-table';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { EMPTY_VALUE, formatDate } from '@/lib/format';
import { useShortcut } from '@/lib/keyboard/registry';

import { DayDetailSheet } from './day-detail-sheet';
import { formatClock, formatDuration, fromDateParam, toDateParam } from './format';
import { MonthCalendar } from './month-calendar';
import { MonthField } from './pickers';
import { QueryErrorAlert } from './query-error';
import { SampleDataNotice } from './sample-data-notice';
import { AttendanceFlags, AttendanceStatusBadge } from './status-badge';
import type { AttendanceDay } from './types';
import { useAttendanceDays } from './use-attendance-days';

/**
 * REQ-E-01, REQ-E-02 / PRD §5 screen 4: one employee's own month.
 *
 * Calendar and list rather than one or the other. The calendar answers "how
 * was the month" in a glance, which is what somebody opens this screen for;
 * the list answers "what happened on the 14th", which is what they open it for
 * the second time. Selecting a day in either opens the same detail sheet.
 */

const COLUMNS: RecordColumn<AttendanceDay>[] = [
  {
    key: 'date',
    header: 'Date',
    // REQ-L-01: dd-MM-yyyy, never the raw ISO string the API sends.
    cell: (row) => <span className="font-medium tabular-nums">{formatDate(row.date)}</span>,
    className: 'tabular-nums',
  },
  {
    key: 'shift',
    header: 'Shift',
    cell: (row) => row.shiftName ?? EMPTY_VALUE,
    secondary: true,
  },
  { key: 'in', header: 'In', cell: (row) => formatClock(row.firstIn), numeric: true },
  { key: 'out', header: 'Out', cell: (row) => formatClock(row.lastOut), numeric: true },
  {
    key: 'worked',
    header: 'Worked',
    cell: (row) => formatDuration(row.workedMinutes),
    numeric: true,
  },
  {
    key: 'ot',
    header: 'OT',
    cell: (row) => formatDuration(row.otMinutes),
    numeric: true,
    secondary: true,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <AttendanceStatusBadge status={row.status} />,
  },
  {
    key: 'flags',
    header: 'Flags',
    cell: (row) => (row.flags.length > 0 ? <AttendanceFlags flags={row.flags} /> : EMPTY_VALUE),
    secondary: true,
  },
];

/** Mirrors the calendar and the list it stands in for, so nothing resizes. */
function MonthSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading your attendance" className="flex flex-col gap-4">
      <div aria-hidden className="flex flex-col gap-2 border p-3">
        <Skeleton className="h-6 w-40 self-center" />
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }, (_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      </div>
      <div aria-hidden className="border">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex min-h-9 items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
            <Skeleton className="h-3 w-20 shrink-0" />
            <Skeleton className="hidden h-3 w-16 shrink-0 sm:block" />
            <Skeleton className="h-3 w-12 shrink-0" />
            <Skeleton className="ml-auto h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface Totals {
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  otMinutes: number;
}

function summarise(days: AttendanceDay[]): Totals {
  return days.reduce<Totals>(
    (totals, day) => ({
      present: totals.present + (day.status === 'PRESENT' ? 1 : 0),
      // A half day counts as half a day present, which is the number a payroll
      // operator expects to see, so it is reported separately rather than
      // folded into either column.
      halfDay: totals.halfDay + (day.status === 'HALF_DAY' ? 1 : 0),
      absent: totals.absent + (day.status === 'ABSENT' ? 1 : 0),
      leave: totals.leave + (day.status === 'ON_LEAVE' ? 1 : 0),
      otMinutes: totals.otMinutes + day.otMinutes,
    }),
    { present: 0, halfDay: 0, absent: 0, leave: 0, otMinutes: 0 },
  );
}

function SummaryStrip({ totals }: { totals: Totals }) {
  const entries: [string, string][] = [
    ['Present', String(totals.present)],
    ['Half days', String(totals.halfDay)],
    ['Absent', String(totals.absent)],
    ['On leave', String(totals.leave)],
    ['Overtime', formatDuration(totals.otMinutes)],
  ];

  return (
    // A bordered strip divided by rules, not five cards. PRD §6.2 puts the
    // content directly on the page surface, and five cards inside a page is
    // the box-in-box this product does not do.
    <dl className="divide-border grid grid-cols-2 divide-x divide-y border sm:grid-cols-5 sm:divide-y-0">
      {entries.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 px-3 py-2">
          <dt className="text-muted-foreground text-[0.6875rem]">{label}</dt>
          <dd className="text-base font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MyAttendancePage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<AttendanceDay | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const from = toDateParam(startOfMonth(month));
  const to = toDateParam(endOfMonth(month));

  const query = useAttendanceDays({
    from,
    to,
    // The server resolves `me` from the session; the client never sends its own
    // employee id for its own records, so a tampered id cannot widen the scope.
    employeeId: 'me',
    pageSize: 31,
  });

  const days = useMemo(() => query.data?.value.data ?? [], [query.data]);
  const totals = useMemo(() => summarise(days), [days]);
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  // PRD §6.4: F2 changes the date. On a month view that means the month.
  useShortcut({
    id: 'my-attendance.change-month',
    keys: 'f2',
    label: 'Change month',
    scope: 'screen',
    run: () => {
      setMonthPickerOpen(true);
    },
  });

  function step(delta: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  const atCurrentMonth = isSameMonth(month, new Date());

  return (
    <>
      <PageHeader description="Your attendance for the month, day by day." />

      <div className="flex flex-col gap-4">
        {/* Toolbar row (PRD §6.2). Wraps rather than scrolling sideways at
            360px. */}
        <div className="flex flex-wrap items-center gap-2">
          <ButtonGroup>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              className="pointer-coarse:size-11"
              onClick={() => {
                step(-1);
              }}
            >
              <CaretLeftIcon />
            </Button>
            {/* Open state is owned here rather than inside the field, because
                F2 has to be able to open it without a click (PRD §6.4). */}
            <MonthField
              value={month}
              onValueChange={(next) => {
                setMonth(startOfMonth(next));
              }}
              label="Month"
              open={monthPickerOpen}
              onOpenChange={setMonthPickerOpen}
              hint={<ShortcutHint keys="f2" className="ml-1 hidden md:inline-flex" />}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              // A month that has not happened has no attendance in it, so
              // stepping into it is disabled rather than showing an empty grid
              // that looks like a loading failure.
              disabled={atCurrentMonth}
              className="pointer-coarse:size-11"
              onClick={() => {
                step(1);
              }}
            >
              <CaretRightIcon />
            </Button>
          </ButtonGroup>

          {!atCurrentMonth ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMonth(startOfMonth(new Date()));
              }}
            >
              This month
            </Button>
          ) : null}
        </div>

        {query.data?.sample ? <SampleDataNotice what="attendance day" /> : null}

        {query.isPending ? <MonthSkeleton /> : null}

        {query.isError ? (
          <QueryErrorAlert
            error={query.error}
            subject="attendance"
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : null}

        {query.isSuccess ? (
          <>
            <SummaryStrip totals={totals} />

            <MonthCalendar
              month={month}
              onMonthChange={setMonth}
              days={days}
              selected={selected ? fromDateParam(selected.date) : undefined}
              onSelectDay={(date) => {
                // A day outside the fetched month, or one before the employee
                // joined, has no record. Opening an empty sheet for it would
                // be worse than not opening one.
                const match = byDate.get(toDateParam(date));
                if (match) setSelected(match);
              }}
            />

            {days.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CalendarXIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nothing recorded this month</EmptyTitle>
                  <EmptyDescription>
                    Days appear here once you punch, or once the nightly job closes out the date.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <RecordTable
                columns={COLUMNS}
                rows={days}
                rowKey={(row) => row.date}
                mobilePrimary={(row) => formatDate(row.date)}
                mobileStatus={(row) => <AttendanceStatusBadge status={row.status} />}
                mobileSupporting={(row) =>
                  `${formatClock(row.firstIn)}–${formatClock(row.lastOut)} · ${formatDuration(row.workedMinutes)}`
                }
                onRowActivate={setSelected}
              />
            )}
          </>
        ) : null}
      </div>

      <DayDetailSheet
        day={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}
