import { compactCount, stackTotal, valueCaps } from '@/components/shared/chart-labels';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, LabelList } from 'recharts';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

import { formatDuration } from './format';
import {
  axisTicks,
  hourTicks,
  shortDate,
  type BandPoint,
  type HoursPoint,
  type TimekeepingPoint,
} from './chart-series';
import { CHART_INTRO_MS } from './use-chart-motion';

/**
 * The charts the two attendance screens draw, and the surface they sit on.
 *
 * Every one is a shadcn `ChartContainer` — there is no bare `ResponsiveContainer`
 * and no second charting library anywhere in this app.
 *
 * Colour comes from the theme's semantic status tokens, never from
 * `--chart-1..5`. That ramp is five steps of one pink hue in this theme, which
 * would say a present day and an absent day are the same kind of thing in two
 * shades. The product has already decided what green, blue, red and grey mean
 * (see `status.ts`) and a colour has to mean one thing everywhere
 * (CLAUDE.md §3 rule 4).
 *
 * The pairings are measured, not eyeballed. OKLab ΔE x100 with the pair run
 * through a colour-vision simulation, floor 6, target 8:
 *
 *   work / leave / absent / other   worst 12.2 deuteranopia, 10.1 protanopia
 *   late (warning) / early (info)   worst 42.0 deuteranopia, 30.1 protanopia
 *
 * Two pairings this file must never use, for the same reason: destructive
 * beside warning measures 5.5 under deuteranopia, and success beside warning
 * measures 4.7 under protanopia. Both are fails. Every chart still carries a
 * legend and a tooltip naming the series in words, because colour alone is
 * never the only encoding.
 *
 * `animate` is threaded in rather than decided here: the screen owns the
 * "once, on first paint" policy, and a chart deciding for itself would
 * re-animate every time a filter changed.
 */

/**
 * The legend, in the order the series are drawn.
 *
 * Left alone, recharts orders legend entries by what the payload happens to
 * contain, so one absent day put "Absent" first and the row reshuffled every
 * time the period changed — the legend and the thing it explains disagreeing
 * about their own order. Recharts 3 does not accept a `payload` prop on
 * Legend, so the order is imposed on the payload it clones in on its way to
 * the shadcn legend rather than by replacing it.
 *
 * A component taking the order as a prop, rather than a factory returning one:
 * a factory is a non-component export and this file may only export components
 * if fast refresh is to keep working. Exported so Analytics orders its legends
 * the same way rather than growing a second copy of the fix.
 */
export function OrderedChartLegend({
  // `seriesOrder` rather than `order`: recharts' own legend props already
  // carry an `order`, typed as a sort direction, and reusing the name made the
  // prop unassignable rather than merely confusing.
  seriesOrder,
  ...props
}: { seriesOrder: readonly string[] } & React.ComponentProps<typeof ChartLegendContent>) {
  const rank = (key: unknown) => {
    const at = seriesOrder.indexOf(String(key));
    return at === -1 ? seriesOrder.length : at;
  };
  const payload = [...(props.payload ?? [])].sort(
    (left, right) => rank(left.dataKey) - rank(right.dataKey),
  );
  return <ChartLegendContent {...props} payload={payload} />;
}

/** Bottom to top: who came, who had a reason, who did not, who was not due. */
const BAND_ORDER = ['work', 'leave', 'absent', 'other'];
const TIMEKEEPING_ORDER = ['lateMinutes', 'earlyExitMinutes'];

const BAND_CONFIG = {
  work: { label: 'At work', color: 'var(--success)' },
  leave: { label: 'On leave', color: 'var(--info)' },
  absent: { label: 'Absent', color: 'var(--destructive)' },
  other: { label: 'Off or pending', color: 'var(--muted-foreground)' },
} satisfies ChartConfig;

const HOURS_CONFIG = {
  workedMinutes: { label: 'Worked', color: 'var(--success)' },
} satisfies ChartConfig;

const TIMEKEEPING_CONFIG = {
  lateMinutes: { label: 'Arrived late', color: 'var(--warning)' },
  earlyExitMinutes: { label: 'Left early', color: 'var(--info)' },
} satisfies ChartConfig;

/** Five dates is what fits at 360px without the labels touching. */
const MAX_DATE_TICKS = 5;

/**
 * Room on the right for the last date label, and none taken off the left.
 *
 * A negative left margin is the registry's own default and it clips the widest
 * y tick — a bug already fixed once in this codebase, so it is spelled out
 * here rather than left to a default. Ticks are centred under their category,
 * so at 360px the final "13 Aug" hung half outside the plot and was clipped by
 * the panel; the right margin moves the last column in far enough for its own
 * label.
 */
/* `top` is room for the value on a bar cap or a line end. At 4px the
   tallest mark had its label sliced off by the plot edge -- the marks
   that most need reading were the ones cut in half. */
const AXIS_MARGIN = { left: 0, right: 16, top: 20 } as const;

/**
 * The axis label colour, set here rather than inherited.
 *
 * chart.tsx paints ticks with `[&_.recharts-cartesian-axis-tick_text]`, and in
 * recharts 3.8 the label sits one level deeper, inside
 * `.recharts-cartesian-axis-tick-label`. The selector misses, so every tick
 * keeps recharts' own `fill="#666"`: 5.7:1 on the light ground and 3.4:1 on
 * the dark one, which fails the 4.5:1 NFR-07 asks for. A class on the tick
 * beats the presentation attribute and follows the theme in both modes.
 */
const TICK = { className: 'fill-muted-foreground' } as const;

interface ChartProps<T> {
  points: readonly T[];
  animate: boolean;
}

function dateTick(value: unknown): string {
  return shortDate(String(value));
}

function fullDate(value: unknown): string {
  return formatDate(String(value));
}

function hoursTick(value: unknown): string {
  return `${String(Math.round(Number(value) / 60))}h`;
}

function durationValue(value: unknown): string {
  return formatDuration(Number(value));
}

function minutesValue(value: unknown): string {
  const minutes = Number(value);
  return minutes > 0 ? `${String(minutes)} min` : '0 min';
}

/**
 * The surface a chart sits on: one border, a caption, and the plot.
 *
 * The caption is inside the border rather than above it because the section
 * already has a heading, and a second heading outside would read as a second
 * section. It is text, not a card header — nothing here nests a surface in a
 * surface (CLAUDE.md §3 rule 3).
 *
 * Exported so the Analytics screen puts its charts on exactly this surface
 * rather than inventing a second one. It lives here rather than in
 * `components/shared` only because that directory is shared between agents
 * mid-flight; it is general and belongs there.
 */
export function ChartPanel({
  caption,
  note,
  icon,
  children,
}: {
  caption: string;
  note?: string;
  /** The glyph the panel's subject wears elsewhere (the flag), so the caption agrees with the rows. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-1 text-xs font-medium [&_svg]:size-3.5">
          {icon ? <span aria-hidden className="text-muted-foreground">{icon}</span> : null}
          {caption}
        </h3>
        {note ? <p className="text-muted-foreground text-[0.6875rem] tabular-nums">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * How many people were in each band, day by day.
 *
 * On Team Attendance this is the fortnight behind the muster: the table says
 * what happened today, and this says whether today is normal. Absent sits high
 * in the stack on purpose — it is the band somebody has to act on, and a band
 * buried at the bottom of a stack cannot be compared across columns.
 */
export function StatusBandsChart({ points, animate }: ChartProps<BandPoint>) {
  return (
    <ChartContainer config={BAND_CONFIG} className="aspect-auto h-48 w-full min-w-0 sm:h-56">
      <BarChart accessibilityLayer data={[...points]} margin={AXIS_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tick={TICK}
          tickMargin={8}
          interval={0}
          ticks={axisTicks(points.map((point) => point.date), MAX_DATE_TICKS)}
          tickFormatter={dateTick}
        />
        <YAxis width={28} tickLine={false} axisLine={false} tick={TICK} allowDecimals={false} tickCount={4} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={fullDate} />} />
        <ChartLegend content={<OrderedChartLegend seriesOrder={BAND_ORDER} className="flex-wrap gap-x-4 gap-y-1" />} />
        <Bar
          dataKey="work"
          stackId="day"
          fill="var(--color-work)"
          maxBarSize={28}
          isAnimationActive={animate}
          animationDuration={CHART_INTRO_MS}
          animationEasing="ease-out"
        />
        <Bar
          dataKey="leave"
          stackId="day"
          fill="var(--color-leave)"
          maxBarSize={28}
          isAnimationActive={animate}
          animationDuration={CHART_INTRO_MS}
          animationEasing="ease-out"
        />
        <Bar
          dataKey="absent"
          stackId="day"
          fill="var(--color-absent)"
          maxBarSize={28}
          isAnimationActive={animate}
          animationDuration={CHART_INTRO_MS}
          animationEasing="ease-out"
        />
        <Bar
          dataKey="other"
          stackId="day"
          fill="var(--color-other)"
          maxBarSize={28}
          isAnimationActive={animate}
          animationDuration={CHART_INTRO_MS}
          animationEasing="ease-out"
        >
          <LabelList {...stackTotal([...points], ['work', 'leave', 'absent', 'other'])} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** One person's worked hours per day, for the month on screen. */
export function WorkedHoursChart({ points, animate }: ChartProps<HoursPoint>) {
  const { domainMax, ticks } = hourTicks(
    points.reduce((most, point) => Math.max(most, point.workedMinutes), 0),
  );

  return (
    <ChartContainer config={HOURS_CONFIG} className="aspect-auto h-40 w-full min-w-0 sm:h-44">
      <BarChart accessibilityLayer data={[...points]} margin={AXIS_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tick={TICK}
          tickMargin={8}
          interval={0}
          ticks={axisTicks(points.map((point) => point.date), MAX_DATE_TICKS)}
          tickFormatter={dateTick}
        />
        <YAxis
          width={32}
          tickLine={false}
          axisLine={false}
          tick={TICK}
          domain={[0, domainMax]}
          ticks={ticks}
          tickFormatter={hoursTick}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent labelFormatter={fullDate} formatter={durationValue} indicator="dot" />
          }
        />
        {/* Minutes, drawn as hours. Plotting the rounded hours instead would
            make the tooltip disagree with the bar it is describing. */}
        <Bar
          dataKey="workedMinutes"
          fill="var(--color-workedMinutes)"
          maxBarSize={24}
          isAnimationActive={animate}
          animationDuration={CHART_INTRO_MS}
          animationEasing="ease-out"
        >
          <LabelList {...valueCaps('workedMinutes', compactCount)} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Minutes lost at each end of the day, side by side rather than stacked.
 *
 * Stacking them would produce a "total minutes lost" nobody asked for and
 * would hide which end of the day the problem is at, which is the only reason
 * to look at this chart at all.
 */
export function TimekeepingChart({ points, animate }: ChartProps<TimekeepingPoint>) {
  return (
    <ChartContainer config={TIMEKEEPING_CONFIG} className="aspect-auto h-40 w-full min-w-0 sm:h-44">
      {/* The gaps are set rather than defaulted, and it is a legibility fix
          rather than a preference. A 31-day month at 360px gives each date an
          8px band; recharts' default 4px gap between two series inside it left
          bars measuring 1px, which is a tick mark, not a measurement. With no
          gap between the pair they touch and read as one column split by
          colour, which is what they are. */}
      <BarChart
        accessibilityLayer
        data={[...points]}
        margin={AXIS_MARGIN}
        barGap={0}
        barCategoryGap="12%"
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tick={TICK}
          tickMargin={8}
          interval={0}
          ticks={axisTicks(points.map((point) => point.date), MAX_DATE_TICKS)}
          tickFormatter={dateTick}
        />
        <YAxis width={32} tickLine={false} axisLine={false} tick={TICK} allowDecimals={false} tickCount={4} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={fullDate} formatter={minutesValue} />}
        />
        <ChartLegend content={<OrderedChartLegend seriesOrder={TIMEKEEPING_ORDER} className="flex-wrap gap-x-4 gap-y-1" />} />
        <Bar
          dataKey="lateMinutes"
          fill="var(--color-lateMinutes)"
          maxBarSize={12}
          isAnimationActive={animate}
          animationDuration={CHART_INTRO_MS}
          animationEasing="ease-out"
        >
          <LabelList {...valueCaps('lateMinutes', compactCount)} />
        </Bar>
        <Bar
          dataKey="earlyExitMinutes"
          fill="var(--color-earlyExitMinutes)"
          maxBarSize={12}
          isAnimationActive={animate}
          animationDuration={CHART_INTRO_MS}
          animationEasing="ease-out"
        >
          <LabelList {...valueCaps('earlyExitMinutes', compactCount)} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/**
 * The loading chart's bar heights, as classes rather than an inline style.
 * CLAUDE.md §3 rule 1 allows Tailwind and the theme tokens and nothing else,
 * and a percentage height is expressible in both.
 */
const SKELETON_BARS = [
  'h-[45%]',
  'h-[70%]',
  'h-[55%]',
  'h-[80%]',
  'h-[60%]',
  'h-[90%]',
  'h-[50%]',
  'h-[75%]',
  'h-[65%]',
  'h-[85%]',
  'h-[55%]',
  'h-[70%]',
];

/**
 * The loading state, shaped like the chart it stands in for.
 *
 * A single grey block would be honest about "something is coming" and wrong
 * about what: the page would resize when the real chart arrived. These are the
 * same heights as the charts above.
 */
export function ChartSkeleton({
  label,
  className,
  shape = 'bars',
}: {
  label: string;
  className?: string;
  /**
   * `row` for the charts that are a single horizontal bar. A column of twelve
   * vertical bars standing in for one wide row is the same height and the
   * wrong shape, which is the half of this problem a height alone does not
   * fix: the page does not jump, but the reader is told to expect the wrong
   * thing for a second.
   */
  shape?: 'bars' | 'row';
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {shape === 'row' ? (
        <div aria-hidden className="flex h-full flex-col justify-center gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-3 w-40 self-center" />
        </div>
      ) : (
        <div aria-hidden className="flex h-full items-end gap-1.5">
          {SKELETON_BARS.map((height, index) => (
            <Skeleton key={index} className={cn('min-w-0 flex-1', height)} />
          ))}
        </div>
      )}
    </div>
  );
}
