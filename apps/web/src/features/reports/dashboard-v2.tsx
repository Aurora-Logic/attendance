import { ArrowRightIcon, TrendUpIcon } from '@phosphor-icons/react';
import { PERMISSIONS } from '@vyuha/shared';
import { Bar, BarChart, CartesianGrid, LabelList, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { useNavigate } from 'react-router';

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
import { usePermission } from '@/lib/session/permissions';

import { useReportRows } from './api';
import { monthLabel, short } from './dashboard-v2.format';

/**
 * The reports dashboard, built the way shadcn ships charts.
 *
 * A second version rather than a replacement, so the two can be looked at side
 * by side and the better one kept. The existing page is at
 * `/reports/dashboard`; this is `/reports/dashboard/v2`.
 *
 * What is deliberately different:
 *
 * **Cards, not panels.** shadcn's chart blocks are a Card with a header, the
 * chart, and a footer carrying the takeaway. The current page uses a bordered
 * Panel and a SectionHeading instead. Cards are the vanilla shape and they put
 * the "what am I looking at" and the "so what" on either side of the picture.
 *
 * **No project chart layer.** No `formSeries`, no `useChartIntro`, no shared
 * label helpers, no insight builders -- just `ChartContainer`, Recharts and
 * `LabelList`, with `var(--chart-N)` for colour. The series are built inline
 * from the rows because that is what the shadcn examples do, and the point of
 * this version is to see what the plain form looks like against real data.
 *
 * **No entry animation.** The examples have none, and a chart that draws
 * itself on every visit is a thing the house style added rather than a thing
 * shadcn does.
 *
 * The attendance block is gone. Nothing about on-time rate or early-arrival
 * streaks belongs on the page that answers "who owes us what" -- it was the
 * one section here that a person came to this screen not wanting.
 */

const TWELVE_MONTHS_AGO = (): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  d.setDate(1);
  return d.toLocaleDateString('en-CA');
};
const TODAY = (): string => new Date().toLocaleDateString('en-CA');
const THIS_MONTH = (): string => TODAY().slice(0, 7);

const MONTH_CONFIG = {
  value: { label: 'Invoiced', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const PARTY_CONFIG = {
  value: { label: 'Invoiced', color: 'var(--chart-2)' },
} satisfies ChartConfig;

function ChartSkeleton() {
  return <Skeleton className="aspect-video w-full" />;
}

export function ReportsDashboardV2() {
  const navigate = useNavigate();
  const canView = usePermission(PERMISSIONS.RECEIVABLES_VIEW);
  const page = { page: 1, pageSize: 200 } as const;

  const byMonth = useReportRows(
    'sales-analysis',
    { ...page, groupBy: 'month', from: TWELVE_MONTHS_AGO(), to: TODAY() },
    { enabled: canView },
  );
  const byParty = useReportRows(
    'sales-analysis',
    { ...page, groupBy: 'party', from: TWELVE_MONTHS_AGO(), to: TODAY() },
    { enabled: canView },
  );
  const ageing = useReportRows('ageing', page, { enabled: canView });

  if (!canView) {
    return (
      <PageHeader description="This dashboard needs permission to see receivables." />
    );
  }

  const open = (query: string): void => {
    void navigate(`/reports?${query}`);
  };

  // Series built inline from the rows, as the shadcn examples do.
  //
  // Sorted by key, not left in the order the API sent: every report defaults to
  // its own sort and this one is "-value", which on a time axis draws the
  // twelve months in order of size.
  const months = (byMonth.data?.data ?? [])
    .map((row) => ({
      label: String(row.cells.label ?? ''),
      value: Number(row.cells.value ?? 0),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const monthTotal = months.reduce((sum, m) => sum + m.value, 0);
  // The month in progress is a part-month and would read as a collapse against
  // a full one, so the comparison is between the last two months that finished.
  const complete = months.filter((m) => m.label !== THIS_MONTH());
  const lastMonth = complete.at(-1);
  const previousMonth = complete.at(-2);
  const movement =
    lastMonth !== undefined && previousMonth !== undefined && previousMonth.value > 0
      ? Math.round(((lastMonth.value - previousMonth.value) / previousMonth.value) * 1000) / 10
      : null;

  // Top five and the rest folded together: a bar per customer is unreadable at
  // fifty, and the tail is not a finding.
  const partiesAll = (byParty.data?.data ?? [])
    .map((row) => ({ label: String(row.cells.label ?? ''), value: Number(row.cells.value ?? 0) }))
    .sort((a, b) => b.value - a.value);
  const parties = partiesAll.slice(0, 5);
  const tail = partiesAll.slice(5).reduce((sum, p) => sum + p.value, 0);

  const buckets = (ageing.data?.data ?? []).reduce<Record<string, number>>((acc, row) => {
    const bucket = String(row.cells.bucket ?? 'Unknown');
    acc[bucket] = (acc[bucket] ?? 0) + Number(row.cells.outstanding ?? 0);
    return acc;
  }, {});
  const ageingData = ['0-30', '31-60', '61-90', '90+']
    .filter((b) => buckets[b] !== undefined)
    .map((b, index) => ({
      bucket: b,
      value: buckets[b] ?? 0,
      fill: `var(--chart-${String((index % 5) + 1)})`,
    }));
  const overdue = (buckets['31-60'] ?? 0) + (buckets['61-90'] ?? 0) + (buckets['90+'] ?? 0);

  const ageingConfig = Object.fromEntries([
    ['value', { label: 'Outstanding' }],
    ...ageingData.map((d, index) => [
      d.bucket,
      { label: `${d.bucket} days`, color: `var(--chart-${String((index % 5) + 1)})` },
    ]),
  ]) as ChartConfig;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="The same figures as the dashboard, drawn the way shadcn ships charts: a card per question, the chart in the middle, the takeaway underneath." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Invoiced by month</CardTitle>
            <CardDescription>The last twelve months</CardDescription>
            <CardAction>
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
            </CardAction>
          </CardHeader>
          <CardContent>
            {byMonth.isPending ? <ChartSkeleton /> : null}
            {byMonth.isSuccess && months.length > 0 ? (
              <ChartContainer config={MONTH_CONFIG}>
                <BarChart accessibilityLayer data={months} margin={{ top: 20 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                    tickFormatter={monthLabel}
                  />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="value" fill="var(--color-value)" radius={8}>
                    <LabelList
                      position="top"
                      offset={12}
                      className="fill-foreground"
                      fontSize={12}
                      formatter={(value: unknown) => (typeof value === 'number' ? short(value) : '')}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : null}
          </CardContent>
          <CardFooter className="flex-col items-start gap-2 text-sm">
            {movement !== null ? (
              <div className="flex gap-2 leading-none font-medium">
                {monthLabel(lastMonth?.label ?? '')} was {movement >= 0 ? 'up' : 'down'}{' '}
                {Math.abs(movement)}% on the month before
                <TrendUpIcon className="size-4" />
              </div>
            ) : null}
            <div className="text-muted-foreground leading-none">
              {short(monthTotal)} invoiced across {months.length} month
              {months.length === 1 ? '' : 's'}
            </div>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where the revenue comes from</CardTitle>
            <CardDescription>Top five customers, twelve months</CardDescription>
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  open(`report=sales-analysis&groupBy=party&from=${TWELVE_MONTHS_AGO()}&to=${TODAY()}`);
                }}
              >
                Open report
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {byParty.isPending ? <ChartSkeleton /> : null}
            {byParty.isSuccess && parties.length > 0 ? (
              <ChartContainer config={PARTY_CONFIG}>
                <BarChart accessibilityLayer data={parties} layout="vertical" margin={{ right: 48 }}>
                  <CartesianGrid horizontal={false} />
                  {/* Hidden axis, name inside the bar: the shadcn custom-label
                      pattern, which buys back the gutter a category axis eats
                      when the names are long. */}
                  <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} hide />
                  <XAxis dataKey="value" type="number" hide />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                  <Bar dataKey="value" fill="var(--color-value)" radius={4}>
                    <LabelList
                      dataKey="label"
                      position="insideLeft"
                      offset={8}
                      className="fill-background"
                      fontSize={12}
                    />
                    <LabelList
                      dataKey="value"
                      position="right"
                      offset={8}
                      className="fill-foreground"
                      fontSize={12}
                      formatter={(value: unknown) => (typeof value === 'number' ? short(value) : '')}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : null}
          </CardContent>
          <CardFooter className="flex-col items-start gap-2 text-sm">
            <div className="text-muted-foreground leading-none">
              {tail > 0
                ? `${short(tail)} more came from ${String(partiesAll.length - 5)} other customers`
                : `${String(partiesAll.length)} customers invoiced in the period`}
            </div>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What is owed, by age</CardTitle>
          <CardDescription>Open bills, from the bill date</CardDescription>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                open('report=ageing');
              }}
            >
              Open report
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex justify-center">
          {ageing.isPending ? <ChartSkeleton /> : null}
          {ageing.isSuccess && ageingData.length > 0 ? (
            <ChartContainer config={ageingConfig} className="mx-auto aspect-square max-h-[280px]">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie data={ageingData} dataKey="value" nameKey="bucket" innerRadius={60}>
                  {/* The figure, not the bucket name -- the legend below names
                      the buckets, and a value nobody has to hover for is the
                      standing rule on this product's charts. */}
                  <LabelList
                    dataKey="value"
                    className="fill-background"
                    stroke="none"
                    fontSize={12}
                    formatter={(value: unknown) => (typeof value === 'number' ? short(value) : '')}
                  />
                </Pie>
                <ChartLegend content={<ChartLegendContent nameKey="bucket" />} />
              </PieChart>
            </ChartContainer>
          ) : null}
          {ageing.isSuccess && ageingData.length === 0 ? (
            <p className="text-muted-foreground py-8 text-sm">Nothing is outstanding.</p>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col items-start gap-2 text-sm">
          {overdue > 0 ? (
            <div className="flex gap-2 leading-none font-medium">
              {short(overdue)} has been owed for more than thirty days
            </div>
          ) : null}
          <div className="text-muted-foreground leading-none">
            {String(ageing.data?.meta.total ?? 0)} open bill
            {(ageing.data?.meta.total ?? 0) === 1 ? '' : 's'}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
