import * as React from "react"
import { toast } from "sonner"
import { Banknote, FileCode2, Landmark, Lock, LockOpen, Play, Printer } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { formatPaise } from "@attendance/shared"

import { API_BASE, ApiError } from "@/lib/api"
import {
  usePayroll,
  usePayrollActions,
  useSalaries,
  useSaveBankDetails,
  type PayrollRunView,
} from "@/lib/queries"
import { PAYROLL_RUNS, type PayrollRun } from "@/lib/seed"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { PayslipSheet, type PayslipData } from "@/components/payslip-sheet"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const statusTone: Record<PayrollRun["status"], "default" | "secondary" | "outline"> = {
  RELEASED: "default",
  APPROVED: "secondary",
  CALCULATED: "secondary",
  DRAFT: "outline",
}

const buildColumns = (
  isApi: boolean,
  onPayslips: (runId: string) => void
): ColumnDef<PayrollRun>[] => [
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
  {
    id: "documents",
    header: "Documents",
    meta: { label: "Documents" },
    cell: ({ row }) =>
      isApi ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => onPayslips(row.original.id)}>
            <Printer />
            Payslips
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(
                `${API_BASE}/payroll/runs/${row.original.id}/bank-transfer.csv`,
                "_blank"
              )
            }
          >
            <Banknote />
            Bank sheet
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(`${API_BASE}/payroll/runs/${row.original.id}/tally.xml`, "_blank")
            }
          >
            <FileCode2 />
            Tally
          </Button>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="sm" disabled>
                <FileCode2 />
                Documents
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Sign in with the API — payslips, the bank sheet and the Tally voucher are built from a
            released run.
          </TooltipContent>
        </Tooltip>
      ),
  },
]

/**
 * Payslips for a released run. The sheet carries the app's print-isolation
 * class, so Print here is Print → Save as PDF on every platform — the document
 * on screen is byte-for-byte the document that prints.
 */
function PayslipDialog({
  run,
  open,
  onOpenChange,
}: {
  run: PayrollRunView | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { salaries } = useSalaries()
  const [selected, setSelected] = React.useState(0)
  React.useEffect(() => setSelected(0), [run?.id])
  if (!run || run.items.length === 0) return null

  const item = run.items[Math.min(selected, run.items.length - 1)]
  const salary = salaries.find((row) => row.employeeId === item.employeeId)
  const data: PayslipData = {
    month: run.month,
    employeeName: item.name,
    employeeCode: item.code,
    department: "—",
    payableDays: item.payableDays,
    perDayPaise: item.perDayPaise,
    earnedPaise: item.earnedPaise,
    otMinutes: item.otMinutes,
    otPaise: item.otPaise,
    grossPaise: item.grossPaise,
    bankTail: salary?.bank?.accountNumber ?? null,
    pan: salary?.bank?.pan,
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Payslips · {run.month}</DialogTitle>
          <DialogDescription>
            {run.items.length} employees in version {run.version}. Print saves a PDF.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="max-h-40 shrink-0 overflow-y-auto border-b md:max-h-none md:w-56 md:border-r md:border-b-0">
            {run.items.map((candidate, index) => (
              <button
                key={candidate.employeeId}
                type="button"
                onClick={() => setSelected(index)}
                className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm transition-colors ${
                  index === selected ? "bg-muted font-medium" : "hover:bg-muted/60"
                }`}
              >
                <span className="truncate">{candidate.name}</span>
                <span className="text-muted-foreground text-xs">
                  {candidate.code} · {formatPaise(candidate.grossPaise)}
                </span>
              </button>
            ))}
          </div>
          <div className="bg-muted/40 min-h-0 flex-1 overflow-y-auto p-4">
            <PayslipSheet data={data} />
          </div>
        </div>
        <DialogFooter className="border-t p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <Printer />
            Print / Save as PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const EMPTY_BANK = {
  accountName: "",
  accountNumber: "",
  ifsc: "",
  bankName: "",
  pan: "",
  uan: "",
}

/** Bank details per employee — what the transfer sheet needs to pay them. */
function BankDetailsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { salaries } = useSalaries()
  const save = useSaveBankDetails()
  const [editing, setEditing] = React.useState<string | null>(null)
  const [form, setForm] = React.useState(EMPTY_BANK)

  const startEdit = (employeeId: string) => {
    // Masked account numbers must never be saved back as if they were real.
    setForm(EMPTY_BANK)
    setEditing(employeeId)
  }

  const submit = () => {
    if (!editing) return
    save.mutate(
      { employeeId: editing, ...form },
      {
        onSuccess: () => {
          toast.success("Bank details saved")
          setEditing(null)
        },
        onError: (error) =>
          toast.error("Could not save", {
            description:
              error instanceof ApiError && error.status === 400
                ? "Check the IFSC (e.g. HDFC0001234) and the account number."
                : "payroll.manage at write scope is required.",
          }),
      }
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Bank details</SheetTitle>
          <SheetDescription>
            Needed to include someone in the transfer sheet. Stored account numbers are shown
            masked and are never sent back to the browser in full.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {salaries.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              Sign in with the API to manage bank details.
            </p>
          ) : null}
          {salaries.map((salary, index) => (
            <React.Fragment key={salary.employeeId}>
              {index > 0 ? <Separator /> : null}
              {editing === salary.employeeId ? (
                <div className="py-3">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="bank-name-field">Account holder</FieldLabel>
                      <Input
                        id="bank-name-field"
                        value={form.accountName}
                        onChange={(event) =>
                          setForm({ ...form, accountName: event.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="bank-account">Account number</FieldLabel>
                      <Input
                        id="bank-account"
                        inputMode="numeric"
                        value={form.accountNumber}
                        onChange={(event) =>
                          setForm({ ...form, accountNumber: event.target.value.trim() })
                        }
                      />
                      <FieldDescription>Digits only, 6–20.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="bank-ifsc">IFSC</FieldLabel>
                      <Input
                        id="bank-ifsc"
                        value={form.ifsc}
                        onChange={(event) =>
                          setForm({ ...form, ifsc: event.target.value.toUpperCase().trim() })
                        }
                      />
                      <FieldDescription>Eleven characters, e.g. HDFC0001234.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="bank-bank">Bank</FieldLabel>
                      <Input
                        id="bank-bank"
                        value={form.bankName}
                        onChange={(event) => setForm({ ...form, bankName: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="bank-pan">PAN</FieldLabel>
                      <Input
                        id="bank-pan"
                        value={form.pan}
                        onChange={(event) =>
                          setForm({ ...form, pan: event.target.value.toUpperCase().trim() })
                        }
                      />
                      <FieldDescription>Optional. Format ABCDE1234F.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="bank-uan">UAN</FieldLabel>
                      <Input
                        id="bank-uan"
                        inputMode="numeric"
                        value={form.uan}
                        onChange={(event) => setForm({ ...form, uan: event.target.value.trim() })}
                      />
                      <FieldDescription>Optional. Twelve digits.</FieldDescription>
                    </Field>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button className="flex-1" onClick={submit} disabled={save.isPending}>
                        Save
                      </Button>
                    </div>
                  </FieldGroup>
                </div>
              ) : (
                <Item size="sm">
                  <ItemContent>
                    <ItemTitle>{salary.bank?.accountName ?? salary.employeeId}</ItemTitle>
                    <ItemDescription>
                      {salary.bank
                        ? `${salary.bank.bankName || "Bank"} · ${salary.bank.accountNumber} · ${salary.bank.ifsc}`
                        : "No bank details — will be held back from the transfer sheet"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startEdit(salary.employeeId)}
                    >
                      {salary.bank ? "Replace" : "Add"}
                    </Button>
                  </ItemActions>
                </Item>
              )}
            </React.Fragment>
          ))}
        </div>
        <SheetFooter className="border-t">
          <SheetClose asChild>
            <Button variant="outline" className="w-full">
              Done
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function PayrollPage() {
  const { data, source } = usePayroll()
  const { lockMonth, runPayroll } = usePayrollActions()
  const [payslipRunId, setPayslipRunId] = React.useState<string | null>(null)
  const [bankOpen, setBankOpen] = React.useState(false)
  const payslipRun = data?.runs.find((run) => run.id === payslipRunId) ?? null
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
              disabled={source !== "api"}
              onClick={() => setBankOpen(true)}
            >
              <Landmark />
              Bank details
            </Button>
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
          columns={buildColumns(source === "api", setPayslipRunId)}
          data={rows}
          searchColumn="period"
          searchPlaceholder="Search period…"
          emptyTitle="No payroll runs"
          emptyDescription="Lock an attendance month to enable the first run."
        />
        <PayslipDialog
          run={payslipRun}
          open={payslipRun !== null}
          onOpenChange={(next) => !next && setPayslipRunId(null)}
        />
        <BankDetailsSheet open={bankOpen} onOpenChange={setBankOpen} />
      </PageBodyFixed>
    </Page>
  )
}
