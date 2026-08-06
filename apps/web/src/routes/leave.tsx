import * as React from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { CalendarIcon, CalendarPlus, Send } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { Cell, Pie, PieChart } from "recharts"
import { countLeaveUnits } from "@attendance/shared"

import { ApiError } from "@/lib/api"
import { useAppConfig } from "@/lib/app-config"
import { useApplyLeave, useLeaveBalances, useMyLeaveRequests } from "@/lib/queries"
import { useSession } from "@/lib/session"
import { seedApprovals, seedLeaveLedger, type LeaveBalance, type LeaveLedgerRow } from "@/lib/seed"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const ledgerColumns: ColumnDef<LeaveLedgerRow>[] = [
  { accessorKey: "date", header: "Date", meta: { label: "Date" } },
  {
    accessorKey: "type",
    header: "Type",
    meta: { label: "Type" },
    cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge>,
  },
  {
    accessorKey: "txnType",
    header: "Transaction",
    meta: { label: "Transaction" },
    cell: ({ row }) => (
      <Badge variant={row.original.units < 0 ? "secondary" : "default"}>
        {row.original.txnType.replaceAll("_", " ")}
      </Badge>
    ),
  },
  {
    accessorKey: "units",
    header: "Units",
    meta: { label: "Units" },
    cell: ({ row }) => (
      <span className={row.original.units < 0 ? "text-destructive tabular-nums" : "tabular-nums"}>
        {row.original.units > 0 ? "+" : ""}
        {row.original.units}
      </span>
    ),
  },
  {
    accessorKey: "balanceAfter",
    header: "Balance after",
    meta: { label: "Balance after" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.balanceAfter}</span>,
  },
  { accessorKey: "remarks", header: "Remarks", meta: { label: "Remarks" } },
]

/** Donut input: where the year's availed leave went, coloured by chart tokens. */
const splitOf = (balances: LeaveBalance[]) =>
  balances
    .filter((balance) => balance.availed > 0)
    .map((balance, index) => ({
      name: balance.code,
      availed: balance.availed,
      fill: `var(--chart-${(index % 5) + 1})`,
    }))

const availedConfig = {
  availed: { label: "Days" },
} satisfies ChartConfig

interface MyRequest {
  id: string
  type: string
  from: string
  to: string
  part: string
  units: number
  reason: string
  status: "PENDING" | "APPROVED" | "REJECTED"
}

const toISO = (date: Date) => format(date, "yyyy-MM-dd")

function DateField({
  id,
  label,
  value,
  onChange,
  disabledBefore,
}: {
  id: string
  label: string
  value: Date | undefined
  onChange: (date: Date | undefined) => void
  disabledBefore?: Date
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {/* date-picker is popover + calendar — there is no registry component. */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} variant="outline" className="w-full justify-start font-normal">
            <CalendarIcon />
            {value ? format(value, "EEE, d MMM yyyy") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            defaultMonth={value ?? new Date(2026, 7, 1)}
            disabled={disabledBefore ? { before: disabledBefore } : undefined}
            onSelect={(date) => {
              onChange(date ?? undefined)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </Field>
  )
}

/**
 * The real Apply flow. Units come from the same countLeaveUnits the API and
 * the nightly job use — sandwich setting included — so what this preview says
 * is exactly what the balance will be debited.
 */
function ApplyLeaveSheet({
  balances,
  onSubmit,
}: {
  balances: LeaveBalance[]
  onSubmit: (request: MyRequest) => void
}) {
  const { settings, roster } = useAppConfig()
  const { user } = useSession()
  const applyLeave = useApplyLeave()
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState("CL")
  const [from, setFrom] = React.useState<Date | undefined>(new Date(2026, 7, 7))
  const [to, setTo] = React.useState<Date | undefined>(new Date(2026, 7, 10))
  const [part, setPart] = React.useState("FULL")
  const [reason, setReason] = React.useState("")

  const calendar = React.useMemo(
    () => ({
      isHoliday: (date: string) => Boolean(roster.holidays[date]),
      isWeeklyOff: (date: string) => new Date(`${date}T00:00:00`).getDay() === 0,
    }),
    [roster.holidays]
  )

  const singleDay = from && to && toISO(from) === toISO(to)
  const rangeValid = from && to && toISO(from) <= toISO(to)
  const units = rangeValid
    ? countLeaveUnits(
        toISO(from!),
        toISO(to!),
        (singleDay ? part : "FULL") as "FULL" | "FIRST_HALF" | "SECOND_HALF",
        calendar,
        settings.sandwichLeave
      )
    : 0

  const balance = balances.find((entry) => entry.code === type)?.balance ?? 0
  const insufficient = type !== "LOP" && units > balance
  const canSubmit = Boolean(rangeValid) && units > 0 && !insufficient && reason.trim().length >= 3

  const submit = () => {
    const request: MyRequest = {
      id: `req_${Date.now()}`,
      type,
      from: toISO(from!),
      to: toISO(to!),
      part: (singleDay ? part : "FULL") as MyRequest["part"],
      units,
      reason: reason.trim(),
      status: "PENDING",
    }

    if (user?.source === "api") {
      applyLeave.mutate(
        { type, from: request.from, to: request.to, part: request.part as "FULL" | "FIRST_HALF" | "SECOND_HALF", reason: request.reason },
        {
          onSuccess: ({ units: serverUnits }) => {
            toast.success(`Leave applied — ${serverUnits} day(s) of ${type}`, {
              description: "Recorded on the server and sent to your reporting manager (L1).",
            })
            setOpen(false)
            setReason("")
          },
          onError: (error) => {
            const body = error instanceof ApiError ? (error.body as { error?: string }) : null
            toast.error("Application refused", {
              description:
                body?.error === "INSUFFICIENT_BALANCE"
                  ? `Not enough ${type} balance on the server ledger.`
                  : body?.error === "NO_WORKING_DAYS_IN_RANGE"
                    ? "The range contains no working days."
                    : String(error),
            })
          },
        }
      )
      return
    }

    onSubmit(request)
    toast.success(`Leave applied — ${units} day(s) of ${type} (demo)`, {
      description: "Sent to your reporting manager (L1). You will be notified on decision.",
    })
    setOpen(false)
    setReason("")
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <CalendarPlus />
          Apply for leave
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Apply for leave</SheetTitle>
          <SheetDescription>
            Goes to your reporting manager, then HR if unactioned for{" "}
            {settings.approvalEscalateAfterDays} days.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="leave-type">Leave type</FieldLabel>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="leave-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {balances.map((entry) => (
                    <SelectItem key={entry.code} value={entry.code}>
                      {entry.name}
                      {entry.entitled > 0 ? ` · ${entry.balance} left` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <DateField id="leave-from" label="From" value={from} onChange={setFrom} />
              <DateField
                id="leave-to"
                label="To"
                value={to}
                onChange={setTo}
                disabledBefore={from}
              />
            </div>

            {singleDay ? (
              <Field>
                <FieldLabel>Day part</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={part}
                  onValueChange={(value) => value && setPart(value)}
                  className="w-full"
                >
                  <ToggleGroupItem value="FULL" className="flex-1">
                    Full day
                  </ToggleGroupItem>
                  <ToggleGroupItem value="FIRST_HALF" className="flex-1">
                    1st half
                  </ToggleGroupItem>
                  <ToggleGroupItem value="SECOND_HALF" className="flex-1">
                    2nd half
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
            ) : null}

            <Field data-invalid={reason.length > 0 && reason.trim().length < 3}>
              <FieldLabel htmlFor="leave-reason">Reason</FieldLabel>
              <Textarea
                id="leave-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Family function out of town. Handover shared with the shift supervisor."
              />
              {reason.length > 0 && reason.trim().length < 3 ? (
                <FieldError errors={[{ message: "A few words, at least." }]} />
              ) : null}
            </Field>

            <div className="rounded-md border px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">This application costs</span>
                <span className="font-semibold tabular-nums">{units} day(s)</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Balance after approval</span>
                <span
                  className={
                    insufficient ? "text-destructive font-semibold" : "font-semibold tabular-nums"
                  }
                >
                  {type === "LOP" ? "—" : (balance - units).toFixed(1)}
                </span>
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs">
                {settings.sandwichLeave
                  ? "Sandwich rule is ON: a weekly off or holiday between leave days is charged."
                  : "Weekly offs and holidays inside the range are free."}
              </p>
              {insufficient ? (
                <p className="text-destructive mt-1 text-xs font-medium">
                  Not enough {type} balance — you have {balance}.
                </p>
              ) : null}
            </div>
          </FieldGroup>
        </div>

        <SheetFooter>
          <Button disabled={!canSubmit} onClick={submit}>
            <Send />
            Submit application
          </Button>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function LeavePage() {
  const { balances } = useLeaveBalances()
  const apiMyRequests = useMyLeaveRequests()
  const availedSplit = React.useMemo(() => splitOf(balances), [balances])
  const ledger = React.useMemo(() => seedLeaveLedger(), [])
  const teamLeave = React.useMemo(
    () => seedApprovals().filter((request) => request.kind === "LEAVE").slice(0, 8),
    []
  )
  const [month] = React.useState(() => new Date(2026, 7, 3))
  const [myRequests, setMyRequests] = React.useState<MyRequest[]>([])

  return (
    <Page>
      <PageHeader
        title="Leave"
        description="Balances are a projection of the ledger — every number here is explainable to a row."
        actions={
          <ApplyLeaveSheet
            balances={balances}
            onSubmit={(request) => setMyRequests((prev) => [request, ...prev])}
          />
        }
      />
      <PageBodyFixed>
        <Tabs defaultValue="balances" className="flex min-h-0 flex-1 flex-col gap-4">
          <TabsList className="scroll-x-only w-fit max-w-full shrink-0 justify-start">
            <TabsTrigger value="balances">Balances</TabsTrigger>
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="calendar">Team calendar</TabsTrigger>
          </TabsList>

          <TabsContent value="balances" className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-4">
              {/*
                Wallet layout, third iteration on this surface: one list where
                the eye scans down a single column of numbers, plus a donut of
                where the year's leave actually went. No repeated card chrome,
                no advice badges.
              */}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                <Card className="gap-0 py-0">
                  <CardHeader className="py-4">
                    <CardTitle className="text-base">Leave wallet</CardTitle>
                    <CardDescription>Balance against this year&rsquo;s entitlement</CardDescription>
                  </CardHeader>
                  <div className="divide-y border-t">
                    {balances.map((balance) => {
                      const isQuota = balance.entitled > 0
                      const pct = isQuota
                        ? Math.round((balance.availed / balance.entitled) * 100)
                        : 0
                      return (
                        <div key={balance.code} className="flex items-center gap-4 px-4 py-3">
                          <Badge
                            variant={balance.isPaid ? "outline" : "destructive"}
                            className="w-12 justify-center font-mono"
                          >
                            {balance.code}
                          </Badge>
                          <div className="w-40 min-w-0 shrink-0">
                            <p className="truncate text-sm font-medium">{balance.name}</p>
                            <p className="text-muted-foreground text-xs">
                              {isQuota
                                ? `${balance.availed} of ${balance.entitled} used`
                                : "No quota — deducts from salary"}
                            </p>
                          </div>
                          <div className="hidden min-w-0 flex-1 sm:block">
                            {isQuota ? <Progress value={pct} /> : null}
                          </div>
                          <div className="ml-auto text-right">
                            <p
                              className={
                                isQuota
                                  ? "text-xl font-semibold tabular-nums"
                                  : "text-destructive text-xl font-semibold tabular-nums"
                              }
                            >
                              {isQuota ? balance.balance : balance.availed}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {isQuota ? "left" : "days taken"}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Year so far</CardTitle>
                    <CardDescription>Leave availed, by type</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer config={availedConfig} className="mx-auto h-44 w-full">
                      <PieChart>
                        <ChartTooltip
                          content={<ChartTooltipContent nameKey="name" hideLabel />}
                        />
                        <Pie isAnimationActive={false}
                          data={availedSplit}
                          dataKey="availed"
                          nameKey="name"
                          innerRadius={42}
                          strokeWidth={4}
                        >
                          {availedSplit.map((entry) => (
                            <Cell key={entry.name} fill={entry.fill} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ChartContainer>
                    <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
                      {availedSplit.map((entry) => (
                        <span
                          key={entry.name}
                          className="text-muted-foreground flex items-center gap-1.5 text-xs"
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ background: entry.fill }}
                          />
                          {entry.name} {entry.availed}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {(apiMyRequests ?? myRequests).length > 0 ? (
                <Card className="gap-0 py-0">
                  <CardHeader className="py-4">
                    <CardTitle className="text-base">My requests</CardTitle>
                    <CardDescription>Submitted from this device</CardDescription>
                  </CardHeader>
                  <div className="divide-y border-t">
                    {(apiMyRequests ?? myRequests).map((request) => (
                      <div key={request.id} className="flex items-center gap-3 px-4 py-2.5">
                        <Badge variant="outline">{request.type}</Badge>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {request.from}
                            {request.to !== request.from ? ` → ${request.to}` : ""} · {request.units}{" "}
                            day(s)
                            {request.part !== "FULL" ? " · half day" : ""}
                          </p>
                          <p className="text-muted-foreground truncate text-xs">{request.reason}</p>
                        </div>
                        <Badge
                          variant={
                            request.status === "APPROVED"
                              ? "success"
                              : request.status === "REJECTED"
                                ? "destructive"
                                : "warning"
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="ledger" className="flex min-h-0 flex-1 flex-col">
            <DataTable
              columns={ledgerColumns}
              data={ledger}
              searchColumn="remarks"
              searchPlaceholder="Search remarks…"
              emptyTitle="No ledger entries"
              emptyDescription="Nothing has been credited or debited in this period."
            />
          </TabsContent>

          <TabsContent
            value="calendar"
            className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[auto_minmax(0,1fr)]"
          >
            <Card className="h-fit w-fit">
              <CardHeader>
                <CardTitle>August 2026</CardTitle>
                <CardDescription>Team leave overlap</CardDescription>
              </CardHeader>
              <CardContent>
                <Calendar mode="single" defaultMonth={month} className="p-0" />
              </CardContent>
            </Card>

            {/* The list owns its own scroll so the card stops growing with the data. */}
            <Card className="flex min-h-0 flex-col gap-0 py-0">
              <CardHeader className="py-4">
                <CardTitle>Who is away</CardTitle>
                <CardDescription>
                  A configurable cap limits how many of one team can be off the same day.
                </CardDescription>
              </CardHeader>
              <div className="min-h-0 flex-1 divide-y overflow-y-auto border-t">
                {teamLeave.map((request) => (
                  <div
                    key={request.id}
                    className="hover:bg-muted/40 flex items-center gap-3 px-4 py-2.5 transition-colors"
                  >
                    <Avatar className="size-8 shrink-0">
                      <AvatarFallback className="text-xs">{request.initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{request.employeeName}</p>
                      <p className="text-muted-foreground truncate text-sm">
                        {request.subject}
                        <span className="mx-1.5 opacity-50">·</span>
                        {request.dateFrom}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {request.units.replace(" day(s)", "d")}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBodyFixed>
    </Page>
  )
}
