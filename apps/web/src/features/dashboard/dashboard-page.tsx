import { useMemo } from 'react';
import { ArrowRightIcon, DatabaseIcon } from '@phosphor-icons/react';
import { endOfMonth, startOfMonth } from 'date-fns';
import { Link } from 'react-router';

import { PERMISSIONS } from '@vyuha/shared';

import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDuration, toDateParam } from '@/features/attendance/format';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { AttendanceStatusBadge } from '@/features/attendance/status-badge';
import type { AttendanceDay } from '@/features/attendance/types';
import { useAttendanceDays } from '@/features/attendance/use-attendance-days';
import { usePermissions } from '@/lib/session/permissions';
import { useMe } from '@/lib/session/use-session';

/**
 * REQ-K-01, the part of it today's data can answer honestly.
 *
 * Everyone sees their own status now and their own month so far. Anyone who
 * may look beyond themselves also sees the organisation's day, scoped by the
 * server rather than by this component - the same `/attendance/days` call with
 * no employee filter returns exactly what the caller is allowed to see.
 *
 * What is deliberately absent: leave balances, pending approvals and the late
 * trend. REQ-K-01 asks for them and Phase 2 builds the endpoints they read.
 * A tile showing a plausible zero is indistinguishable from a tile showing a
 * true zero, and the first one is a lie that survives until somebody trusts it.
 */

interface Totals {
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  otMinutes: number;
  flagged: number;
}

function summarise(days: readonly AttendanceDay[]): Totals {
  return days.reduce<Totals>(
    (totals, day) => ({
      present: totals.present + (day.status === 'PRESENT' ? 1 : 0),
      halfDay: totals.halfDay + (day.status === 'HALF_DAY' ? 1 : 0),
      absent: totals.absent + (day.status === 'ABSENT' ? 1 : 0),
      leave: totals.leave + (day.status === 'ON_LEAVE' ? 1 : 0),
      otMinutes: totals.otMinutes + day.otMinutes,
      flagged: totals.flagged + (day.flags.length > 0 ? 1 : 0),
    }),
    { present: 0, halfDay: 0, absent: 0, leave: 0, otMinutes: 0, flagged: 0 },
  );
}

/**
 * The one strip pattern this product uses for a row of figures: a bordered
 * band divided by rules. Not a row of cards — CLAUDE.md 3.3 puts content on
 * the page surface, and five cards inside a page is the box in a box.
 */
function FigureStrip({ entries }: { entries: readonly [string, string][] }) {
  return (
    <dl className="divide-border grid grid-cols-2 divide-x divide-y border sm:grid-cols-4 sm:divide-y-0">
      {entries.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 px-3 py-2">
          <dt className="text-muted-foreground text-[0.6875rem]">{label}</dt>
          <dd className="text-base font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-muted-foreground text-xs font-medium tracking-wide">{children}</h2>;
}

function StripSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="border">
      <div aria-hidden className="grid grid-cols-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-1.5 px-3 py-2.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const me = useMe();
  const granted = usePermissions();
  const employeeId = me.data?.user.employeeId ?? null;

  const today = toDateParam(new Date());
  const monthFrom = toDateParam(startOfMonth(new Date()));
  const monthTo = toDateParam(endOfMonth(new Date()));

  // Own month. Today's own row is read out of it rather than fetched again -
  // one request answers both questions, and the two can never disagree.
  const mine = useAttendanceDays(
    { from: monthFrom, to: monthTo, employeeId, pageSize: 31 },
    { enabled: employeeId !== null },
  );

  // The organisation's day. No employee filter: the server's scope predicate
  // decides what comes back, so this is safe for anyone who holds either key
  // and returns their team rather than the org for someone who only holds the
  // team one.
  const canSeeOthers =
    granted.has(PERMISSIONS.ATTENDANCE_VIEW_ALL) || granted.has(PERMISSIONS.ATTENDANCE_VIEW_TEAM);
  const org = useAttendanceDays(
    { from: today, to: today, pageSize: 200 },
    { enabled: canSeeOthers },
  );

  const myDays = useMemo(() => mine.data?.value.data ?? [], [mine.data]);
  const myTotals = useMemo(() => summarise(myDays), [myDays]);
  const myToday = useMemo(() => myDays.find((day) => day.date === today), [myDays, today]);

  const orgDays = useMemo(() => org.data?.value.data ?? [], [org.data]);
  const orgTotals = useMemo(() => summarise(orgDays), [orgDays]);

  const nothingToShow = employeeId === null && !canSeeOthers;

  return (
    <>
      <PageHeader description="Today's attendance at a glance." />

      {nothingToShow ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DatabaseIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing to show yet</EmptyTitle>
            <EmptyDescription>
              This sign-in is not linked to an employee record and cannot see anyone else&apos;s
              attendance, so there is nothing to summarise.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {employeeId !== null ? (
            <section className="flex flex-col gap-2">
              <SectionHeading>Today</SectionHeading>

              {mine.isPending ? <StripSkeleton /> : null}
              {mine.isError ? (
                <QueryErrorAlert
                  error={mine.error}
                  subject="your attendance"
                  onRetry={() => void mine.refetch()}
                />
              ) : null}

              {mine.isSuccess ? (
                <div className="flex flex-wrap items-center gap-3 border px-3 py-2.5">
                  {myToday ? (
                    <AttendanceStatusBadge status={myToday.status} />
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      No day recorded yet — it appears once you punch.
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link to="/punch" />}
                    className="ml-auto"
                  >
                    Punch
                    <ArrowRightIcon />
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}

          {employeeId !== null && mine.isSuccess ? (
            <section className="flex flex-col gap-2">
              <SectionHeading>This month, so far</SectionHeading>
              <FigureStrip
                entries={[
                  ['Present', String(myTotals.present + myTotals.halfDay * 0.5)],
                  ['Absent', String(myTotals.absent)],
                  ['On leave', String(myTotals.leave)],
                  ['Overtime', formatDuration(myTotals.otMinutes)],
                ]}
              />
            </section>
          ) : null}

          {canSeeOthers ? (
            <section className="flex flex-col gap-2">
              <SectionHeading>Everyone, today</SectionHeading>

              {org.isPending ? <StripSkeleton /> : null}
              {org.isError ? (
                <QueryErrorAlert
                  error={org.error}
                  subject="today's attendance"
                  onRetry={() => void org.refetch()}
                />
              ) : null}

              {org.isSuccess ? (
                <>
                  <FigureStrip
                    entries={[
                      ['Present', String(orgTotals.present + orgTotals.halfDay)],
                      ['Absent', String(orgTotals.absent)],
                      ['On leave', String(orgTotals.leave)],
                      ['Flagged', String(orgTotals.flagged)],
                    ]}
                  />
                  {/* A button rather than a link inside the sentence. The
                      44px floor is a min-height, and min-height does nothing
                      to an inline box - the inline version measured 31px and
                      the sweep caught it. Anything meant to be tapped has to
                      be a block-level control. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-muted-foreground text-xs">
                      {orgDays.length === 0
                        ? 'No attendance days recorded for today yet.'
                        : `${String(orgDays.length)} day${orgDays.length === 1 ? '' : 's'} recorded.`}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link to="/team-attendance" />}
                    >
                      Team attendance
                      <ArrowRightIcon />
                    </Button>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
