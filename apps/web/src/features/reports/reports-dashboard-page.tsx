import { ArrowRightIcon, ChartBarIcon, HourglassMediumIcon, LockKeyIcon, PackageIcon, TrendDownIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';

import { PageHeader } from '@/components/shared/page-header';
import { SectionHeading } from '@/components/shared/section-heading';
import { useChartIntro } from '@/components/shared/use-chart-motion';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/lib/session/permissions';
import { PERMISSIONS } from '@vyuha/shared';

import { useReportRows } from './api';
import { MonthlyValueChart, ReportChart } from './report-charts';
import { inr, lapseSeries } from './report-series';

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
      <span className="text-muted-foreground text-xs font-normal">{hint}</span>
    </Button>
  );
}

export function ReportsDashboardPage() {
  const navigate = useNavigate();
  const canView = usePermission(PERMISSIONS.RECEIVABLES_VIEW);
  const page = { page: 1, pageSize: 200 } as const;
  const credit = useReportRows('credit-cycle', page, { enabled: canView });
  const breaches = useReportRows('credit-breaches', { page: 1, pageSize: 1 }, { enabled: canView });
  const lapse = useReportRows('customer-lapse', page, { enabled: canView });
  const dead = useReportRows('dead-stock', page, { enabled: canView });
  const lowStock = useReportRows('low-stock', { page: 1, pageSize: 1 }, { enabled: canView });
  const stale = useReportRows('stale-projections', { page: 1, pageSize: 1 }, { enabled: canView });
  const salesByMonth = useReportRows('sales-analysis', { ...page, groupBy: 'month', from: TWELVE_MONTHS_AGO(), to: TODAY() }, { enabled: canView });
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
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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

        <section className="flex flex-col gap-2">
          {lapse.isPending ? <Skeleton className="h-56 w-full" /> : null}
          {lapse.isSuccess && lapse.data.data.length > 0 ? <ReportChart reportKey="customer-lapse" rows={lapse.data.data} animate={intro} /> : null}
        </section>
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
