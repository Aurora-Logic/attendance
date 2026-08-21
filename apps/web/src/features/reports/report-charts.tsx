import { Bar, BarChart, CartesianGrid, Label, Line, LineChart, Pie, PieChart, PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart, XAxis, YAxis } from 'recharts';

import { SectionHeading } from '@/components/shared/section-heading';
import { CHART_INTRO_MS } from '@/components/shared/use-chart-motion';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { humaniseEnum } from '@/lib/format';
import type { ReportDefinition, ReportKey } from '@vyuha/shared';

import {
  ageingSeries,
  formSeries,
  genericSeries,
  resolveChartForm,
  lapseSeries,
  movementSeries,
  salesAnalysisSeries,
  shareSeries,
  velocitySeries,
  type ChartRow,
} from './report-series';

/**
 * The chart above a report's table, for the five reports whose question a
 * picture answers faster than rows (report-series.ts names each question).
 * Presentational only: the series and its insight arrive computed. Colour
 * policy follows the dashboard's reasoning — semantic tokens where a colour
 * carries meaning (lapsed red, at-risk amber), the theme's --chart ramp
 * where the job is a sequential age scale, and the primary hue where one
 * series needs no identity at all.
 */

const VALUE_CONFIG = { value: { label: 'Value', color: 'var(--primary)' } } satisfies ChartConfig;
const MOVEMENT_CONFIG = {
  inward: { label: 'Inward', color: 'var(--info)' },
  outward: { label: 'Outward', color: 'var(--success)' },
} satisfies ChartConfig;
const VELOCITY_CONFIG = {
  monthly12: { label: 'Per month, 12m', color: 'var(--primary)' },
  monthly3: { label: 'Per month, last 3m', color: 'var(--info)' },
} satisfies ChartConfig;
/** One hue, light to dark: the ageing buckets are a magnitude of age, not identities. */
const AGEING_CONFIG = {
  bucket0: { label: '0–30 days', color: 'var(--chart-2)' },
  bucket31: { label: '31–60 days', color: 'var(--chart-3)' },
  bucket61: { label: '61–90 days', color: 'var(--chart-4)' },
  bucket90: { label: 'Over 90 days', color: 'var(--chart-5)' },
} satisfies ChartConfig;
const LAPSE_CONFIG = {
  lapsedRevenue: { label: 'Lapsed', color: 'var(--destructive)' },
  atRiskRevenue: { label: 'At risk', color: 'var(--warning)' },
} satisfies ChartConfig;

/** Room for the last label; ticks are centred under their category. */
const AXIS_MARGIN = { left: 0, right: 16, top: 4 } as const;

function truncate(label: string): string {
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

function Frame({ title, insight, children }: { title: string; insight: string | null; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeading title={title} note={insight ?? undefined} />
      {children}
    </section>
  );
}

export function ReportChart({ reportKey, rows, animate, compare }: { reportKey: ReportKey; rows: readonly ChartRow[]; animate: boolean; compare?: { rows: readonly ChartRow[]; label: string } }) {
  if (rows.length === 0) return null;
  const motion = { isAnimationActive: animate, animationDuration: CHART_INTRO_MS } as const;

  switch (reportKey) {
    case 'sales-analysis': {
      const { points, insight } = salesAnalysisSeries(rows);
      if (points.length === 0) return null;
      // Period-over-period wears the matrix's grouped form: current solid,
      // comparison muted. The share radial stays single-period — a share is
      // already a comparison within its own whole.
      const prevByLabel = new Map(
        compare === undefined ? [] : salesAnalysisSeries(compare.rows).points.map((point) => [point.label, point.value]),
      );
      const data = points.map((point) =>
        compare === undefined ? point : { ...point, compare: prevByLabel.get(point.label) ?? 0 },
      );
      const config =
        compare === undefined
          ? VALUE_CONFIG
          : ({ ...VALUE_CONFIG, compare: { label: compare.label, color: 'var(--muted-foreground)' } } satisfies ChartConfig);
      return (
        <div className="grid gap-6 lg:grid-cols-2">
          <Frame title="Where the value sits" insight={insight}>
            <ChartContainer config={config} className="h-56 w-full">
              <BarChart data={data} margin={AXIS_MARGIN}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickFormatter={truncate} interval={0} />
                <YAxis tickLine={false} axisLine={false} width={64} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {compare !== undefined ? <ChartLegend content={<ChartLegendContent />} /> : null}
                <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={44} {...motion} />
                {compare !== undefined ? <Bar dataKey="compare" fill="var(--color-compare)" fillOpacity={0.55} radius={[4, 4, 0, 0]} maxBarSize={44} {...motion} /> : null}
              </BarChart>
            </ChartContainer>
          </Frame>
          <ShareRadialChart rows={rows} labelKey="label" valueKey="value" title="Share of the total" animate={animate} />
        </div>
      );
    }
    case 'movement-analysis': {
      const { points, insight } = movementSeries(rows);
      if (points.length === 0) return null;
      return (
        <Frame title="Inward against outward" insight={insight}>
          <ChartContainer config={MOVEMENT_CONFIG} className="h-56 w-full">
            <BarChart data={[...points]} margin={AXIS_MARGIN}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={56} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="inward" fill="var(--color-inward)" radius={[4, 4, 0, 0]} maxBarSize={28} {...motion} />
              <Bar dataKey="outward" fill="var(--color-outward)" radius={[4, 4, 0, 0]} maxBarSize={28} {...motion} />
            </BarChart>
          </ChartContainer>
        </Frame>
      );
    }
    case 'item-velocity': {
      const { points, insight } = velocitySeries(rows);
      if (points.length === 0) return null;
      return (
        <Frame title="The pace, year against quarter" insight={insight}>
          <ChartContainer config={VELOCITY_CONFIG} className="h-56 w-full">
            <BarChart data={[...points]} margin={AXIS_MARGIN}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="item" tickLine={false} axisLine={false} tickFormatter={truncate} interval={0} />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="monthly12" fill="var(--color-monthly12)" radius={[4, 4, 0, 0]} maxBarSize={28} {...motion} />
              <Bar dataKey="monthly3" fill="var(--color-monthly3)" radius={[4, 4, 0, 0]} maxBarSize={28} {...motion} />
            </BarChart>
          </ChartContainer>
        </Frame>
      );
    }
    case 'stock-ageing': {
      const { points, insight } = ageingSeries(rows);
      if (points.length === 0) return null;
      return (
        <Frame title="How long the shelf has held it" insight={insight}>
          <ChartContainer config={AGEING_CONFIG} className="h-56 w-full">
            <BarChart data={[...points]} margin={AXIS_MARGIN}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="item" tickLine={false} axisLine={false} tickFormatter={truncate} interval={0} />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="bucket0" stackId="age" fill="var(--color-bucket0)" {...motion} />
              <Bar dataKey="bucket31" stackId="age" fill="var(--color-bucket31)" {...motion} />
              <Bar dataKey="bucket61" stackId="age" fill="var(--color-bucket61)" {...motion} />
              <Bar dataKey="bucket90" stackId="age" fill="var(--color-bucket90)" radius={[4, 4, 0, 0]} {...motion} />
            </BarChart>
          </ChartContainer>
        </Frame>
      );
    }
    case 'customer-lapse': {
      const { points, insight } = lapseSeries(rows);
      if (points.length === 0) return null;
      // One bar per customer; the state decides which series carries it, so
      // the legend and the colours say lapsed against at-risk without a
      // second axis.
      const data = points.map((p) => ({
        customer: p.customer,
        lapsedRevenue: p.state === 'LAPSED' ? p.revenue : 0,
        atRiskRevenue: p.state === 'AT_RISK' ? p.revenue : 0,
      }));
      return (
        <Frame title="Revenue going quiet" insight={insight}>
          <ChartContainer config={LAPSE_CONFIG} className="h-56 w-full">
            <BarChart data={data} margin={AXIS_MARGIN}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="customer" tickLine={false} axisLine={false} tickFormatter={truncate} interval={0} />
              <YAxis tickLine={false} axisLine={false} width={64} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="lapsedRevenue" stackId="risk" fill="var(--color-lapsedRevenue)" {...motion} />
              <Bar dataKey="atRiskRevenue" stackId="risk" fill="var(--color-atRiskRevenue)" radius={[4, 4, 0, 0]} {...motion} />
            </BarChart>
          </ChartContainer>
        </Frame>
      );
    }
    case 'stock-summary':
      return (
        <div className="grid gap-6 lg:grid-cols-2">
          <ShareRadialChart rows={rows} labelKey="item" valueKey="value" title="Share of stock value" animate={animate} />
          <GenericReportChart reportKey="stock-summary" definition={{ columns: [{ key: 'item', header: 'Item', type: 'text' }, { key: 'value', header: 'Value at cost', type: 'text' }], defaultSort: '-value' }} rows={rows} animate={animate} />
        </div>
      );
    default:
      return null;
  }
}

/** The dashboard's calendar chart: value per month in month order, one hue. */
export function MonthlyValueChart({ points, animate }: { points: readonly { label: string; value: number }[]; animate: boolean }) {
  if (points.length === 0) return null;
  return (
    <ChartContainer config={VALUE_CONFIG} className="h-56 w-full">
      <BarChart data={[...points]} margin={AXIS_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={64} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={animate} animationDuration={CHART_INTRO_MS} />
      </BarChart>
    </ChartContainer>
  );
}

/** The five identity slots of the theme's ramp, in fixed order (dataviz: never cycled). */
const SHARE_FILLS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'] as const;

/**
 * The top five as rings of one whole (the shadcn radial pattern, via the
 * MCP examples): each ring's length is its share of everything the page
 * shows. Five rings at most, so the fixed ramp is never cycled.
 */
export function ShareRadialChart({ rows, labelKey, valueKey, title, animate }: { rows: readonly ChartRow[]; labelKey: string; valueKey: string; title: string; animate: boolean }) {
  const { points, total } = shareSeries(rows, labelKey, valueKey);
  if (points.length < 2 || total <= 0) return null;
  const config = Object.fromEntries([
    ['value', { label: 'Share' }],
    ...points.map((p, index) => [`s${String(index)}`, { label: p.label, color: SHARE_FILLS[index % SHARE_FILLS.length] }]),
  ]) as ChartConfig;
  const data = points.map((p, index) => ({ name: p.label, value: p.share, fill: `var(--color-s${String(index)})` }));
  return (
    <Frame title={title} insight={`${points[0]?.label ?? ''} holds ${String(points[0]?.share ?? 0)}% of what this page shows.`}>
      <ChartContainer config={config} className="mx-auto aspect-square max-h-64 w-full">
        <RadialBarChart data={data} innerRadius={28} outerRadius={104}>
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="name" />} />
          <RadialBar dataKey="value" background isAnimationActive={animate} animationDuration={CHART_INTRO_MS} />
          <ChartLegend content={<ChartLegendContent nameKey="name" />} />
        </RadialBarChart>
      </ChartContainer>
    </Frame>
  );
}

const GENERIC_FILLS = ['var(--primary)', 'var(--info)'] as const;

/**
 * Any report, drawn: the first text column names the bars, the report's own
 * sort sizes them, in the table's order. The honest fallback behind the
 * Table | Chart | Both toggle — a report genericSeries refuses stays a table.
 */
export function GenericReportChart({ reportKey, definition, rows, animate, compare }: { reportKey: ReportKey; definition: Pick<ReportDefinition, 'columns' | 'defaultSort'>; rows: readonly ChartRow[]; animate: boolean; compare?: { rows: readonly ChartRow[]; label: string } }) {
  const spec = resolveChartForm(reportKey, definition, rows);
  if (spec === null) return null;
  if (spec.form !== 'hbar') return <FormChart spec={spec} definition={definition} rows={rows} animate={animate} compare={compare} />;
  const series = genericSeries(definition, rows);
  if (series === null) return null;
  const first = series.series[0];
  // The comparison series joins by category and renders muted beside the
  // current one — current solid, past quiet (data-analyst skill §3).
  const prevByCategory = new Map<string, number>();
  if (compare !== undefined && first !== undefined) {
    const prev = genericSeries(definition, compare.rows);
    for (const point of prev?.points ?? []) prevByCategory.set(String(point.category), Number(point[first.key] ?? 0));
  }
  const withPrev = compare !== undefined && first !== undefined;
  const data = series.points.map((point) => (withPrev ? { ...point, compare: prevByCategory.get(String(point.category)) ?? 0 } : point));
  const config = Object.fromEntries([
    ...series.series.map((s, index) => [s.key, { label: s.label, color: GENERIC_FILLS[index % GENERIC_FILLS.length] }]),
    ...(withPrev ? [['compare', { label: compare.label, color: 'var(--muted-foreground)' }]] : []),
  ]) as ChartConfig;
  return (
    <Frame title={`Top rows by ${humaniseEnum(series.series[0]?.label ?? 'value').toLowerCase()}`} insight={null}>
      <ChartContainer config={config} className="h-64 w-full">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="category" tickLine={false} axisLine={false} width={120} tickFormatter={truncate} interval={0} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.series.length > 1 || withPrev ? <ChartLegend content={<ChartLegendContent />} /> : null}
          {withPrev ? <Bar dataKey="compare" fill="var(--color-compare)" radius={[0, 4, 4, 0]} maxBarSize={18} fillOpacity={0.55} isAnimationActive={animate} animationDuration={CHART_INTRO_MS} /> : null}
          {series.series.map((s) => (
            <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={animate} animationDuration={CHART_INTRO_MS} />
          ))}
        </BarChart>
      </ChartContainer>
    </Frame>
  );
}

/** The non-bar generic forms: a line through time, or a donut of composition. */
function FormChart({ spec, definition, rows, animate, compare }: { spec: NonNullable<ReturnType<typeof resolveChartForm>>; definition: Pick<ReportDefinition, 'columns' | 'defaultSort'>; rows: readonly ChartRow[]; animate: boolean; compare?: { rows: readonly ChartRow[]; label: string } }) {
  const points = formSeries(spec, rows);
  if (points.length === 0) return null;
  const headers = new Map(definition.columns.map((c) => [c.key, c.header]));

  if (spec.form === 'line') {
    const config = Object.fromEntries([
      ...spec.series.map((key, index) => [key, { label: headers.get(key) ?? key, color: GENERIC_FILLS[index % GENERIC_FILLS.length] }]),
      ...(compare ? [['compare', { label: compare.label, color: 'var(--muted-foreground)' }]] : []),
    ]) as ChartConfig;
    const prev = compare ? formSeries(spec, compare.rows) : [];
    const firstKey = spec.series[0] ?? '';
    // The comparison walks the same span shifted, so it joins by position, not by date.
    const data = points.map((point, index) => (compare ? { ...point, compare: Number(prev[index]?.[firstKey] ?? 0) } : point));
    return (
      <Frame title={`${headers.get(firstKey) ?? 'Value'} over time`} insight={null}>
        <ChartContainer config={config} className="h-56 w-full">
          <LineChart data={data} margin={{ left: 0, right: 24, top: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="category" tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} width={64} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {spec.series.length > 1 || compare ? <ChartLegend content={<ChartLegendContent />} /> : null}
            {compare ? <Line dataKey="compare" stroke="var(--color-compare)" strokeDasharray="4 4" strokeWidth={2} dot={false} isAnimationActive={animate} animationDuration={CHART_INTRO_MS} /> : null}
            {spec.series.map((key) => (
              <Line key={key} dataKey={key} stroke={`var(--color-${key})`} strokeWidth={2} dot={false} isAnimationActive={animate} animationDuration={CHART_INTRO_MS} />
            ))}
          </LineChart>
        </ChartContainer>
      </Frame>
    );
  }

  // donut: five slices plus Other, the fixed ramp in order, labels in the legend
  const config = Object.fromEntries([
    ['value', { label: headers.get(spec.series[0] ?? '') ?? 'Value' }],
    ...points.map((p, index) => [`slice${String(index)}`, { label: String(p.category), color: index < 5 ? SHARE_FILLS[index] : 'var(--muted-foreground)' }]),
  ]) as ChartConfig;
  const data = points.map((p, index) => ({ name: String(p.category), value: Number(p.value ?? 0), fill: `var(--color-slice${String(index)})` }));
  return (
    <Frame title="Composition" insight={null}>
      <ChartContainer config={config} className="mx-auto aspect-square max-h-64 w-full">
        <PieChart>
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="name" />} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={56} strokeWidth={2} isAnimationActive={animate} animationDuration={CHART_INTRO_MS} />
          <ChartLegend content={<ChartLegendContent nameKey="name" />} />
        </PieChart>
      </ChartContainer>
    </Frame>
  );
}

/** A composition donut for any labelled value set: five slices plus Other, the ramp in fixed order. */
export function CompositionDonut({ rows, labelKey, valueKey, animate }: { rows: readonly ChartRow[]; labelKey: string; valueKey: string; animate: boolean }) {
  const points = formSeries({ form: 'donut', category: labelKey, series: [valueKey] }, rows);
  if (points.length < 2) return null;
  const config = Object.fromEntries([
    ['value', { label: 'Value' }],
    ...points.map((p, index) => [`slice${String(index)}`, { label: String(p.category), color: index < 5 ? SHARE_FILLS[index] : 'var(--muted-foreground)' }]),
  ]) as ChartConfig;
  const data = points.map((p, index) => ({ name: String(p.category), value: Number(p.value ?? 0), fill: `var(--color-slice${String(index)})` }));
  return (
    <ChartContainer config={config} className="mx-auto aspect-square max-h-64 w-full">
      <PieChart>
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="name" />} />
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={56} strokeWidth={2} isAnimationActive={animate} animationDuration={CHART_INTRO_MS} />
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
  );
}

/**
 * One rate as one ring (the shadcn radial-text pattern): the arc is the
 * percentage, the number sits in the middle. For fulfilment, collection
 * against target — anything that reads "how much of the whole happened".
 */
export function RateRadial({ pct, label, animate }: { pct: number; label: string; animate: boolean }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const config = { value: { label, color: clamped >= 90 ? 'var(--success)' : clamped >= 60 ? 'var(--info)' : 'var(--warning)' } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="mx-auto aspect-square max-h-52 w-full">
      <RadialBarChart data={[{ name: label, value: clamped, fill: 'var(--color-value)' }]} startAngle={90} endAngle={90 - (clamped / 100) * 360} innerRadius={70} outerRadius={88}>
        <PolarGrid gridType="circle" radialLines={false} stroke="none" className="first:fill-muted last:fill-background" polarRadius={[74, 66]} />
        <RadialBar dataKey="value" background cornerRadius={8} isAnimationActive={animate} animationDuration={CHART_INTRO_MS} />
        <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
          <Label
            content={({ viewBox }) => {
              if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
                      {String(clamped)}%
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 22} className="fill-muted-foreground text-xs">
                      {label}
                    </tspan>
                  </text>
                );
              }
              return null;
            }}
          />
        </PolarRadiusAxis>
      </RadialBarChart>
    </ChartContainer>
  );
}
