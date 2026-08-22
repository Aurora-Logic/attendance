import { useState, type ReactNode } from 'react';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { PERMISSIONS, type ReportKey } from '@vyuha/shared';
import type { DateRange } from 'react-day-picker';
import { useNavigate } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';

import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { DateRangeField } from '@/features/attendance/pickers';
import { formatMoney, formatMoneyShort } from '@/lib/format';
import { usePermission } from '@/lib/session/permissions';

import { useReportRows } from './api';
import { monthLabel } from './dashboard-v2.format';
import { asApiDate, DASHBOARD_PRESETS, defaultRange } from './dashboard-v2.presets';
import * as series from './dashboard-v2.series';

/**
 * Every chart the receivables data can currently answer a question with, on one
 * page, so the ones worth keeping can be picked by looking at them against real
 * figures rather than argued about in the abstract.
 *
 * Built the way shadcn ships charts -- a Card per question, the chart in the
 * middle, the sentence the data supports underneath -- and deliberately without
 * the project's own chart layer, so the plain form can be compared with the
 * existing dashboard at `/reports/dashboard`.
 *
 * The series and every threshold their sentences turn on live in
 * `dashboard-v2.series.ts` and are tested there. Nothing on this page computes
 * a figure; a chart that cannot be rendered in jsdom must not also be the only
 * place its arithmetic exists.
 */

const MONEY = (value: unknown): string =>
  typeof value === 'number' ? formatMoneyShort(value) : '';
const COUNT = (value: unknown): string => (typeof value === 'number' ? String(value) : '');
const PERCENT = (value: unknown): string => (typeof value === 'number' ? `${String(value)}%` : '');

/** Bars keep their corner: it is the one soft edge in a square theme, and it is what makes a bar read as a bar rather than a column of fill. */
const BAR_RADIUS = 6;

function ChartSkeleton() {
  return <Skeleton className="aspect-video w-full" />;
}

/**
 * One question, one picture, one sentence.
 *
 * A Card and nothing nested inside it (CLAUDE.md section 3 rule 3): the chart
 * sits directly on the card surface, and the insight is the footer rather than
 * a second bordered thing.
 */
function ChartCard({
  title,
  description,
  report,
  query,
  state,
  insight,
  footnote,
  wide,
  children,
}: {
  title: string;
  description: string;
  report: ReportKey;
  query?: string;
  state: { isPending: boolean; isError: boolean; hasPoints: boolean };
  insight: string | null;
  footnote?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Card className={wide === true ? 'lg:col-span-2' : undefined}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigate(`/reports?report=${report}${query ?? ''}`);
            }}
          >
            Open report
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {state.isPending ? <ChartSkeleton /> : null}
        {state.isError ? (
          <p className="text-muted-foreground py-8 text-sm">
            This report did not come back. Open it to see why.
          </p>
        ) : null}
        {!state.isPending && !state.isError && !state.hasPoints ? (
          <p className="text-muted-foreground py-8 text-sm">Nothing in this period.</p>
        ) : null}
        {!state.isPending && !state.isError && state.hasPoints ? children : null}
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        {insight === null ? null : <p className="leading-none font-medium">{insight}</p>}
        {footnote === undefined ? null : (
          <div className="text-muted-foreground leading-none">{footnote}</div>
        )}
      </CardFooter>
    </Card>
  );
}

const VALUE_CONFIG = { value: { label: 'Value', color: 'var(--chart-1)' } } satisfies ChartConfig;
const COUNT_CONFIG = { value: { label: 'Lines', color: 'var(--chart-2)' } } satisfies ChartConfig;
const SPLIT_CONFIG = {
  newRevenue: { label: 'First time', color: 'var(--chart-1)' },
  repeatRevenue: { label: 'Returning', color: 'var(--chart-3)' },
} satisfies ChartConfig;

export function ReportsDashboardV2() {
  const canView = usePermission(PERMISSIONS.RECEIVABLES_VIEW);
  const [range, setRange] = useState<DateRange>(defaultRange);

  const from = range.from === undefined ? undefined : asApiDate(range.from);
  const to = range.to === undefined ? undefined : asApiDate(range.to);
  const period = from !== undefined && to !== undefined ? { from, to } : {};
  const page = { page: 1, pageSize: 200 } as const;
  const on = { enabled: canView };

  const byMonth = useReportRows('sales-analysis', { ...page, ...period, groupBy: 'month' }, on);
  const byParty = useReportRows('sales-analysis', { ...page, ...period, groupBy: 'party' }, on);
  const ageing = useReportRows('ageing', page, on);
  const mix = useReportRows('new-vs-repeat', { ...page, ...period }, on);
  const aov = useReportRows('aov-trend', { ...page, ...period }, on);
  const spread = useReportRows('customer-concentration', { ...page, ...period }, on);
  const paying = useReportRows('payment-analysis', page, on);
  const filling = useReportRows('order-fill-rate', { ...page, ...period }, on);
  const waiting = useReportRows('pending-dispatch', page, on);
  const shelf = useReportRows('stock-ageing', page, on);
  const quiet = useReportRows('customer-lapse', page, on);
  const credit = useReportRows('credit-cycle', page, on);

  if (!canView) {
    return <PageHeader description="This dashboard needs permission to see receivables." />;
  }

  const thisMonth = asApiDate(new Date()).slice(0, 7);
  const invoiced = series.monthlyInvoiced(byMonth.data?.data ?? [], thisMonth);
  const customers = series.topCustomers(byParty.data?.data ?? []);
  const owed = series.ageingByBucket(ageing.data?.data ?? []);
  const firstTime = series.newVsRepeat(mix.data?.data ?? []);
  const basket = series.averageOrderValue(aov.data?.data ?? []);
  const fewness = series.concentration(spread.data?.data ?? []);
  const slippage = series.paymentSlippage(paying.data?.data ?? []);
  const served = series.fillRate(filling.data?.data ?? []);
  const backlog = series.pendingByAge(waiting.data?.data ?? []);
  const stock = series.stockAgeing(shelf.data?.data ?? []);
  const risk = series.revenueAtRisk(quiet.data?.data ?? []);
  const exposure = series.creditHeadroom(credit.data?.data ?? []);

  const stateOf = (
    query: { isPending: boolean; isError: boolean },
    points: readonly unknown[],
  ): { isPending: boolean; isError: boolean; hasPoints: boolean } => ({
    isPending: query.isPending,
    isError: query.isError,
    hasPoints: points.length > 0,
  });

  const ageingConfig = Object.fromEntries([
    ['value', { label: 'Outstanding' }],
    ...owed.points.map((slice, index) => [
      slice.bucket,
      { label: `${slice.bucket} days`, color: `var(--chart-${String(index + 1)})` },
    ]),
  ]) as ChartConfig;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Every chart the receivables data can answer a question with, drawn the way shadcn ships charts. Pick the ones worth keeping." />

      {/* The toolbar, above the content surface and not inside a card. */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeField
          value={range}
          onValueChange={setRange}
          label="Period"
          presets={DASHBOARD_PRESETS}
          className="w-full sm:w-auto"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Invoiced by month"
          description="Where the value landed, month by month"
          report="sales-analysis"
          query="&groupBy=month"
          state={stateOf(byMonth, invoiced.points)}
          insight={invoiced.insight}
          footnote={`${formatMoney(invoiced.total)} across ${String(invoiced.points.length)} month${invoiced.points.length === 1 ? '' : 's'}`}
        >
          <ChartContainer config={VALUE_CONFIG}>
            <BarChart accessibilityLayer data={[...invoiced.points]} margin={{ top: 20 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} tickFormatter={monthLabel} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={BAR_RADIUS}>
                <LabelList position="top" offset={12} className="fill-foreground" fontSize={12} formatter={MONEY} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="Where the revenue comes from"
          description="Top five customers in the period"
          report="sales-analysis"
          query="&groupBy=party"
          state={stateOf(byParty, customers.points)}
          insight={customers.insight}
          footnote={
            customers.tailCount > 0
              ? `${formatMoney(customers.tailValue)} more came from ${String(customers.tailCount)} other customers`
              : `${String(customers.points.length)} customers invoiced`
          }
        >
          <ChartContainer config={VALUE_CONFIG}>
            <BarChart accessibilityLayer data={[...customers.points]} layout="vertical" margin={{ right: 56 }}>
              <CartesianGrid horizontal={false} />
              <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} hide />
              <XAxis dataKey="value" type="number" hide />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={BAR_RADIUS}>
                <LabelList dataKey="label" position="insideLeft" offset={8} className="fill-background" fontSize={12} />
                <LabelList dataKey="value" position="right" offset={8} className="fill-foreground" fontSize={12} formatter={MONEY} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="What is owed, by age"
          description="Open bills, from the bill date"
          report="ageing"
          state={stateOf(ageing, owed.points)}
          insight={owed.insight}
          footnote={`${formatMoney(owed.total)} outstanding in total`}
        >
          <ChartContainer config={ageingConfig} className="mx-auto aspect-square max-h-[280px]">
            <PieChart>
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Pie data={[...owed.points]} dataKey="value" nameKey="bucket" innerRadius={60}>
                <LabelList dataKey="value" className="fill-background" stroke="none" fontSize={12} formatter={MONEY} />
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="bucket" />} />
            </PieChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="New money against returning money"
          description="Revenue split by whether the customer had been billed before"
          report="new-vs-repeat"
          state={stateOf(mix, firstTime.points)}
          insight={firstTime.insight}
        >
          <ChartContainer config={SPLIT_CONFIG}>
            <BarChart accessibilityLayer data={[...firstTime.points]} margin={{ top: 20 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} tickFormatter={monthLabel} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="repeatRevenue" stackId="m" fill="var(--color-repeatRevenue)" radius={[0, 0, BAR_RADIUS, BAR_RADIUS]} />
              <Bar dataKey="newRevenue" stackId="m" fill="var(--color-newRevenue)" radius={[BAR_RADIUS, BAR_RADIUS, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="Average invoice value"
          description="Is the basket growing, or splitting into smaller bills?"
          report="aov-trend"
          state={stateOf(aov, basket.points)}
          insight={basket.insight}
        >
          <ChartContainer config={VALUE_CONFIG}>
            <LineChart accessibilityLayer data={[...basket.points]} margin={{ top: 20, left: 12, right: 24 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} tickFormatter={monthLabel} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={false}>
                <LabelList position="top" offset={12} className="fill-foreground" fontSize={11} formatter={MONEY} />
              </Line>
            </LineChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="How few customers carry the book"
          description="Running share of revenue, largest customer first"
          report="customer-concentration"
          state={stateOf(spread, fewness.points)}
          insight={fewness.insight}
        >
          <ChartContainer config={{ cumulative: { label: 'Running share', color: 'var(--chart-2)' } }}>
            <LineChart accessibilityLayer data={[...fewness.points]} margin={{ top: 20, left: 12, right: 24 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} hide />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} tickFormatter={PERCENT} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Line dataKey="cumulative" type="monotone" stroke="var(--color-cumulative)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="Who pays late"
          description="Days beyond agreed terms, worst first"
          report="payment-analysis"
          state={stateOf(paying, slippage.points)}
          insight={slippage.insight}
        >
          <ChartContainer config={{ value: { label: 'Days past terms', color: 'var(--chart-1)' } }}>
            <BarChart accessibilityLayer data={[...slippage.points]} layout="vertical" margin={{ right: 48 }}>
              <CartesianGrid horizontal={false} />
              <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} hide />
              <XAxis dataKey="value" type="number" hide />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={BAR_RADIUS}>
                <LabelList dataKey="label" position="insideLeft" offset={8} className="fill-background" fontSize={12} />
                <LabelList dataKey="value" position="right" offset={8} className="fill-foreground" fontSize={12} formatter={COUNT} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="How much of the order book went out"
          description="Fill rate by customer, worst served first"
          report="order-fill-rate"
          state={stateOf(filling, served.points)}
          insight={served.insight}
        >
          <ChartContainer config={{ value: { label: 'Filled', color: 'var(--chart-3)' } }}>
            <BarChart accessibilityLayer data={[...served.points]} layout="vertical" margin={{ right: 48 }}>
              <CartesianGrid horizontal={false} />
              <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} hide />
              <XAxis dataKey="value" type="number" domain={[0, 100]} hide />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={BAR_RADIUS}>
                <LabelList dataKey="label" position="insideLeft" offset={8} className="fill-background" fontSize={12} />
                <LabelList dataKey="value" position="right" offset={8} className="fill-foreground" fontSize={12} formatter={PERCENT} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="What is waiting to go out"
          description="Open order lines, by how long they have waited"
          report="pending-dispatch"
          state={stateOf(waiting, backlog.points)}
          insight={backlog.insight}
        >
          <ChartContainer config={COUNT_CONFIG}>
            <BarChart accessibilityLayer data={[...backlog.points]} margin={{ top: 20 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={BAR_RADIUS}>
                <LabelList position="top" offset={12} className="fill-foreground" fontSize={12} formatter={COUNT} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="How long the shelf has held it"
          description="Quantity on hand, by age"
          report="stock-ageing"
          state={stateOf(shelf, stock.points)}
          insight={stock.insight}
        >
          <ChartContainer config={{ value: { label: 'Quantity', color: 'var(--chart-4)' } }}>
            <BarChart accessibilityLayer data={[...stock.points]} margin={{ top: 20 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={BAR_RADIUS}>
                <LabelList position="top" offset={12} className="fill-foreground" fontSize={12} formatter={COUNT} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="Revenue that has gone quiet"
          description="Last year's value from customers who have stopped or slowed"
          report="customer-lapse"
          state={stateOf(quiet, risk.points)}
          insight={risk.insight}
        >
          <ChartContainer config={{ value: { label: 'Revenue', color: 'var(--chart-2)' } }}>
            <BarChart accessibilityLayer data={[...risk.points]} margin={{ top: 20 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={BAR_RADIUS}>
                <LabelList position="top" offset={12} className="fill-foreground" fontSize={12} formatter={MONEY} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard
          title="How much of the credit line is used"
          description="Exposure against limit, heaviest first"
          report="credit-cycle"
          state={stateOf(credit, exposure.points)}
          insight={exposure.insight}
        >
          <ChartContainer config={{ value: { label: 'Limit used', color: 'var(--chart-1)' } }}>
            <BarChart accessibilityLayer data={[...exposure.points]} layout="vertical" margin={{ right: 48 }}>
              <CartesianGrid horizontal={false} />
              <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} hide />
              <XAxis dataKey="value" type="number" hide />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={BAR_RADIUS}>
                <LabelList dataKey="label" position="insideLeft" offset={8} className="fill-background" fontSize={12} />
                <LabelList dataKey="value" position="right" offset={8} className="fill-foreground" fontSize={12} formatter={PERCENT} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>
      </div>
    </div>
  );
}
