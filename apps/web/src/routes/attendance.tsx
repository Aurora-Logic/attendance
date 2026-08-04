import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { punchFlagTone, type AttendanceDay } from "@attendance/shared"

import { useAppConfig } from "@/lib/app-config"
import { exportDailyRegisterExcel } from "@/lib/attendance-export"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { StatusBadge, StatusLegend } from "@/components/status-badge"
import { seedAttendanceDays } from "@/lib/seed"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
      <div className="flex flex-col">
        <span className="font-medium">{row.original.employeeName}</span>
        <span className="text-muted-foreground text-xs">{row.original.employeeCode}</span>
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
  const data = React.useMemo(() => seedAttendanceDays(), [])
  const [branch, setBranch] = React.useState("all")

  return (
    <Page>
      <PageHeader
        title="Daily Register"
        description="Monday, 3 August 2026 · all branches · live counts arrive with the attendance engine in Phase 3"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void exportDailyRegisterExcel(data, "2026-08-03").then(() =>
                toast.success("Daily register exported", {
                  description: `${data.length} rows → Delta_DailyRegister_2026-08-03.xlsx`,
                })
              )
            }
          >
            <FileSpreadsheet />
            Export .xlsx
          </Button>
        }
      />
      <PageBodyFixed>
        <StatusLegend className="shrink-0" />
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
