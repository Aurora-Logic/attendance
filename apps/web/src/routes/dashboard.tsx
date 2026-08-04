import * as React from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"
import { CalendarClock, CircleAlert, Crown, Plane, Users } from "lucide-react"
import { Link } from "react-router"

import {
  ARRIVAL_HISTOGRAM,
  DEPARTMENTS,
  LATE_TREND,
  LEAVE_UTILISATION,
  OT_BY_DEPARTMENT,
  TURNAROUND_TREND,
  WEEK_TREND,
  seedApprovals,
  seedAttendanceDays,
} from "@/lib/seed"
import { rankedByPunctuality } from "@/lib/analytics"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"

/**
 * Series colours come from the theme's chart tokens only (--chart-1…5). Nothing
 * here names a hex, so both themes and any future palette change are free.
 */
const trendConfig = {
  present: { label: "Present", color: "var(--chart-1)" },
  leave: { label: "On leave", color: "var(--chart-3)" },
  absent: { label: "Absent", color: "var(--chart-5)" },
} satisfies ChartConfig

const lateConfig = {
  lateMinutes: { label: "Late minutes", color: "var(--chart-2)" },
} satisfies ChartConfig

// Bars are coloured per bucket from the --status-* tokens, so the histogram
// reads early→late without a legend.
const arrivalConfig = {
  count: { label: "Employees" },
} satisfies ChartConfig

const otConfig = {
  hours: { label: "Overtime hours" },
} satisfies ChartConfig

const turnaroundConfig = {
  l1: { label: "L1 · manager", color: "var(--chart-1)" },
  l2: { label: "L2 · HR", color: "var(--chart-4)" },
} satisfies ChartConfig

const utilisationConfig = {
  used: { label: "Used", color: "var(--chart-1)" },
  remaining: { label: "Remaining", color: "var(--muted)" },
} satisfies ChartConfig

const deptConfig = {
  headcount: { label: "Headcount" },
  Operations: { label: "Operations", color: "var(--chart-1)" },
  Production: { label: "Production", color: "var(--chart-2)" },
  Finance: { label: "Finance", color: "var(--chart-3)" },
  HR: { label: "HR", color: "var(--chart-4)" },
  Quality: { label: "Quality", color: "var(--chart-5)" },
} satisfies ChartConfig

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string
  value: string
  hint: string
  icon: React.ElementType
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {title}
        </CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{hint}</p>
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const days = React.useMemo(() => seedAttendanceDays(), [])
  const approvals = React.useMemo(() => seedApprovals().slice(0, 5), [])
  const podium = React.useMemo(() => rankedByPunctuality().slice(0, 3), [])

  const present = days.filter((d) => ["PRESENT", "ON_DUTY", "WFH"].includes(d.status)).length
  const onLeave = days.filter((d) => d.status.startsWith("ON_LEAVE")).length
  const pending = days.filter((d) => d.approvalStatus === "PENDING").length
  const avgLate = Math.round(
    days.reduce((sum, d) => sum + d.lateMinutes, 0) / Math.max(days.length, 1)
  )

  const byDepartment = React.useMemo(
    () =>
      DEPARTMENTS.map((department, index) => ({
        department,
        headcount: days.filter((d) => d.department === department).length,
        fill: `var(--chart-${index + 1})`,
      })),
    [days]
  )
  const headcount = byDepartment.reduce((sum, row) => sum + row.headcount, 0)

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        description="Monday, 3 August 2026 · all branches · seeded demo data"
        actions={
          <Button asChild size="sm">
            <Link to="/punch">Open punch screen</Link>
          </Button>
        }
      />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Present today"
            value={String(present)}
            hint={`of ${days.length} rostered`}
            icon={Users}
          />
          <StatCard
            title="On leave"
            value={String(onLeave)}
            hint="approved leave"
            icon={Plane}
          />
          <StatCard
            title="Pending approval"
            value={String(pending)}
            hint="flagged punches awaiting L1"
            icon={CircleAlert}
          />
          <StatCard
            title="Average late"
            value={`${avgLate}m`}
            hint="across everyone rostered today"
            icon={CalendarClock}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Attendance this week</CardTitle>
              <CardDescription>Company-wide, all branches</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={trendConfig} className="h-56 w-full">
                <BarChart data={WEEK_TREND} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="present" stackId="a" fill="var(--color-present)" />
                  <Bar dataKey="leave" stackId="a" fill="var(--color-leave)" />
                  <Bar
                    dataKey="absent"
                    stackId="a"
                    fill="var(--color-absent)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Headcount by department</CardTitle>
              <CardDescription>Rostered today</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={deptConfig} className="mx-auto h-56 w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="department" hideLabel />} />
                  <Pie
                    data={byDepartment}
                    dataKey="headcount"
                    nameKey="department"
                    innerRadius={56}
                    strokeWidth={4}
                  >
                    {byDepartment.map((entry) => (
                      <Cell key={entry.department} fill={entry.fill} />
                    ))}
                    <Label
                      content={({ viewBox }) => {
                        if (!viewBox || !("cx" in viewBox)) return null
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle">
                            <tspan
                              x={viewBox.cx}
                              y={viewBox.cy}
                              className="fill-foreground text-2xl font-semibold"
                            >
                              {headcount}
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy ?? 0) + 20}
                              className="fill-muted-foreground text-xs"
                            >
                              employees
                            </tspan>
                          </text>
                        )
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Two charts stacked so this column matches the height of the one
              beside it instead of leaving a hole under a single chart. */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Late minutes trend</CardTitle>
                <CardDescription>Total across the company, by week</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={lateConfig} className="h-40 w-full">
                  <LineChart data={LATE_TREND} accessibilityLayer margin={{ left: 4, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} width={36} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      dataKey="lateMinutes"
                      type="monotone"
                      stroke="var(--color-lateMinutes)"
                      strokeWidth={2}
                      dot={{ fill: "var(--color-lateMinutes)" }}
                    />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* flex-1 so this column's last card absorbs the height of the
                taller crown + approvals column beside it. */}
            <Card className="flex flex-1 flex-col">
              <CardHeader>
                <CardTitle>Arrival spread</CardTitle>
                <CardDescription>
                  Where people actually land relative to shift start, today
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <ChartContainer config={arrivalConfig} className="h-full min-h-44 w-full">
                  <BarChart data={ARRIVAL_HISTOGRAM} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="bucket"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      interval={0}
                      fontSize={11}
                    />
                    <YAxis tickLine={false} axisLine={false} width={28} />
                    <ChartTooltip content={<ChartTooltipContent nameKey="bucket" hideLabel />} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {ARRIVAL_HISTOGRAM.map((entry) => (
                        <Cell key={entry.bucket} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            {/* Monthly punctuality crown — earliest, most consistent arrivals. */}
            {podium.length > 0 ? (
              <Card className="ring-status-half-day/35 ring-1 ring-inset">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Crown className="text-status-half-day size-4" />
                    Punctuality crown
                  </CardTitle>
                  <CardDescription>Highest on-time share this month</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-0">
                  {podium.map((entry, index) => (
                    <React.Fragment key={entry.employee.id}>
                      {index > 0 ? <Separator /> : null}
                      <Item size="sm" asChild>
                        <Link to={`/employees/${entry.employee.id}`}>
                          <ItemMedia>
                            <Avatar className="size-8">
                              <AvatarFallback className="text-xs">
                                {entry.employee.initials}
                              </AvatarFallback>
                            </Avatar>
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle className="flex items-center gap-1.5">
                              {entry.employee.name}
                              {index === 0 ? (
                                <Crown className="text-status-half-day size-3.5" />
                              ) : null}
                            </ItemTitle>
                            <ItemDescription>{entry.employee.department}</ItemDescription>
                          </ItemContent>
                          <Badge variant={index === 0 ? "warning" : "outline"}>
                            {entry.score}%
                          </Badge>
                        </Link>
                      </Item>
                    </React.Fragment>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <Card className="flex flex-1 flex-col">
              <CardHeader>
                <CardTitle>Awaiting your approval</CardTitle>
                <CardDescription>Oldest first</CardDescription>
                <CardAction>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/approvals">View all</Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="flex flex-col">
                  {approvals.map((request, index) => (
                    <React.Fragment key={request.id}>
                      {index > 0 ? <Separator /> : null}
                      <Item size="sm">
                        <ItemMedia>
                          <Avatar className="size-8">
                            <AvatarFallback className="text-xs">
                              {request.initials}
                            </AvatarFallback>
                          </Avatar>
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{request.employeeName}</ItemTitle>
                          <ItemDescription>{request.subject}</ItemDescription>
                        </ItemContent>
                        <Badge variant={request.ageDays >= 2 ? "destructive" : "outline"}>
                          {request.ageDays}d
                        </Badge>
                      </Item>
                    </React.Fragment>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Overtime by department</CardTitle>
              <CardDescription>Approved hours, this month</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={otConfig} className="h-52 w-full">
                <BarChart
                  data={OT_BY_DEPARTMENT}
                  layout="vertical"
                  accessibilityLayer
                  margin={{ left: 4 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="department"
                    tickLine={false}
                    axisLine={false}
                    width={78}
                    fontSize={11}
                  />
                  <ChartTooltip content={<ChartTooltipContent nameKey="department" hideLabel />} />
                  <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                    {OT_BY_DEPARTMENT.map((entry) => (
                      <Cell key={entry.department} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approval turnaround</CardTitle>
              <CardDescription>Median hours from raise to decision</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={turnaroundConfig} className="h-52 w-full">
                <AreaChart data={TURNAROUND_TREND} accessibilityLayer margin={{ left: 4, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={30} unit="h" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area
                    dataKey="l1"
                    type="monotone"
                    stackId="a"
                    stroke="var(--color-l1)"
                    fill="var(--color-l1)"
                    fillOpacity={0.2}
                  />
                  <Area
                    dataKey="l2"
                    type="monotone"
                    stackId="a"
                    stroke="var(--color-l2)"
                    fill="var(--color-l2)"
                    fillOpacity={0.2}
                  />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Leave utilisation</CardTitle>
              <CardDescription>Share of entitlement consumed, by type</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={utilisationConfig} className="h-52 w-full">
                <BarChart data={LEAVE_UTILISATION} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={32} unit="%" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="used" stackId="a" fill="var(--color-used)" />
                  <Bar
                    dataKey="remaining"
                    stackId="a"
                    fill="var(--color-remaining)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </Page>
  )
}
