import { toast } from "sonner"
import { Lock, LockOpen, Play } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { formatPaise } from "@attendance/shared"

import { ApiError } from "@/lib/api"
import { usePayroll, usePayrollActions } from "@/lib/queries"
import { PAYROLL_RUNS, type PayrollRun } from "@/lib/seed"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const statusTone: Record<PayrollRun["status"], "default" | "secondary" | "outline"> = {
  RELEASED: "default",
  APPROVED: "secondary",
  CALCULATED: "secondary",
  DRAFT: "outline",
}

const columns: ColumnDef<PayrollRun>[] = [
  {
    accessorKey: "period",
    header: "Period",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.period}</span>
        <span className="text-muted-foreground text-xs">
          {row.original.runType} · v{row.original.version}
        </span>
      </div>
    ),
  },
  { accessorKey: "branch", header: "Branch" },
  {
    accessorKey: "attendanceLocked",
    header: "Attendance",
    cell: ({ row }) =>
      row.original.attendanceLocked ? (
        <Badge variant="secondary" className="gap-1">
          <Lock className="size-3" />
          Locked
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1">
          <LockOpen className="size-3" />
          Open
        </Badge>
      ),
  },
  {
    accessorKey: "employees",
    header: "Employees",
    cell: ({ row }) => <span className="tabular-nums">{row.original.employees}</span>,
  },
  {
    accessorKey: "grossPaise",
    header: "Gross",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.grossPaise ? formatPaise(row.original.grossPaise) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "deductionsPaise",
    header: "Deductions",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.deductionsPaise ? formatPaise(row.original.deductionsPaise) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "netPaise",
    header: "Net payable",
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.netPaise ? formatPaise(row.original.netPaise) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={statusTone[row.original.status]}>{row.original.status}</Badge>
    ),
  },
]

export function PayrollPage() {
  const { data, source } = usePayroll()
  const { lockMonth, runPayroll } = usePayrollActions()
  const currentMonth = new Date().toISOString().slice(0, 7)
  const isLocked = data?.locks.some((lock) => lock.month === currentMonth) ?? false

  // API runs map into the same table rows the seed used, so the table below
  // is one component for both worlds.
  const rows: PayrollRun[] = data
    ? data.runs.map((run) => ({
        id: run.id,
        period: run.month,
        branch: "All branches",
        runType: run.version > 1 ? "ADJUSTMENT" : "REGULAR",
        status: run.status,
        employees: run.items.length,
        grossPaise: run.totalGrossPaise,
        deductionsPaise: 0,
        netPaise: run.totalGrossPaise,
        attendanceLocked: true,
        version: run.version,
      }))
    : PAYROLL_RUNS

  const lock = () =>
    lockMonth.mutate(currentMonth, {
      onSuccess: () =>
        toast.success(`${currentMonth} locked`, {
          description: "Attendance for the month is now frozen — payroll may run.",
        }),
      onError: (error) =>
        toast.error(
          error instanceof ApiError && error.status === 409
            ? "Month is already locked"
            : "Lock failed — payroll.manage at write scope required"
        ),
    })

  const run = () =>
    runPayroll.mutate(currentMonth, {
      onSuccess: ({ run: created }) =>
        toast.success(`Payroll run v${created.version} released`, {
          description: `${created.items.length} employees · ${formatPaise(created.totalGrossPaise)} gross · immutable — corrections are a new version.`,
        }),
      onError: (error) =>
        toast.error(
          error instanceof ApiError &&
            (error.body as { error?: string })?.error === "MONTH_NOT_LOCKED"
            ? "Lock the month first — payroll never reads unlocked attendance"
            : "Run failed"
        ),
    })

  const open = source === "api" ? (isLocked ? undefined : { period: currentMonth }) : PAYROLL_RUNS.find((r) => !r.attendanceLocked)

  return (
    <Page>
      <PageHeader
        title="Payroll"
        description="Payroll consumes a locked attendance month. Corrections are new adjustment runs, never edits."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={source === "api" && isLocked}
              onClick={source === "api" ? lock : () => toast("Demo — sign in with the API for real locks")}
            >
              <Lock />
              {source === "api" && isLocked ? `${currentMonth} locked` : "Lock month"}
            </Button>
            <Button
              size="sm"
              disabled={source === "api" ? !isLocked || runPayroll.isPending : !!open}
              onClick={source === "api" ? run : () => toast.success("Payroll run started (demo)")}
            >
              <Play />
              Run payroll
            </Button>
          </>
        }
      />
      <PageBodyFixed>
        {open ? (
          <Alert>
            <LockOpen />
            <AlertTitle>{open.period} attendance is still open</AlertTitle>
            <AlertDescription>
              Payroll cannot run against unlocked attendance. HR reviews the exception queue, locks
              the month, then the run becomes available. The lock is a foreign key on the run, so
              this is enforced by the schema and not just this button.
            </AlertDescription>
          </Alert>
        ) : null}

        <DataTable
          columns={columns}
          data={rows}
          searchColumn="period"
          searchPlaceholder="Search period…"
          emptyTitle="No payroll runs"
          emptyDescription="Lock an attendance month to enable the first run."
        />
      </PageBodyFixed>
    </Page>
  )
}
