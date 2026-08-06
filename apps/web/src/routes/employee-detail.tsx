import * as React from "react"
import { Link, useNavigate, useParams } from "react-router"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"
import { ArrowLeft, Crown, ExternalLink, MapPin, Pencil } from "lucide-react"
import { toast } from "sonner"
import { minutesToClock, type DayStatus } from "@attendance/shared"

import { ApiError } from "@/lib/api"
import { EMPLOYEES, BRANCHES } from "@/lib/seed"
import { useDepartments, useEmployeesList, useShifts, useUpdateEmployee } from "@/lib/queries"
import { useSession } from "@/lib/session"
import { buildEmployeeAnalytics } from "@/lib/analytics"
import { mapsLinkFor } from "@/lib/geo"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const arrivalConfig = {
  minutes: { label: "Minutes vs shift start", color: "var(--chart-1)" },
} satisfies ChartConfig

const monthConfig = {
  present: { label: "Present", color: "var(--status-present)" },
  halfDay: { label: "Half day", color: "var(--status-half-day)" },
  leave: { label: "Leave", color: "var(--status-leave)" },
  absent: { label: "Absent", color: "var(--status-absent)" },
} satisfies ChartConfig

const splitConfig = {
  count: { label: "Days" },
} satisfies ChartConfig

const workedConfig = {
  hours: { label: "Worked", color: "var(--chart-2)" },
} satisfies ChartConfig

const weekdayConfig = {
  minutes: { label: "Late", color: "var(--chart-3)" },
} satisfies ChartConfig

/**
 * Edits land through PATCH /employees/:id — referential guards server-side
 * (unknown shift 422, bad manager 422), audited. Demo sessions get the local
 * toast so the control never pretends.
 */
function EditEmployeeSheet({
  live,
  fallbackName,
}: {
  live: { id: string; name: string; email: string; department: string; shiftId: string; isFieldEmployee: boolean } | null
  fallbackName: string
}) {
  const { user } = useSession()
  const { departments } = useDepartments()
  const { shifts } = useShifts()
  const update = useUpdateEmployee()
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({
    name: live?.name ?? fallbackName,
    email: live?.email ?? "",
    department: live?.department ?? "",
    shiftId: live?.shiftId ?? "",
    isFieldEmployee: live?.isFieldEmployee ?? false,
  })

  const onSave = () => {
    if (!(user?.source === "api" && live)) {
      toast.success("Employee updated (demo)", { description: form.name })
      setOpen(false)
      return
    }
    update.mutate(
      { id: live.id, ...form },
      {
        onSuccess: () => {
          toast.success("Employee updated", { description: form.name })
          setOpen(false)
        },
        onError: (error) =>
          toast.error("Could not update", {
            description:
              error instanceof ApiError && error.status === 403
                ? "Your role lacks employee.manage at write scope."
                : error instanceof ApiError && error.status === 422
                  ? "The server refused a reference (shift or manager)."
                  : String(error),
          }),
      }
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil />
          Edit
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit employee</SheetTitle>
          <SheetDescription>
            Changes apply from the next computed day; history is never rewritten.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="edit-name">Full name</FieldLabel>
              <Input
                id="edit-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-email">Work email</FieldLabel>
              <Input
                id="edit-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-dept">Department</FieldLabel>
              <Select
                value={form.department}
                onValueChange={(value) => setForm({ ...form, department: value })}
              >
                <SelectTrigger id="edit-dept">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments
                    .filter((department) => department.isActive)
                    .map((department) => (
                      <SelectItem key={department.id} value={department.name}>
                        {department.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-shift">Shift</FieldLabel>
              <Select
                value={form.shiftId}
                onValueChange={(value) => setForm({ ...form, shiftId: value })}
              >
                <SelectTrigger id="edit-shift">
                  <SelectValue placeholder="Select shift" />
                </SelectTrigger>
                <SelectContent>
                  {shifts.map((shift) => (
                    <SelectItem key={shift.id} value={shift.id}>
                      {shift.name} ({minutesToClock(shift.startMin)}–{minutesToClock(shift.endMin)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Applies from tomorrow's roster.</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="edit-field"
                checked={form.isFieldEmployee}
                onCheckedChange={(checked) => setForm({ ...form, isFieldEmployee: checked })}
              />
              <FieldContent>
                <FieldLabel htmlFor="edit-field">Field employee</FieldLabel>
                <FieldDescription>Exempt from the geofence check.</FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        </div>
        <SheetFooter className="flex-row border-t">
          <SheetClose asChild>
            <Button variant="outline" className="flex-1">
              Cancel
            </Button>
          </SheetClose>
          <Button className="flex-1" onClick={onSave} disabled={update.isPending}>
            Save changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function EmployeeDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { scopeFor } = useSession()
  const { employees: liveEmployees } = useEmployeesList()
  const employee =
    EMPLOYEES.find((entry) => entry.id === id) ??
    liveEmployees.find((entry) => entry.id === id) ??
    null
  const liveRow = liveEmployees.find((entry) => entry.id === id && entry.shiftId) ?? null
  const canEdit = scopeFor("employee.manage") !== "NONE"

  // Seeded employees carry three months of synthetic history; a live-API
  // employee has only what has actually been punched, so charts wait.
  const hasHistory = Boolean(EMPLOYEES.find((entry) => entry.id === id))
  const analytics = React.useMemo(
    () => (employee && hasHistory ? buildEmployeeAnalytics(employee) : null),
    [employee, hasHistory]
  )

  if (!employee) {
    return (
      <Page>
        <PageHeader title="Employee" />
        <PageBody>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No such employee</EmptyTitle>
              <EmptyDescription>
                That id does not match anyone on the roll.
              </EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" size="sm" onClick={() => navigate("/employees")}>
              Back to employees
            </Button>
          </Empty>
        </PageBody>
      </Page>
    )
  }

  const branch = BRANCHES.find((entry) => entry.id === employee.branchId)

  return (
    <Page>
      <PageHeader
        title={employee.name}
        description={`${employee.code} · ${employee.designation} · ${employee.department} · ${branch?.name ?? "—"}`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/employees">
              <ArrowLeft />
              <span className="hidden sm:inline">All employees</span>
            </Link>
          </Button>
        }
      />
      <PageBody>
        {/* ---- identity strip ---- */}
        <Card className="py-4">
          <CardContent className="flex flex-wrap items-center gap-4">
            <Avatar className="size-14">
              <AvatarFallback className="text-lg">{employee.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold">{employee.name}</p>
                <Badge variant={employee.status === "CONFIRMED" ? "success" : "warning"}>
                  {employee.status}
                </Badge>
                {employee.isFieldEmployee ? (
                  <Badge variant="info">Field · geofence exempt</Badge>
                ) : null}
                {analytics?.hasCrown ? (
                  <Badge variant="warning" className="gap-1">
                    <Crown />
                    Punctuality crown · July
                  </Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {employee.email} · joined {employee.doj} · reports to {employee.manager} ·{" "}
                {employee.shift}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canEdit ? (
                <EditEmployeeSheet
                  key={employee.id}
                  live={
                    liveRow
                      ? {
                          id: liveRow.id,
                          name: liveRow.name,
                          email: liveRow.email,
                          department: liveRow.department,
                          shiftId: liveRow.shiftId ?? "",
                          isFieldEmployee: liveRow.isFieldEmployee,
                        }
                      : null
                  }
                  fallbackName={employee.name}
                />
              ) : null}
              <Button variant="outline" size="sm" asChild>
                <a
                  href={mapsLinkFor({ lat: 19.076, lng: 72.8777 })}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin />
                  Branch pin
                  <ExternalLink />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {!analytics ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No history yet</EmptyTitle>
              <EmptyDescription>
                Analytics build from punched days. This employee is on the live API — charts fill
                in as attendance accrues.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {analytics ? (
          <>
        {/* ---- KPI strip ---- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {analytics.kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-md border px-3 py-2.5">
              <p className="text-muted-foreground text-xs">{kpi.label}</p>
              <p className="text-lg font-semibold tabular-nums">{kpi.value}</p>
              <p className="text-muted-foreground truncate text-xs">{kpi.hint}</p>
            </div>
          ))}
        </div>

        {/* ---- punctuality ---- */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Arrival relative to shift start</CardTitle>
              <CardDescription>
                Below the line is early, above it is late. The band is the {analytics.graceMinutes}
                -minute grace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={arrivalConfig} className="h-56 w-full">
                <AreaChart data={analytics.arrivalSeries} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={40} unit="m" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area isAnimationActive={false}
                    dataKey="minutes"
                    type="monotone"
                    stroke="var(--color-minutes)"
                    fill="var(--color-minutes)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Punctuality score</CardTitle>
              <CardDescription>Share of days arriving within grace</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-baseline gap-2">
                <span
                  className={
                    analytics.punctualityScore >= 90
                      ? "text-status-present text-4xl font-semibold tabular-nums"
                      : analytics.punctualityScore >= 75
                        ? "text-status-half-day text-4xl font-semibold tabular-nums"
                        : "text-status-absent text-4xl font-semibold tabular-nums"
                  }
                >
                  {analytics.punctualityScore}%
                </span>
                <span className="text-muted-foreground text-sm">
                  rank {analytics.rank} of {EMPLOYEES.length}
                </span>
              </div>
              <Progress value={analytics.punctualityScore} />
              <Separator />
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Average arrival</span>
                  <span className="font-medium tabular-nums">{analytics.averageArrival}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Earliest</span>
                  <span className="text-status-present font-medium tabular-nums">
                    {analytics.earliestArrival}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Late marks this month</span>
                  <span className="font-medium tabular-nums">
                    {analytics.lateMarks} of {analytics.lateAllowance} allowed
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Overtime</span>
                  <span className="font-medium tabular-nums">{analytics.otHours} h</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ---- composition ---- */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Six-month attendance</CardTitle>
              <CardDescription>Day outcomes per month</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={monthConfig} className="h-56 w-full">
                <BarChart data={analytics.monthlySeries} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar isAnimationActive={false} dataKey="present" stackId="a" fill="var(--color-present)" />
                  <Bar isAnimationActive={false} dataKey="halfDay" stackId="a" fill="var(--color-halfDay)" />
                  <Bar isAnimationActive={false} dataKey="leave" stackId="a" fill="var(--color-leave)" />
                  <Bar isAnimationActive={false} dataKey="absent" stackId="a" fill="var(--color-absent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>This month</CardTitle>
              <CardDescription>Day-status split</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={splitConfig} className="mx-auto h-56 w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="label" hideLabel />} />
                  <Pie isAnimationActive={false} data={analytics.statusSplit} dataKey="count" nameKey="label" innerRadius={48}>
                    {analytics.statusSplit.map((entry) => (
                      <Cell key={entry.label} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="flex flex-wrap justify-center gap-1.5">
                {analytics.statusSplit.map((entry) => (
                  <StatusBadge key={entry.label} status={entry.status as DayStatus} />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ---- working pattern ---- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Worked hours — last 20 days</CardTitle>
              <CardDescription>
                Against the {analytics.graceMinutes >= 0 ? "8h" : ""} full-day threshold
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={workedConfig} className="h-44 w-full">
                <BarChart data={analytics.workedSeries} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={30} unit="h" domain={[0, 10]} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar isAnimationActive={false} dataKey="hours" fill="var(--color-hours)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Late minutes by weekday</CardTitle>
              <CardDescription>Where the lateness clusters</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={weekdayConfig} className="h-44 w-full">
                <BarChart data={analytics.weekdayLate} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="weekday" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={30} unit="m" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar isAnimationActive={false} dataKey="minutes" fill="var(--color-minutes)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        {/* ---- recent punches ---- */}
        
        <Card className="gap-0 py-0">
          <CardHeader className="py-4">
            <CardTitle>Recent punches</CardTitle>
            <CardDescription>
              Raw append-only log. A correction writes a new row, never an edit.
            </CardDescription>
          </CardHeader>
          <div className="overflow-x-auto border-t">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead>Worked</TableHead>
                  <TableHead>Arrival</TableHead>
                  <TableHead>Geofence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.recentDays.map((day) => (
                  <TableRow key={day.date}>
                    <TableCell className="font-mono text-xs">{day.date}</TableCell>
                    <TableCell>
                      <StatusBadge status={day.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{day.inAt ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{day.outAt ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{day.worked}</TableCell>
                    <TableCell>
                      <span
                        className={
                          day.arrivalMinutes === null
                            ? "text-muted-foreground"
                            : day.arrivalMinutes < 0
                              ? "text-status-present tabular-nums"
                              : day.arrivalMinutes <= analytics.graceMinutes
                                ? "text-status-wfh tabular-nums"
                                : "text-status-absent tabular-nums"
                        }
                      >
                        {day.arrivalMinutes === null
                          ? "—"
                          : day.arrivalMinutes < 0
                            ? `${Math.abs(day.arrivalMinutes)}m early`
                            : day.arrivalMinutes === 0
                              ? "on the dot"
                              : `${day.arrivalMinutes}m late`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={day.insideGeofence ? "success" : "warning"}>
                        {day.insideGeofence ? "Inside" : "Outside"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
          </>
        ) : null}
      </PageBody>
    </Page>
  )
}
