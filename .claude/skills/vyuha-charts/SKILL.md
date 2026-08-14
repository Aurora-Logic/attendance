---
name: vyuha-charts
description: How charts and insights are built in Vyuha - dashboard, employee detail, analytics, reports. Use whenever adding or changing any chart, KPI tile, trend, sparkline, or insight sentence. Enforces the dataviz skill, the shadcn chart primitive via the MCP, the series/charts file split with tests, computed insight sentences, reduced-motion handling, and the emil-design-eng and thumb-reach passes.
---

# Vyuha charts and insights

A chart in this product answers a question someone actually asks at work.
Before drawing one, write the question down; if no question survives, the
answer was a table.

## 1. Order of operations - non-negotiable

1. Load the `dataviz` skill BEFORE writing the first line of chart code -
   form choice, palette, axis and tooltip rules come from there.
2. Check the shadcn MCP for what already exists: the chart primitive is
   installed at `apps/web/src/components/ui/chart.tsx` (ChartContainer over
   Recharts); use `get_item_examples_from_registries` for `chart` examples
   rather than inventing markup.
3. Load `emil-design-eng` for the polish pass and `thumb-reach` for the
   phone pass. Both, every time, on every chart surface. This is a standing
   instruction, not a suggestion.

## 2. The house pattern - follow the three existing examples

`features/dashboard/`, `features/attendance/`, and `features/employees/`
already agree on a shape. New chart work copies it:

- **`series.ts` (or `chart-series.ts`)** - pure functions from API rows to
  plottable series. No React, no fetching. Unit-tested - the precedents are
  `features/analytics/series.test.ts`,
  `features/attendance/chart-series.test.ts` and
  `features/employees/attendance-analysis.test.ts`
  (`features/dashboard/series.ts` currently has no test, which makes it the
  exception to fix when touched, not the example to copy). Every threshold
  an insight depends on lives here, named, and tested.
- **`charts.tsx`** - presentational only: ChartContainer + Recharts, theme
  tokens for colour, no data massaging.
- **A data hook** (`use-attendance-range.ts` style) - fetching and paging,
  separate from both.
- **`use-chart-motion.ts`** - the draw-once rule: a chart animates on first
  paint after data arrives and never again; `prefers-reduced-motion` is read
  in JS and passed as `isAnimationActive={false}` because Recharts animates
  via rAF, not CSS. Three near-identical copies exist (dashboard, attendance,
  employees); if you touch a second one in the same change, lift it to
  `components/shared/` rather than adding a fourth.

## 3. Insights are sentences computed from data

An insight is a claim the series proves, rendered beside the chart in plain
prose: "Late arrivals doubled in the last two weeks - 9 of the 11 were
Mondays." Rules:

- Computed in `series.ts` with the thresholds visible and tested - never
  composed ad hoc in JSX, never vibes ("attendance looks good").
- Insufficient data states its insufficiency: "Not enough working days this
  period to read a trend" beats a line drawn through four points.
- An insight must be actionable by the person seeing it; scope it to what
  their role can act on.
- Never surface an insight derived from data the viewer's permissions would
  not let them see raw. Overtime is the live example: `visibility.ts` and
  the server already withhold `otMinutes` from self-only viewers - insights
  inherit that, they do not route around it.

## 4. Layout and the constitution

- No box-in-box: charts sit on the page surface under a `SectionHeading`,
  not inside nested cards.
- Empty, loading (skeleton sized like the chart, not a spinner), and error
  states, all three, per chart.
- Both themes: colours come from the shadcn theme tokens through
  ChartContainer's config; verify dark mode, do not assume it.
- 360px: chart takes full width, legends wrap or collapse, tooltips are
  touch-usable (thumb-reach covers the 44px floor), no horizontal scroll.
  Verify at 360 and 1920.

## 5. Definition of done for a chart

- Series builder unit-tested, including the empty and single-point cases.
- Insight thresholds tested.
- Empty, loading, error states implemented.
- Reduced motion respected via the motion hook.
- Both themes checked; 360px checked; no console errors.
- The question the chart answers is stated in a comment above the series
  builder - the one comment this codebase wants.
