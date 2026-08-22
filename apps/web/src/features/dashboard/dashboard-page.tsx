import { type ReactNode, useMemo, useRef, useState } from 'react';
import { ArrowRightIcon, ChartBarIcon, DatabaseIcon, InfoIcon } from '@phosphor-icons/react';
import { endOfMonth, startOfMonth, subDays } from 'date-fns';
import { Link } from 'react-router';

import { PERMISSIONS } from '@vyuha/shared';

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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatClock, formatDuration, toDateParam } from '@/features/attendance/format';
import { QueryErrorAlert } from '@/features/attendance/query-error';
import { SampleDataNotice } from '@/features/attendance/sample-data-notice';
import { AttendanceStatusBadge } from '@/features/attendance/status-badge';
import { useShortcut } from '@/lib/keyboard/registry';
import { useCanViewOvertime } from '@/features/attendance/visibility';
import { usePermissions } from '@/lib/session/permissions';
import { useMe } from '@/lib/session/use-session';
import { cn } from '@/lib/utils';

import { AttendanceTrendChart, ChartSkeleton, LateArrivalsChart, WorkedHoursChart } from './charts';
import {
  attendanceTrend,
  dateRange,
  hasValues,
  lateArrivals,
  ownHours,
  shortDate,
  summarise,
} from './series';
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

type RangeDays = 7 | 30 | 90;
const RANGE_OPTIONS: RangeDays[] = [7, 30, 90];

function isRangeDays(value: string | undefined): value is `${RangeDays}` {
  return value === '7' || value === '30' || value === '90';
}

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
function TodaySkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading today"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border px-3 py-2.5"
    >
      <Skeleton aria-hidden className="h-5 w-16" />
      <Skeleton aria-hidden className="h-3.5 w-16" />
      <Skeleton aria-hidden className="h-3.5 w-16" />
      <Skeleton aria-hidden className="h-3.5 w-24" />
    </div>
  );
}

/** A figure and its label, inline, for the row that describes today. */
function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

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
  const me = useMe();
  const granted = usePermissions();
  const canViewOvertime = useCanViewOvertime();
  const employeeId = me.data?.user.employeeId ?? null;

  const canSeeOthers =
    granted.has(PERMISSIONS.ATTENDANCE_VIEW_ALL) || granted.has(PERMISSIONS.ATTENDANCE_VIEW_TEAM);

  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const rangeRef = useRef<HTMLDivElement>(null);

  // PRD §6.4: Alt+F2 changes the period. The toggle group is a composite, so
  // the honest equivalent of "open the picker" is to put the caret in it and
  // let the arrow keys do the rest.
  useShortcut({
    id: 'dashboard.period',
    keys: 'alt+f2',
    label: 'Change period',
    scope: 'screen',
    run: () => {
      const group = rangeRef.current;
      const pressed = group?.querySelector<HTMLElement>('[aria-pressed="true"]');
      (pressed ?? group?.querySelector<HTMLElement>('[data-slot="toggle-group-item"]'))?.focus();
    },
  });

  const now = new Date();
  const today = toDateParam(now);
  const monthFrom = toDateParam(startOfMonth(now));
  const monthTo = toDateParam(endOfMonth(now));
  const rangeFrom = toDateParam(subDays(now, rangeDays - 1));

  // Own month. Today's own row is read out of it rather than fetched again -
  // one request answers both questions, and the two can never disagree.
  const mine = useAttendanceRange(
    { from: monthFrom, to: monthTo, employeeId },
    { enabled: employeeId !== null },
  );

  // The organisation's day, and the organisation's period. Two queries rather
  // than one slice of the other: the period can run past what the list
  // endpoint will return in twelve pages, and today's counts must never be
  // computed from a range that came back short.
  const orgToday = useAttendanceRange({ from: today, to: today }, { enabled: canSeeOthers });
  const orgRange = useAttendanceRange({ from: rangeFrom, to: today }, { enabled: canSeeOthers });

  const myDays = useMemo(() => mine.data?.value.days ?? [], [mine.data]);
  const myTotals = useMemo(() => summarise(myDays), [myDays]);
  const myToday = useMemo(() => myDays.find((day) => day.date === today), [myDays, today]);
  const myHours = useMemo(
    () => ownHours(myDays, dateRange(monthFrom, today)),
    [myDays, monthFrom, today],
  );

  const orgTodayDays = useMemo(() => orgToday.data?.value.days ?? [], [orgToday.data]);
  const orgTodayTotals = useMemo(() => summarise(orgTodayDays), [orgTodayDays]);

  const rangeDates = useMemo(() => dateRange(rangeFrom, today), [rangeFrom, today]);
  const orgRangeDays = useMemo(() => orgRange.data?.value.days ?? [], [orgRange.data]);
  const trendPoints = useMemo(
    () => attendanceTrend(orgRangeDays, rangeDates),
    [orgRangeDays, rangeDates],
  );
  const latePoints = useMemo(
    () => lateArrivals(orgRangeDays, rangeDates),
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

  // One policy for all three charts: draw once, when the first data lands.
  const hoursIntro = useChartIntro(mine.isSuccess);
  const rangeIntro = useChartIntro(orgRange.isSuccess);

  const rangeComplete = orgRange.data?.value.complete ?? true;
  // `a ?? b ?? c` was wrong here and quietly so: `??` stops at the first
  // non-nullish value, so a personal query that returned real data (sample:
  // false) hid a sampled organisation query behind it, and the screen would
  // have shown invented rows with no notice.
  const showsSamples = [mine.data, orgToday.data, orgRange.data].some(
    (result) => result?.sample === true,
  );
  const nothingToShow = employeeId === null && !canSeeOthers;
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

          {employeeId !== null ? (
            <section className="flex flex-col gap-3">
              <SectionHeading
                title="Today"
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link to="/punch" />}
                    className={PRESS}
                  >
                    Punch
                    <ArrowRightIcon />
                  </Button>
                }
              />

              {mine.isPending ? <TodaySkeleton /> : null}
              {mine.isError ? (
                <QueryErrorAlert
                  error={mine.error}
                  subject="your attendance"
                  onRetry={() => void mine.refetch()}
                />
              ) : null}

              {mine.isSuccess ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border px-3 py-2.5">
                  {myToday ? (
                    <>
                      <AttendanceStatusBadge status={myToday.status} />
                      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <Reading label="In" value={formatClock(myToday.firstIn)} />
                        <Reading label="Out" value={formatClock(myToday.lastOut)} />
                        <Reading label="Worked" value={formatDuration(myToday.workedMinutes)} />
                      </dl>
                    </>
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      No day recorded yet — it appears once you punch.
                    </span>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          {employeeId !== null && mine.isSuccess ? (
            <section className="flex flex-col gap-3">
              <SectionHeading
                title="This month, so far"
                note="Your own days, counted from the first of the month."
              />
              {/* The overtime tile is dropped, not blanked, for a viewer the
                  server withholds overtime from. It rendered an em dash, which
                  leaks no number but states something false: "you did no
                  overtime" rather than "this is not yours to see". */}
              <FigureStrip
                entries={[
                  ['Present', String(myTotals.present)],
                  ['Half day', String(myTotals.halfDay)],
                  ['On leave', String(myTotals.leave)],
                  ['Absent', String(myTotals.absent)],
                  ...(canViewOvertime
                    ? ([['Overtime', formatDuration(myTotals.otMinutes)]] as [string, string][])
                    : []),
                ]}
              />

              <ChartPanel
                caption="Hours worked, day by day"
                note={
                  myTotals.lateDays > 0
                    ? `${String(myTotals.lateDays)} late arrival${myTotals.lateDays === 1 ? '' : 's'}`
                    : undefined
                }
              >
                {hasValues(myHours, ['workedMinutes']) ? (
                  <WorkedHoursChart points={myHours} animate={hoursIntro} />
                ) : (
                  <p className="text-muted-foreground py-6 text-center text-xs">
                    No hours recorded this month yet.
                  </p>
                )}
              </ChartPanel>
            </section>
          ) : null}

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
                    <ToggleGroup
                      variant="outline"
                      aria-label="Period"
                      value={[String(rangeDays)]}
                      onValueChange={(value) => {
                        // Base UI hands back an empty array when the pressed
                        // item is pressed again. There is no "no period".
                        const next = value[0];
                        if (isRangeDays(next)) setRangeDays(Number(next) as RangeDays);
                      }}
                    >
                      {RANGE_OPTIONS.map((option) => (
                        <ToggleGroupItem
                          key={option}
                          value={String(option)}
                          // The 44px floor in index.css does not reach a
                          // toggle: the vendored shadcn variant keeps the box
                          // at 32px and grows an invisible ::after hit area
                          // instead. That satisfies a thumb and fails both
                          // CLAUDE.md 3.1 as written and the route sweep,
                          // which measures the element. Same idiom the muster
                          // toolbar uses for its select.
                          className={cn(' px-2.5', PRESS)}
                        >
                          {String(option)}d
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
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
                    {`The list endpoint returned ${String(orgRange.data.value.total)} days for these ${String(rangeDays)} days, which is more than this screen reads. Choose a shorter period. Charting the part that arrived would show a real dip where the data simply stopped.`}
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
                            punched in these {String(rangeDays)} days, there is nothing to plot.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
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
                          ? `Nobody arrived late in these ${String(rangeDays)} days.`
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
