import { type ReactNode, useMemo, useRef, useState } from 'react';
import { ArrowRightIcon, ChartBarIcon, DatabaseIcon, InfoIcon } from '@phosphor-icons/react';
import { subDays } from 'date-fns';
import { Link } from 'react-router';

import { PERMISSIONS } from '@vyuha/shared';
import type { DateRange } from 'react-day-picker';

import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import { ShortcutHint } from '@/components/shared/shortcut-hint';
import { ACTION_ICONS } from '@/components/shared/action-icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { toDateParam } from '@/features/attendance/format';
import { DateRangeField } from '@/features/attendance/pickers';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { SampleDataNotice } from '@/features/attendance/sample-data-notice';
import { useShortcut } from '@/lib/keyboard/registry';
import { usePermissions } from '@/lib/session/permissions';
import { cn } from '@/lib/utils';

import {
  AttendanceTrendChart,
  ChartSkeleton,
  LateArrivalsChart,
  TeamHoursChart,
} from './charts';
import {
  attendanceTrend,
  dateRange,
  hasValues,
  lateArrivals,
  shortDate,
  teamHours,
  summarise,
} from './series';
import { DASHBOARD_PRESETS } from '@/features/reports/dashboard-v2.presets';

import { useAttendanceRange } from './use-attendance-range';
import { useChartIntro } from './use-chart-motion';

/**
 * REQ-K-01, the part of it today's data can answer honestly.
 *
 * Everyone sees their own day, their own month, and the shape of their own
 * hours. Anyone who may look beyond themselves also sees the organisation's
 * day and two charts over a period they choose - all scoped by the server
 * rather than by this component, since the same `/attendance/days` call with
 * no employee filter returns exactly what the caller is allowed to see.
 *
 * What is deliberately absent: leave balances, pending approvals and unlocked
 * periods. REQ-K-01 asks for all three and Phase 2 builds the endpoints they
 * read. A tile showing a plausible zero is indistinguishable from a tile
 * showing a true zero, and the first one is a lie that survives until somebody
 * trusts it - so the screen says out loud what it cannot show, at the bottom,
 * rather than filling the gap.
 *
 * The same rule governs the charts. Every series here is counted from rows the
 * server sent for the period on screen; there is no target line on the late
 * chart because no endpoint carries a target, and no stacked overtime on the
 * hours chart because the contract does not say whether worked minutes already
 * contain it.
 */

/**
 * The one strip pattern this product uses for a row of figures: a bordered
 * band divided by rules. Not a row of cards - CLAUDE.md 3.3 puts content on
 * the page surface, and five cards inside a page is the box in a box.
 */
const STRIP_COLUMNS: Record<number, string> = {
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
};

/** Label, value, and optionally the glyph the figure's subject wears elsewhere (the flag). */
function FigureStrip({ entries }: { entries: readonly (readonly [string, string] | readonly [string, string, ReactNode])[] }) {
  return (
    <dl
      className={cn(
        'divide-border grid grid-cols-2 divide-x divide-y border sm:divide-y-0',
        STRIP_COLUMNS[entries.length] ?? 'sm:grid-cols-4',
      )}
    >
      {entries.map(([label, value, icon], index) => (
        <div
          key={label}
          className={cn(
            'flex flex-col gap-0.5 px-3 py-2',
            // Five figures in two columns leaves a hole under the last one.
            // Spanning it is the difference between a strip and a strip with a
            // missing tooth.
            entries.length % 2 === 1 && index === entries.length - 1
              ? 'col-span-2 sm:col-span-1'
              : null,
          )}
        >
          <dt className="text-muted-foreground text-[0.6875rem]">
            {icon ? <span aria-hidden className="mr-1 inline-flex align-[-2px] [&_svg]:size-3">{icon}</span> : null}
            {label}
          </dt>
          <dd className="text-base font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The strip's own shape, to the pixel that matters.
 *
 * Measured rather than eyeballed: with the old proportions the page dropped
 * 35px when the figures arrived, which on a screen somebody opens ten times a
 * day is a flinch every time. The cell metrics below match FigureStrip's.
 */
function StripSkeleton({ caption = false }: { caption?: boolean }) {
  return (
    <>
      <div role="status" aria-busy="true" aria-label="Loading" className="border">
        <div aria-hidden className="grid grid-cols-2 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col gap-0.5 px-3 py-2">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-6 w-10" />
            </div>
          ))}
        </div>
      </div>
      {caption ? <Skeleton aria-hidden className="h-4 w-32" /> : null}
    </>
  );
}

/** The one-line "how today went" row, at the height it will be. */
/** A figure and its label, inline, for the row that describes today. */
/**
 * The surface a chart sits on: one border, a caption, and the plot.
 *
 * The caption is inside the border rather than above it because the section
 * already has a heading, and a second heading outside would read as a second
 * section. It is text, not a card header - nothing here nests a surface in a
 * surface.
 */
function ChartPanel({
  caption,
  note,
  children,
}: {
  caption: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-xs font-medium">{caption}</h3>
        {note ? <p className="text-muted-foreground text-[0.6875rem] tabular-nums">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Emil Kowalski's press feedback, spelled out rather than added to the shared
 * Button: components/ui is vendored shadcn source and changing it there would
 * be reverted by the next `shadcn add --diff`. The transition list restates
 * the button's own so tailwind-merge does not drop the colour transitions when
 * it resolves the two `transition-*` classes.
 */
const PRESS =
  'transition-[color,background-color,border-color,box-shadow,transform,scale] duration-100 ease-out-strong active:scale-[0.97]';

export function DashboardPage() {
  const granted = usePermissions();

  const canSeeOthers =
    granted.has(PERMISSIONS.ATTENDANCE_VIEW_ALL) || granted.has(PERMISSIONS.ATTENDANCE_VIEW_TEAM);

  const [range, setRange] = useState<DateRange>(() => ({
    from: subDays(new Date(), 29),
    to: new Date(),
  }));
  const rangeRef = useRef<HTMLDivElement>(null);

  // PRD section 6.4: Alt+F2 changes the period.
  useShortcut({
    id: 'dashboard.period',
    keys: 'alt+f2',
    label: 'Change period',
    scope: 'screen',
    run: () => {
      rangeRef.current?.querySelector<HTMLElement>('button')?.click();
    },
  });

  const now = new Date();
  const today = toDateParam(now);
  const rangeFrom = toDateParam(range.from ?? subDays(now, 29));
  const rangeTo = toDateParam(range.to ?? now);
  const spanDays = dateRange(rangeFrom, rangeTo).length;

  // The organisation's day, and the organisation's period. Two queries rather
  // than one slice of the other: the period can run past what the list
  // endpoint will return in twelve pages, and today's counts must never be
  // computed from a range that came back short.
  const orgToday = useAttendanceRange({ from: today, to: today }, { enabled: canSeeOthers });
  const orgRange = useAttendanceRange({ from: rangeFrom, to: rangeTo }, { enabled: canSeeOthers });

  const orgTodayDays = useMemo(() => orgToday.data?.value.days ?? [], [orgToday.data]);
  const orgTodayTotals = useMemo(() => summarise(orgTodayDays), [orgTodayDays]);

  const rangeDates = useMemo(() => dateRange(rangeFrom, rangeTo), [rangeFrom, rangeTo]);
  const orgRangeDays = useMemo(() => orgRange.data?.value.days ?? [], [orgRange.data]);
  const trendPoints = useMemo(
    () => attendanceTrend(orgRangeDays, rangeDates),
    [orgRangeDays, rangeDates],
  );
  const latePoints = useMemo(
    () => lateArrivals(orgRangeDays, rangeDates),
    [orgRangeDays, rangeDates],
  );
  const teamHoursPoints = useMemo(
    () => teamHours(orgRangeDays, rangeDates),
    [orgRangeDays, rangeDates],
  );
  const rangeTotals = useMemo(() => summarise(orgRangeDays), [orgRangeDays]);
  const worstLate = useMemo(
    () => latePoints.reduce<(typeof latePoints)[number] | null>(
      (worst, point) => (point.late > (worst?.late ?? 0) ? point : worst),
      null,
    ),
    [latePoints],
  );

  // One policy for every chart here: draw once, when the first data lands.
  const rangeIntro = useChartIntro(orgRange.isSuccess);

  const rangeComplete = orgRange.data?.value.complete ?? true;
  // `a ?? b ?? c` was wrong here and quietly so: `??` stops at the first
  // non-nullish value, so a personal query that returned real data (sample:
  // false) hid a sampled organisation query behind it, and the screen would
  // have shown invented rows with no notice.
  const showsSamples = [orgToday.data, orgRange.data].some((result) => result?.sample === true);
  // Nothing personal is left on this screen, so the only question is whether
  // this account may look beyond itself.
  const nothingToShow = !canSeeOthers;
  const atWorkToday = orgTodayTotals.present + orgTodayTotals.halfDay + orgTodayTotals.onDuty;
  const atWorkRange = rangeTotals.present + rangeTotals.halfDay + rangeTotals.onDuty;

  return (
    <>
      <PageHeader description="Today at a glance, and how the period behind it went." />

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
        <div className="flex flex-col gap-8">
          {showsSamples ? <SampleDataNotice what="attendance day" /> : null}

          {/*
            The dashboard is the shared picture, not a personal one.

            It used to open with Today and This month, so far -- the
            signed-in person's own status, their own figures and their own
            worked hours -- above the team sections. Both already exist, in
            more detail and for any month, on /my-attendance, and the punch
            itself is a route of its own. A screen that answers "how are we
            doing" should not lead with one row of it.
          */}
          {canSeeOthers ? (
            <section className="flex flex-col gap-3">
              <SectionHeading
                title="Everyone, today"
                note="Scoped to the people you may see."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link to="/team-attendance" />}
                    className={PRESS}
                  >
                    Team attendance
                    <ArrowRightIcon />
                  </Button>
                }
              />

              {orgToday.isPending ? <StripSkeleton caption /> : null}
              {orgToday.isError ? (
                <QueryErrorAlert
                  error={orgToday.error}
                  subject="today's attendance"
                  onRetry={() => void orgToday.refetch()}
                />
              ) : null}

              {orgToday.isSuccess ? (
                <>
                  <FigureStrip
                    entries={[
                      ['At work', String(atWorkToday)],
                      ['On leave', String(orgTodayTotals.leave)],
                      ['Absent', String(orgTodayTotals.absent)],
                      ['Flagged', String(orgTodayTotals.flagged), <ACTION_ICONS.flag key="flag" />],
                    ]}
                  />
                  <p className="text-muted-foreground text-xs">
                    {orgTodayDays.length === 0
                      ? 'No attendance days recorded for today yet.'
                      : `${String(orgTodayDays.length)} day${orgTodayDays.length === 1 ? '' : 's'} recorded.`}
                  </p>
                </>
              ) : null}
            </section>
          ) : null}

          {canSeeOthers ? (
            <section className="flex flex-col gap-3">
              <SectionHeading
                title="Over time"
                note="Counted from the days the server returned for this period."
                action={
                  <div ref={rangeRef} className="flex items-center gap-2">
                    <DateRangeField
                      value={range}
                      onValueChange={setRange}
                      label="Period"
                      presets={DASHBOARD_PRESETS}
                    />
                    <ShortcutHint keys="alt+f2" className="hidden md:inline-flex" />
                  </div>
                }
              />

              {/* The captions are repeated here on purpose: a skeleton that is
                  not the shape of what replaces it moves the page when the
                  data lands, and this one lands a second after arrival. */}
              {orgRange.isPending ? (
                <div className="flex flex-col gap-3">
                  <ChartPanel caption="Attendance by day">
                    <ChartSkeleton label="Loading attendance by day" className="h-56 sm:h-64" />
                  </ChartPanel>
                  <ChartPanel caption="Late arrivals">
                    <ChartSkeleton label="Loading late arrivals" className="h-40 sm:h-44" />
                  </ChartPanel>
                </div>
              ) : null}

              {orgRange.isError ? (
                <QueryErrorAlert
                  error={orgRange.error}
                  subject="the attendance trend"
                  onRetry={() => void orgRange.refetch()}
                />
              ) : null}

              {orgRange.isSuccess && !rangeComplete ? (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>This period is too large to chart</AlertTitle>
                  <AlertDescription>
                    {`The list endpoint returned ${String(orgRange.data.value.total)} days for these ${String(spanDays)} days, which is more than this screen reads. Choose a shorter period. Charting the part that arrived would show a real dip where the data simply stopped.`}
                  </AlertDescription>
                </Alert>
              ) : null}

              {orgRange.isSuccess && rangeComplete ? (
                <div className="flex flex-col gap-3">
                  <ChartPanel
                    caption="Attendance by day"
                    note={`${String(atWorkRange)} at work · ${String(rangeTotals.leave)} on leave · ${String(rangeTotals.absent)} absent`}
                  >
                    {rangeTotals.rows > 0 ? (
                      <AttendanceTrendChart points={trendPoints} animate={rangeIntro} />
                    ) : (
                      <Empty className="border-0 py-6">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <ChartBarIcon />
                          </EmptyMedia>
                          <EmptyTitle>Nothing recorded in this period</EmptyTitle>
                          <EmptyDescription>
                            The day engine writes a row for every active employee. If nobody has
                            punched in these {String(spanDays)} days, there is nothing to plot.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </ChartPanel>

                  <ChartPanel
                    caption="Hours worked, day by day"
                    note={
                      rangeTotals.rows > 0
                        ? `${String(atWorkRange)} day${atWorkRange === 1 ? '' : 's'} at work in this period`
                        : undefined
                    }
                  >
                    {hasValues(teamHoursPoints, ['workedMinutes']) ? (
                      <TeamHoursChart points={teamHoursPoints} animate={rangeIntro} />
                    ) : (
                      <p className="text-muted-foreground py-6 text-center text-xs">
                        No hours recorded in this period.
                      </p>
                    )}
                  </ChartPanel>

                  <ChartPanel
                    caption="Late arrivals"
                    note={
                      rangeTotals.lateDays > 0 && worstLate
                        ? `${String(rangeTotals.lateDays)} in total · worst ${shortDate(worstLate.date)}`
                        : undefined
                    }
                  >
                    {hasValues(latePoints, ['late']) ? (
                      <LateArrivalsChart points={latePoints} animate={rangeIntro} />
                    ) : (
                      <p className="text-muted-foreground py-6 text-center text-xs">
                        {rangeTotals.rows > 0
                          ? `Nobody arrived late in these ${String(spanDays)} days.`
                          : 'No days recorded in this period.'}
                      </p>
                    )}
                  </ChartPanel>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* REQ-K-01 asks for more than this. Saying which parts are missing
              and why is the only alternative to a tile that invents them. */}
          <section className="flex flex-col gap-2 border-t pt-4">
            <div className="text-muted-foreground flex items-start gap-2 text-xs">
              <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <p>
                Leave balances, pending approvals and unlocked periods are part of this screen and
                are not shown: the endpoints that answer them are not built yet. Nothing above is a
                placeholder — every figure and every bar is counted from attendance days the server
                returned.
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
