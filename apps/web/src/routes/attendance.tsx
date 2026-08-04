import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { ArrowUpDown, CalendarIcon, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { punchFlagTone, type AttendanceDay } from "@attendance/shared"

import { useAppConfig } from "@/lib/app-config"
import { exportDailyRegisterExcel } from "@/lib/attendance-export"
import { useAttendanceDays } from "@/lib/queries"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { StatusBadge, StatusLegend } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const formatDuration = (minutes: number) =>
  minutes === 0 ? "—" : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`

const makeColumns = (lateGraceMinutes: number): ColumnDef<AttendanceDay>[] => [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "employeeName",
    meta: { label: "Employee" },
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Employee
        <ArrowUpDown />
      </Button>
    ),
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        {row.original.selfieThumb ? (
          // The stamped capture is the §3 human proof — hover for the full view.
          <HoverCard openDelay={150}>
            <HoverCardTrigger asChild>
              <img
                src={row.original.selfieThumb}
                alt=""
                className="size-8 shrink-0 rounded-md border object-cover"
              />
            </HoverCardTrigger>
            <HoverCardContent className="w-auto p-1.5">
              <img
                src={row.original.selfieView ?? row.original.selfieThumb}
                alt={`Punch selfie — ${row.original.employeeName}`}
                className="max-h-72 rounded-sm"
              />
              {row.original.syncDeltaSec ? (
                <p className="text-muted-foreground mt-1 px-1 text-xs">
                  Synced {Math.round(row.original.syncDeltaSec / 60)} min after capture
                </p>
              ) : null}
            </HoverCardContent>
          </HoverCard>
        ) : null}
        <div className="flex flex-col">
          <span className="font-medium">{row.original.employeeName}</span>
          <span className="text-muted-foreground text-xs">{row.original.employeeCode}</span>
        </div>
      </div>
    ),
  },
  { accessorKey: "department",
    meta: { label: "Department" }, header: "Department" },
  {
    accessorKey: "shiftName",
    meta: { label: "Shift" },
    header: "Shift",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">{row.original.shiftName ?? "—"}</span>
    ),
  },
  {
    accessorKey: "status",
    meta: { label: "Status" },
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "firstInAt",
    meta: { label: "In time" },
    header: "In",
    // Early green, on time blue, late red — the time itself carries the verdict.
    cell: ({ row }) => {
      const { firstInAt, lateMinutes, status } = row.original
      if (!firstInAt) return <span className="text-muted-foreground">—</span>
      const tone =
        lateMinutes > lateGraceMinutes
          ? "text-status-absent"
          : lateMinutes > 0
            ? "text-status-wfh"
            : "text-status-present"
      return (
        <span className={`${tone} font-medium tabular-nums`} title={status}>
          {firstInAt}
        </span>
      )
    },
  },
  {
    accessorKey: "lastOutAt",
    meta: { label: "Out time" },
    header: "Out",
    cell: ({ row }) =>
      row.original.lastOutAt ? (
        <span className="tabular-nums">{row.original.lastOutAt}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "workedMinutes",
    meta: { label: "Worked" },
    header: "Worked",
    cell: ({ row }) => formatDuration(row.original.workedMinutes),
  },
  {
    accessorKey: "lateMinutes",
    meta: { label: "Late by" },
    header: "Late",
    cell: ({ row }) =>
      row.original.lateMinutes > 0 ? (
        <span className="text-destructive">{row.original.lateMinutes}m</span>
      ) : (
        "—"
      ),
  },
  {
    id: "flags",
    meta: { label: "Flags" },
    header: "Flags",
    cell: ({ row }) => {
      const flags = row.original.flags.filter((flag) => flag !== "ON_TIME")
      if (flags.length === 0) return <span className="text-muted-foreground">—</span>
      return (
        <div className="flex flex-wrap gap-1">
          {flags.map((flag) => (
            <Badge key={flag} variant={punchFlagTone(flag)}>
              {flag.replaceAll("_", " ")}
            </Badge>
          ))}
        </div>
      )
    },
  },
  {
    accessorKey: "payableUnits",
    meta: { label: "Payable" },
    header: "Payable",
    cell: ({ row }) => row.original.payableUnits.toFixed(1),
  },
]

export function AttendancePage() {
  const { settings } = useAppConfig()
  const columns = React.useMemo(
    () => makeColumns(settings.lateGraceMinutes),
    [settings.lateGraceMinutes]
  )
  // API mode defaults to the real today so a punch shows up immediately;
  // demo mode keeps the seeded reference day.
  const [date, setDate] = React.useState<Date>(() => new Date())
  const dateISO = format(date, "yyyy-MM-dd")
  const { rows, source, isLoading } = useAttendanceDays(dateISO)
  const data = rows
  const dateLabel = source === "api" ? dateISO : "2026-08-03"
  const [branch, setBranch] = React.useState("all")
  const [datePickerOpen, setDatePickerOpen] = React.useState(false)

  return (
    <Page>
      <PageHeader
        title="Daily Register"
        description={
          source === "api"
            ? `${format(date, "EEEE, d MMMM yyyy")} · computed live by the attendance engine`
            : "Monday, 3 August 2026 · seeded demo data — sign in with the API running for live days"
        }
        actions={
          <>
            {source === "api" ? (
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <CalendarIcon />
                    {format(date, "d MMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(picked) => {
                      if (picked) setDate(picked)
                      setDatePickerOpen(false)
                    }}
                  />
                </PopoverContent>
              </Popover>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={data.length === 0}
              onClick={() =>
                void exportDailyRegisterExcel(data, dateLabel).then(() =>
                  toast.success("Daily register exported", {
                    description: `${data.length} rows → Delta_DailyRegister_${dateLabel}.xlsx`,
                  })
                )
              }
            >
              <FileSpreadsheet />
              Export .xlsx
            </Button>
          </>
        }
      />
      <PageBodyFixed>
        <StatusLegend className="shrink-0" />
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : null}
        <DataTable
          columns={columns}
          data={data}
          searchColumn="employeeName"
          searchPlaceholder="Search employee…"
          emptyTitle="No attendance for this day"
          emptyDescription="Pick another date, or check that the roster has been published."
          selectionActions={(table) => (
            <Button
              size="sm"
              onClick={() =>
                toast.success(
                  `${table.getFilteredSelectedRowModel().rows.length} day(s) sent for approval`
                )
              }
            >
              Approve selected
            </Button>
          )}
          toolbar={
            <Select value={branch} onValueChange={setBranch}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                <SelectItem value="ho">Mumbai HO</SelectItem>
                <SelectItem value="pune">Pune Plant</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </PageBodyFixed>
    </Page>
  )
}
