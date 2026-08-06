import * as React from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowRightCircle, Check, Plus, Trash2, X } from "lucide-react"
import type { Indent } from "@attendance/shared"

import { todayISO, useProcurement } from "@/lib/procurement"
import { useSession } from "@/lib/session"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
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

const STATUS_VARIANT: Record<Indent["status"], "warning" | "success" | "destructive" | "info"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
  ORDERED: "info",
}

export function IndentsPage() {
  const { items, indents, createIndent, decideIndent } = useProcurement()
  const { can, user } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [department, setDepartment] = React.useState("")
  const [lines, setLines] = React.useState<Array<{ itemId: string; qty: number }>>([
    { itemId: "", qty: 1 },
  ])

  const itemName = (itemId: string) => items.find((item) => item.id === itemId)?.name ?? "—"
  const canManage = can("procurement.manage")

  const columns = React.useMemo<ColumnDef<Indent>[]>(
    () => [
      {
        accessorKey: "number",
        header: "Indent",
        cell: ({ row }) => <span className="font-medium">{row.original.number}</span>,
      },
      { accessorKey: "department", header: "Department" },
      { accessorKey: "date", header: "Date" },
      {
        id: "lines",
        header: "Items",
        cell: ({ row }) =>
          row.original.lines.map((line) => `${itemName(line.itemId)} ×${line.qty}`).join(", "),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>
            {row.original.status === "ORDERED" && row.original.poId ? (
              <Link to={`/purchase-orders/${row.original.poId}`} className="text-xs underline">
                PO
              </Link>
            ) : null}
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const indent = row.original
          if (!canManage) return null
          if (indent.status === "PENDING") {
            return (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Approve indent"
                  onClick={() => {
                    decideIndent(indent.id, "APPROVE")
                    toast.success(`${indent.number} approved`)
                  }}
                >
                  <Check />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Reject indent"
                  onClick={() => {
                    decideIndent(indent.id, "REJECT")
                    toast(`${indent.number} rejected`)
                  }}
                >
                  <X />
                </Button>
              </div>
            )
          }
          if (indent.status === "APPROVED") {
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  // The PO builder prefills from this indent and marks it
                  // ORDERED on save — request to order with nothing retyped.
                  navigate("/purchase-orders/new", {
                    state: { indentId: indent.id, lines: indent.lines },
                  })
                }
              >
                <ArrowRightCircle />
                Create PO
              </Button>
            )
          }
          return null
        },
      },
    ],
    [canManage, decideIndent, navigate, items]
  )

  return (
    <Page>
      <PageHeader
        title="Indents"
        description="Department requisitions — approved indents become POs with nothing retyped."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus />
            New indent
          </Button>
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={[...indents].reverse()}
          searchColumn="department"
          searchPlaceholder="Search department…"
          emptyTitle="No indents yet"
          emptyDescription="Anyone can raise one; procurement approves and orders."
          renderMobileCard={(indent) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{indent.number}</span>
                <Badge variant={STATUS_VARIANT[indent.status]}>{indent.status}</Badge>
              </div>
              <span className="text-muted-foreground text-xs">
                {indent.department} · {indent.date}
              </span>
              <span className="text-xs">
                {indent.lines.map((line) => `${itemName(line.itemId)} ×${line.qty}`).join(", ")}
              </span>
              {canManage && indent.status === "APPROVED" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() =>
                    navigate("/purchase-orders/new", {
                      state: { indentId: indent.id, lines: indent.lines },
                    })
                  }
                >
                  <ArrowRightCircle />
                  Create PO
                </Button>
              ) : null}
            </div>
          )}
        />
      </PageBodyFixed>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>New indent</SheetTitle>
            <SheetDescription>What does your department need bought?</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            <div className="flex flex-col gap-4 py-4">
              <Field>
                <FieldLabel htmlFor="indent-dept">Department</FieldLabel>
                <Input
                  id="indent-dept"
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  placeholder="Production"
                />
              </Field>
              {lines.map((line, index) => (
                <div key={index} className="flex items-end gap-2">
                  <Field className="flex-1">
                    <FieldLabel htmlFor={`indent-item-${index}`}>Item</FieldLabel>
                    <Select
                      value={line.itemId}
                      onValueChange={(itemId) =>
                        setLines((prev) =>
                          prev.map((candidate, candidateIndex) =>
                            candidateIndex === index ? { ...candidate, itemId } : candidate
                          )
                        )
                      }
                    >
                      <SelectTrigger id={`indent-item-${index}`}>
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        {items
                          .filter((item) => item.active)
                          .map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field className="w-24">
                    <FieldLabel htmlFor={`indent-qty-${index}`}>Qty</FieldLabel>
                    <Input
                      id={`indent-qty-${index}`}
                      type="number"
                      min={0}
                      step="any"
                      value={line.qty}
                      onChange={(event) =>
                        setLines((prev) =>
                          prev.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, qty: Number(event.target.value) }
                              : candidate
                          )
                        )
                      }
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() =>
                      setLines((prev) => prev.filter((_candidate, candidateIndex) => candidateIndex !== index))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setLines((prev) => [...prev, { itemId: "", qty: 1 }])}
              >
                <Plus />
                Add line
              </Button>
            </div>
          </div>
          <SheetFooter>
            <Button
              onClick={() => {
                const valid = lines.filter((line) => line.itemId && line.qty > 0)
                if (!department.trim() || valid.length === 0) {
                  toast.error("Department and at least one item are required.")
                  return
                }
                const indent = createIndent({
                  department: department.trim(),
                  requestedBy: user?.email ?? "",
                  date: todayISO(),
                  neededBy: null,
                  note: "",
                  lines: valid.map((line) => ({ ...line, note: "" })),
                })
                toast.success(`${indent.number} raised`)
                setOpen(false)
                setDepartment("")
                setLines([{ itemId: "", qty: 1 }])
              }}
            >
              Raise indent
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
