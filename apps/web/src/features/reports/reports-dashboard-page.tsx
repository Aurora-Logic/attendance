import { ArrowRightIcon, ChartBarIcon, HourglassMediumIcon, LockKeyIcon, PackageIcon, SunHorizonIcon, TrendDownIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import { useChartIntro } from '@/components/shared/use-chart-motion';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { ACTION_ICONS } from '@/components/shared/action-icons';
import { EarlyStreakBadge } from '@/features/attendance/status-badge';
import { useApprovals } from '@/features/approvals/use-approvals';

import { useReportRows } from './api';
import { CompositionDonut, GenericReportChart, MonthlyValueChart, RateRadial, ReportChart, ShareRadialChart } from './report-charts';
import { inr, lapseSeries } from './report-series';
import { comparisonRange, deltaOf, periodForGranularity } from './period-compare';

/**
 * The Reports dashboard (14 Area AI): a tile is a report with a figure and
 * a drill target, never a query written twice — every number here is the
 * first page or the total of a registered report, and clicking it opens
 * that report with the same meaning (REQ-AI-02, AI-03). A tile whose data
 * the caller may not see is absent, not zero (REQ-AI-05): the whole page
 * sits behind the same receivables gate as the reports it draws from.
 */

const TWELVE_MONTHS_AGO = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  d.setDate(1);
  return d.toLocaleDateString('en-CA');
};
const TODAY = () => new Date().toLocaleDateString('en-CA');
const THIRTY_DAYS_AGO = () => new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('en-CA');

/** One bordered surface per block — a dashboard reads as tiles, not floating ink. */
function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  // min-w-0: a grid item defaults to min-width:auto, and a chart's intrinsic
  // width would otherwise widen the column past a phone (measured: 505px at 360).
  return <div className={cn('min-w-0 rounded-lg border p-4', className)}>{children}</div>;
}

function StatTile({ label, value, hint, icon, onOpen, tone }: { label: string; value: string; hint: string; icon: React.ReactNode; onOpen: () => void; tone?: 'warn' | 'bad' }) {
  return (
    <Button
      variant="outline"
      onClick={onOpen}
      className="group h-auto flex-col items-start gap-1 rounded-lg px-4 py-3 text-left whitespace-normal hover:shadow-sm"
    >
      <span className="text-muted-foreground flex w-full items-center gap-1.5 text-xs font-normal">
        {icon}
        {label}
        <ArrowRightIcon className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className={tone === 'bad' ? 'text-destructive text-xl font-semibold tabular-nums' : tone === 'warn' ? 'text-warning text-xl font-semibold tabular-nums' : 'text-xl font-semibold tabular-nums'}>{value}</span>
      <span className="text-muted-foreground text-xs font-normal line-clamp-2">{hint}</span>
    </Button>
  );
}

export function ReportsDashboardPage() {
  const navigate = useNavigate();
  const canView = usePermission(PERMISSIONS.RECEIVABLES_VIEW);
  // Owner, 22 Aug 2026: the attendance block, for whoever may see the whole org's attendance.
  const canViewAttendance = usePermission(PERMISSIONS.ATTENDANCE_VIEW_ALL);
  const page = { page: 1, pageSize: 200 } as const;
  const onTime = useReportRows('on-time-rate', { ...page, from: THIRTY_DAYS_AGO(), to: TODAY() }, { enabled: canView && canViewAttendance });
  const streaks = useReportRows('early-arrival-leaderboard', { page: 1, pageSize: 5, from: THIRTY_DAYS_AGO(), to: TODAY() }, { enabled: canView && canViewAttendance });
  const turnaround = useReportRows('approvals-turnaround', { ...page, from: THIRTY_DAYS_AGO(), to: TODAY() }, { enabled: canView && canViewAttendance });
  const openFlags = useApprovals(
    { page: 1, pageSize: 1, view: 'inbox', type: 'FLAGGED_PUNCH', status: 'PENDING' },
    { enabled: canView && canViewAttendance },
  );
  const credit = useReportRows('credit-cycle', page, { enabled: canView });
  const breaches = useReportRows('credit-breaches', { page: 1, pageSize: 1 }, { enabled: canView });
  const lapse = useReportRows('customer-lapse', page, { enabled: canView });
  const dead = useReportRows('dead-stock', page, { enabled: canView });
  const lowStock = useReportRows('low-stock', { page: 1, pageSize: 1 }, { enabled: canView });
  const stale = useReportRows('stale-projections', { page: 1, pageSize: 1 }, { enabled: canView });
  const salesByMonth = useReportRows('sales-analysis', { ...page, groupBy: 'month', from: TWELVE_MONTHS_AGO(), to: TODAY() }, { enabled: canView });
  const salesByParty = useReportRows('sales-analysis', { ...page, groupBy: 'party', from: TWELVE_MONTHS_AGO(), to: TODAY() }, { enabled: canView });
  const ageing = useReportRows('stock-ageing', page, { enabled: canView });
  const fillRate = useReportRows('order-fill-rate', page, { enabled: canView });
  const pipeline = useReportRows('order-pipeline', page, { enabled: canView });
  // Revenue this FY against last FY, like-for-like to today (data-analyst §3).
  const fyRange = periodForGranularity('year', TODAY());
  const fyPrev = comparisonRange(fyRange, 'lastYear');
  const fyRevenue = useReportRows('sales-analysis', { ...page, groupBy: 'month', ...fyRange }, { enabled: canView });
  const fyRevenuePrev = useReportRows('sales-analysis', { ...page, groupBy: 'month', ...fyPrev }, { enabled: canView });
  const movement = useReportRows('movement-analysis', { ...page, from: TWELVE_MONTHS_AGO(), to: TODAY() }, { enabled: canView });

  const chartsReady = salesByMonth.isSuccess && movement.isSuccess && lapse.isSuccess;
  const intro = useChartIntro(chartsReady);

  if (!canView) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockKeyIcon />
          </EmptyMedia>
          <EmptyTitle>You cannot view the reports dashboard</EmptyTitle>
          <EmptyDescription>It draws on the receivables and inventory reports, which need receivables.view.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const exposure = (credit.data?.data ?? []).reduce((sum, row) => sum + Number(row.cells.exposure ?? 0), 0);
  const sumValue = (rows: readonly { cells: Readonly<Record<string, unknown>> }[] | undefined) => (rows ?? []).reduce((sum, row) => sum + Number(row.cells.value ?? 0), 0);
  const fyNow = sumValue(fyRevenue.data?.data);
  const fyThen = sumValue(fyRevenuePrev.data?.data);
  const fyDelta = deltaOf(fyNow, fyThen);
  const fills = fillRate.data?.data ?? [];
  const orderedTotal = fills.reduce((sum, row) => sum + Number(row.cells.orderedQty ?? 0), 0);
  const dispatchedTotal = fills.reduce((sum, row) => sum + Number(row.cells.dispatchedQty ?? 0), 0);
  const orgFillPct = orderedTotal > 0 ? (dispatchedTotal / orderedTotal) * 100 : null;
  const lapseTotals = lapseSeries(lapse.data?.data ?? []);
  const atRisk = lapseTotals.points.reduce((sum, p) => sum + p.revenue, 0);
  const deadValue = (dead.data?.data ?? []).reduce((sum, row) => sum + Number(row.cells.valueLocked ?? 0), 0);
  const loading = credit.isPending || lapse.isPending || dead.isPending;

  function open(query: string) {
    void navigate(`/reports?${query}`);
  }

  return (
    <>
      <PageHeader description="The figures behind the reports, each one a door into the report it came from. Every number is as of the last pull." />
      <div className="flex flex-col gap-8">
        {loading ? (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            <StatTile
              label="Revenue this FY"
              value={`₹${inr(fyNow)}`}
              hint={fyDelta.label === 'new' ? 'All of it new against last FY to date' : fyDelta.pct === null ? 'No sales either FY to date' : `${fyDelta.direction === 'down' ? '' : '+'}${String(fyDelta.pct)}% vs last FY to date (₹${inr(fyThen)})`}
              icon={<ChartBarIcon />}
              tone={fyDelta.direction === 'down' ? 'bad' : undefined}
              onOpen={() => {
                open(`report=sales-analysis&groupBy=month&from=${fyRange.from}&to=${fyRange.to}&compare=lastYear&granularity=year`);
              }}
            />
            <StatTile
              label="Receivables exposure"
              value={`₹${inr(exposure)}`}
              hint={`${String(credit.data?.meta.total ?? 0)} debtors, from the credit cycle`}
              icon={<ChartBarIcon />}
              onOpen={() => {
                open('report=credit-cycle');
              }}
            />
            <StatTile
              label="Over the credit limit"
              value={String(breaches.data?.meta.total ?? 0)}
              hint="Parties past their limit right now"
              icon={<WarningCircleIcon />}
              tone={(breaches.data?.meta.total ?? 0) > 0 ? 'bad' : undefined}
              onOpen={() => {
                open('report=credit-breaches');
              }}
            />
            <StatTile
              label="Revenue going quiet"
              value={`₹${inr(atRisk)}`}
              hint="Last 12 months' revenue of lapsed and at-risk customers"
              icon={<TrendDownIcon />}
              tone={atRisk > 0 ? 'warn' : undefined}
              onOpen={() => {
                open('report=customer-lapse');
              }}
            />
            <StatTile
              label="Dead stock value"
              value={`₹${inr(deadValue)}`}
              hint={`${String(dead.data?.meta.total ?? 0)} items with no sale in 90 days`}
              icon={<PackageIcon />}
              tone={deadValue > 0 ? 'warn' : undefined}
              onOpen={() => {
                open('report=dead-stock');
              }}
            />
            <StatTile
              label="Below reorder level"
              value={String(lowStock.data?.meta.total ?? 0)}
              hint="Items at or under reorder, net of open POs"
              icon={<PackageIcon />}
              onOpen={() => {
                open('report=low-stock');
              }}
            />
            <StatTile
              label="Stale projections"
              value={String(stale.data?.meta.total ?? 0)}
              hint="Companies whose last pull is over a day old"
              icon={<HourglassMediumIcon />}
              tone={(stale.data?.meta.total ?? 0) > 0 ? 'bad' : undefined}
              onOpen={() => {
                open('report=stale-projections');
              }}
            />
          </div>
        )}

        <Panel>
        <section className="flex flex-col gap-2">
          <SectionHeading
            title="Sales by month"
            note="Invoiced value from the projection, last twelve months."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  open(`report=sales-analysis&groupBy=month&from=${TWELVE_MONTHS_AGO()}&to=${TODAY()}`);
                }}
              >
                Open report
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            }
          />
          {salesByMonth.isPending ? <Skeleton className="h-56 w-full" /> : null}
          {salesByMonth.isSuccess ? <MonthlySales rows={salesByMonth.data.data} animate={intro} /> : null}
          {salesByMonth.isError ? <p className="text-muted-foreground text-sm">Could not load the sales series: {salesByMonth.error.message}</p> : null}
        </section>
        </Panel>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel>
            <section className="flex flex-col gap-2">
              <SectionHeading
                title="Revenue mix by customer"
                note="Who the last twelve months' invoicing came from."
                action={
                  <Button variant="ghost" size="sm" onClick={() => { open(`report=sales-analysis&from=${TWELVE_MONTHS_AGO()}&to=${TODAY()}`); }}>
                    Open report
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                }
              />
              {salesByParty.isPending ? <Skeleton className="h-56 w-full" /> : null}
              {salesByParty.isSuccess ? <CompositionDonut rows={salesByParty.data.data} labelKey="label" valueKey="value" animate={intro} /> : null}
            </section>
          </Panel>
          <Panel>
            <section className="flex flex-col gap-2">
              <SectionHeading title="Top customers' share" note="Concentration: how much of the revenue the top five carry." />
              {salesByParty.isPending ? <Skeleton className="h-56 w-full" /> : null}
              {salesByParty.isSuccess ? <ShareRadialChart rows={salesByParty.data.data} labelKey="label" valueKey="value" title="Share of twelve months' revenue" animate={intro} /> : null}
            </section>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel>
            <section className="flex flex-col gap-2">
              <SectionHeading
                title="Top customers by value"
                note="The five that matter, ranked."
                action={
                  <Button variant="ghost" size="sm" onClick={() => { open(`report=customer-item-matrix`); }}>
                    Open report
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                }
              />
              {salesByParty.isPending ? <Skeleton className="h-56 w-full" /> : null}
              {salesByParty.isSuccess ? (
                // The rows are sales-analysis rows grouped by party, so that is
                // the key: a borrowed key inherits that report's chart form.
                <GenericReportChart
                  reportKey="sales-analysis"
                  definition={{ columns: [{ key: 'label', header: 'Customer', type: 'text' }, { key: 'value', header: 'Value', type: 'text' }], defaultSort: '-value' }}
                  rows={salesByParty.data.data}
                  animate={intro}
                />
              ) : null}
            </section>
          </Panel>
          <Panel>
            <section className="flex flex-col gap-2">
              <SectionHeading
                title="Stock ageing snapshot"
                note="Where stock is sitting old, valued at cost."
                action={
                  <Button variant="ghost" size="sm" onClick={() => { open('report=stock-ageing'); }}>
                    Open report
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                }
              />
              {ageing.isPending ? <Skeleton className="h-56 w-full" /> : null}
              {ageing.isSuccess ? <ReportChart reportKey="stock-ageing" rows={ageing.data.data} animate={intro} /> : null}
            </section>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel>
            <section className="flex flex-col gap-2">
              <SectionHeading
                title="Order fulfilment"
                note="Dispatched against ordered across every confirmed order."
                action={
                  <Button variant="ghost" size="sm" onClick={() => { open('report=order-fill-rate'); }}>
                    Open report
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                }
              />
              {fillRate.isPending ? <Skeleton className="h-52 w-full" /> : null}
              {fillRate.isSuccess && orgFillPct !== null ? <RateRadial pct={orgFillPct} label="Fulfilment" animate={intro} /> : null}
              {fillRate.isSuccess && orgFillPct === null ? <p className="text-muted-foreground text-sm">No confirmed orders yet, so there is nothing to fulfil.</p> : null}
            </section>
          </Panel>
          <Panel>
            <section className="flex flex-col gap-2">
              <SectionHeading
                title="Open order pipeline"
                note="Where quantity is waiting, oldest first."
                action={
                  <Button variant="ghost" size="sm" onClick={() => { open('report=order-pipeline'); }}>
                    Open report
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                }
              />
              {pipeline.isPending ? <Skeleton className="h-52 w-full" /> : null}
              {pipeline.isSuccess ? <GenericReportChart reportKey="order-pipeline" definition={{ columns: [{ key: 'number', header: 'Order', type: 'code' }, { key: 'ageDays', header: 'Age (days)', type: 'number' }], defaultSort: '-ageDays' }} rows={pipeline.data.data} animate={intro} /> : null}
            </section>
          </Panel>
        </div>

        <Panel>
        <section className="flex flex-col gap-2">
          <SectionHeading
            title="Stock movement"
            note="Inward against outward, last twelve months."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  open(`report=movement-analysis&from=${TWELVE_MONTHS_AGO()}&to=${TODAY()}`);
                }}
              >
                Open report
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            }
          />
          {movement.isPending ? <Skeleton className="h-56 w-full" /> : null}
          {movement.isSuccess ? <ReportChart reportKey="movement-analysis" rows={movement.data.data} animate={intro} /> : null}
          {movement.isError ? <p className="text-muted-foreground text-sm">Could not load the movement series: {movement.error.message}</p> : null}
        </section>
        </Panel>

        <Panel>
        <section className="flex flex-col gap-2">
          {lapse.isPending ? <Skeleton className="h-56 w-full" /> : null}
          {lapse.isSuccess && lapse.data.data.length > 0 ? <ReportChart reportKey="customer-lapse" rows={lapse.data.data} animate={intro} /> : <p className="text-muted-foreground text-sm">No customer is off their rhythm — nothing lapsing to draw.</p>}
        </section>
        </Panel>

        {canViewAttendance ? (
          // No Panel here: the tiles are the boxes, and a bordered wrapper
          // around bordered tiles is the box-in-box the constitution bans.
          // The KPI row at the top stands the same way.
          <section className="flex flex-col gap-3">
            <SectionHeading
              icon={<SunHorizonIcon />}
              title="Attendance, last 30 days"
              note="On time, what is flagged and waiting, and who keeps beating the shift. Each figure opens its report."
            />
            {(() => {
              const rows = onTime.data?.data ?? [];
              const worked = rows.reduce((sum, row) => sum + Number(row.cells.workedDays ?? 0), 0);
              const late = rows.reduce((sum, row) => sum + Number(row.cells.lateDays ?? 0), 0);
              const onTimePct = worked > 0 ? Math.round(((worked - late) / worked) * 1000) / 10 : null;
              const oldest = (turnaround.data?.data ?? []).reduce((max, row) => Math.max(max, Number(row.cells.oldestPendingHours ?? 0)), 0);
              const pendingFlags = openFlags.data?.meta.total ?? 0;
              return (
                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  {/* The radial's cell is a tile in every state: an empty
                      sentence floating in a 1fr column read as a layout bug. */}
                  {onTimePct === null ? (
                    <StatTile
                      label="On time"
                      value="—"
                      hint="No worked days in the last 30 days"
                      icon={<SunHorizonIcon />}
                      onOpen={() => {
                        open('report=on-time-rate');
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-center rounded-lg border px-4 py-3">
                      <RateRadial pct={onTimePct} label="On time" animate={intro} />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <StatTile
                      label="Flagged punches waiting"
                      value={String(pendingFlags)}
                      hint="Late or out of window, not yet decided"
                      icon={<ACTION_ICONS.flag />}
                      tone={pendingFlags > 0 ? 'warn' : undefined}
                      onOpen={() => {
                        void navigate('/approvals?type=FLAGGED_PUNCH&status=PENDING');
                      }}
                    />
                    <StatTile
                      label="Oldest pending approval"
                      value={oldest > 0 ? `${String(Math.round(oldest / 24))} d` : '—'}
                      hint="Across every request type"
                      icon={<HourglassMediumIcon />}
                      tone={oldest > 72 ? 'bad' : undefined}
                      onOpen={() => {
                        open('report=approvals-turnaround');
                      }}
                    />
                    <div className="flex flex-col gap-1 rounded-lg border px-4 py-3 sm:col-span-2">
                      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <SunHorizonIcon />
                        Longest early-arrival streaks
                      </p>
                      {(streaks.data?.data ?? []).length === 0 ? (
                        <p className="text-muted-foreground text-xs">Nobody is on a streak yet.</p>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {(streaks.data?.data ?? []).slice(0, 5).map((row) => (
                            <li key={row.id} className="flex items-center gap-1.5 text-xs">
                              <span className="truncate">{String(row.cells.employeeName ?? '')}</span>
                              <EarlyStreakBadge streak={Number(row.cells.currentStreak ?? 0)} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
        ) : null}
      </div>
    </>
  );
}

/**
 * Sales value per month, chronological — salesAnalysisSeries ranks by value,
 * which is right for "who leads" and wrong for a calendar.
 */
function MonthlySales({ rows, animate }: { rows: readonly { cells: Readonly<Record<string, unknown>> }[]; animate: boolean }) {
  const points = rows
    .map((row) => ({ label: typeof row.cells.label === 'string' ? row.cells.label : '', value: Number(row.cells.value ?? 0) }))
    .filter((p) => /^\d{4}-\d{2}$/u.test(p.label))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (points.length === 0) return <p className="text-muted-foreground text-sm">No invoiced sales in the last twelve months of the projection.</p>;
  return <MonthlyValueChart points={points} animate={animate} />;
}
