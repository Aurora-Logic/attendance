import * as React from "react"
import { toast } from "sonner"
import type { ColumnDef } from "@tanstack/react-table"
import { BadgeIndianRupee, Check, Pencil, Plus, X } from "lucide-react"
import {
  EXPENSE_CATEGORIES,
  formatPaise,
  rupeesToPaise,
  type ExpenseClaim,
} from "@attendance/shared"

import { todayISO } from "@/lib/procurement"
import { useExpenses } from "@/lib/expenses"
import { useSession } from "@/lib/session"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
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
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

const STATUS_VARIANT: Record<
  ExpenseClaim["status"],
  "warning" | "success" | "destructive" | "info"
> = {
  PENDING: "warning",
  APPROVED: "info",
  REJECTED: "destructive",
  REIMBURSED: "success",
}

export function ExpensesPage() {
  const { claims, createClaim, updateClaim, decideClaim, reimburseClaim } = useExpenses()
  const { can, user, scopeFor } = useSession()
  const [open, setOpen] = React.useState(false)
  const [category, setCategory] = React.useState<(typeof EXPENSE_CATEGORIES)[number]>("Travel")
  const [amountRupees, setAmountRupees] = React.useState(0)
  const [description, setDescription] = React.useState("")
  const [editingId, setEditingId] = React.useState<string | null>(null)

  const approverScope = scopeFor("expense.approve")
  const isApprover = approverScope !== "NONE"
  // Approvers see everyone's; everyone sees their own.
  const visible = isApprover
    ? claims
    : claims.filter((claim) => claim.employeeEmail === user?.email)

  const columns = React.useMemo<ColumnDef<ExpenseClaim>[]>(
    () => [
      {
        accessorKey: "number",
        header: "Claim",
        cell: ({ row }) => <span className="font-medium">{row.original.number}</span>,
      },
      {
        accessorKey: "employeeName",
        header: "Employee",
        cell: ({ row }) => row.original.employeeName || row.original.employeeEmail,
      },
      { accessorKey: "date", header: "Date" },
      { accessorKey: "category", header: "Category" },
      {
        accessorKey: "amountPaise",
        header: "Amount",
        cell: ({ row }) => (
          <span className="tabular-nums">{formatPaise(row.original.amountPaise)}</span>
        ),
      },
      { accessorKey: "description", header: "Description" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const claim = row.original
          if (claim.status === "PENDING" && claim.employeeEmail === user?.email) {
            return (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${claim.number}`}
                onClick={() => {
                  setEditingId(claim.id)
                  setCategory(claim.category)
                  setAmountRupees(claim.amountPaise / 100)
                  setDescription(claim.description)
                  setOpen(true)
                }}
              >
                <Pencil />
              </Button>
            )
          }
          // Deciding your own claim is never allowed, whatever the scope.
          if (!isApprover || claim.employeeEmail === user?.email) return null
          if (claim.status === "PENDING") {
            return (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Approve claim"
                  onClick={() => {
                    decideClaim(claim.id, "APPROVE", user?.email ?? "")
                    toast.success(`${claim.number} approved`)
                  }}
                >
                  <Check />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Reject claim"
                  onClick={() => {
                    decideClaim(claim.id, "REJECT", user?.email ?? "")
                    toast(`${claim.number} rejected`)
                  }}
                >
                  <X />
                </Button>
              </div>
            )
          }
          if (claim.status === "APPROVED" && can("payroll.manage")) {
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  reimburseClaim(claim.id, todayISO())
                  toast.success(`${claim.number} marked reimbursed`)
                }}
              >
                <BadgeIndianRupee />
                Reimburse
              </Button>
            )
          }
          return null
        },
      },
    ],
    [isApprover, user, can, decideClaim, reimburseClaim]
  )

  return (
    <Page>
      <PageHeader
        title="Expense Claims"
        description="Claim → approve (never your own) → reimburse, with the reason on record."
        actions={
          can("expense.claim") ? (
            <Button
            size="sm"
            onClick={() => {
              setEditingId(null)
              setAmountRupees(0)
              setDescription("")
              setOpen(true)
            }}
          >
              <Plus />
              New claim
            </Button>
          ) : null
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={[...visible].reverse()}
          searchColumn="employeeName"
          searchPlaceholder="Search employee…"
          emptyTitle="No claims yet"
          emptyDescription="File a claim for a work spend and it lands with your approver."
          renderMobileCard={(claim) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{claim.number}</span>
                <Badge variant={STATUS_VARIANT[claim.status]}>{claim.status}</Badge>
              </div>
              <span className="text-muted-foreground text-xs">
                {claim.employeeName || claim.employeeEmail} · {claim.date} · {claim.category}
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs">{claim.description}</span>
                <span className="text-sm font-medium tabular-nums">
                  {formatPaise(claim.amountPaise)}
                </span>
              </div>
            </div>
          )}
        />
      </PageBodyFixed>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editingId ? "Edit claim" : "New expense claim"}</SheetTitle>
            <SheetDescription>Approved claims are reimbursed through payroll.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            <div className="flex flex-col gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="claim-category">Category</FieldLabel>
                  <Select
                    value={category}
                    onValueChange={(value) => setCategory(value as typeof category)}
                  >
                    <SelectTrigger id="claim-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((expenseCategory) => (
                        <SelectItem key={expenseCategory} value={expenseCategory}>
                          {expenseCategory}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="claim-amount">Amount (₹)</FieldLabel>
                  <Input
                    id="claim-amount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={amountRupees}
                    onChange={(event) => setAmountRupees(Number(event.target.value))}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="claim-desc">What was it for?</FieldLabel>
                <Textarea
                  id="claim-desc"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Client visit — auto + train fare"
                  rows={3}
                />
                <FieldDescription>Shown to your approver.</FieldDescription>
              </Field>
            </div>
          </div>
          <SheetFooter>
            <Button
              onClick={() => {
                if (amountRupees <= 0 || description.trim().length < 3) {
                  toast.error("Enter an amount and a short description.")
                  return
                }
                if (editingId) {
                  if (
                    updateClaim(
                      editingId,
                      {
                        category,
                        amountPaise: rupeesToPaise(amountRupees),
                        description: description.trim(),
                      },
                      user?.email ?? ""
                    )
                  ) {
                    toast.success("Claim updated")
                  } else toast.error("Only your own pending claims can be edited.")
                } else {
                  const claim = createClaim(
                    {
                      date: todayISO(),
                      category,
                      amountPaise: rupeesToPaise(amountRupees),
                      description: description.trim(),
                    },
                    { email: user?.email ?? "", name: user?.name ?? "" }
                  )
                  toast.success(`${claim.number} filed`)
                }
                setOpen(false)
                setEditingId(null)
                setAmountRupees(0)
                setDescription("")
              }}
            >
              {editingId ? "Save changes" : "File claim"}
            </Button>
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Page>
  )
}
