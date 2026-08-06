import * as React from "react"
import { toast } from "sonner"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, Ban, Pencil, Plus } from "lucide-react"
import {
  formatPaise,
  outstandingPaise,
  paiseToRupees,
  poTotals,
  rupeesToPaise,
  shiftDateISO,
  threeWayMatch,
  type PoLine,
  type VendorBill,
} from "@attendance/shared"

import { todayISO, useProcurement } from "@/lib/procurement"
import { useSession } from "@/lib/session"
import { DataTable } from "@/components/data-table"
import { Page, PageBodyFixed, PageHeader } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface BillRow {
  bill: VendorBill
  vendorName: string
  totalPaise: number
  outstanding: number
  flags: number
}

export function VendorBillsPage() {
  const { vendors, items, pos, grns, vendorBills, payments, recordBill, cancelBill, updateBillMeta } =
    useProcurement()
  const { can, user } = useSession()
  const [open, setOpen] = React.useState(false)

  // Record-bill dialog state: pick an approved PO, lines prefill from it.
  const [poId, setPoId] = React.useState("")
  const [billNo, setBillNo] = React.useState("")
  const [billDate, setBillDate] = React.useState(todayISO())
  const [rates, setRates] = React.useState<Record<string, number>>({})
  const [editing, setEditing] = React.useState<VendorBill | null>(null)
  const [editNo, setEditNo] = React.useState("")
  const [editDate, setEditDate] = React.useState("")
  const [editDue, setEditDue] = React.useState("")
  const [quantities, setQuantities] = React.useState<Record<string, number>>({})

  const billablePos = pos.filter((po) => po.status === "APPROVED" || po.status === "CLOSED")
  const selectedPo = pos.find((po) => po.id === poId)

  React.useEffect(() => {
    if (selectedPo) {
      setRates(
        Object.fromEntries(
          selectedPo.lines.map((line) => [line.id, paiseToRupees(line.unitPricePaise)])
        )
      )
      setQuantities(Object.fromEntries(selectedPo.lines.map((line) => [line.id, line.qty])))
    }
  }, [selectedPo])

  const rows = React.useMemo<BillRow[]>(
    () =>
      vendorBills
        .map((bill) => {
          const po = bill.poId ? pos.find((candidate) => candidate.id === bill.poId) : undefined
          const match = po ? threeWayMatch(bill, po, grns) : []
          return {
            bill,
            vendorName: vendors.find((vendor) => vendor.id === bill.vendorId)?.name ?? "—",
            totalPaise: poTotals(bill.lines).totalPaise,
            outstanding: outstandingPaise(bill, payments),
            flags: match.filter((line) => line.overBilledQty > 0 || line.rateDeltaPaise > 0).length,
          }
        })
        .reverse(),
    [vendorBills, vendors, pos, grns, payments]
  )

  const columns = React.useMemo<ColumnDef<BillRow>[]>(
    () => [
      {
        id: "billNo",
        accessorFn: (row) => row.bill.billNo,
        header: "Bill no.",
        cell: ({ row }) => <span className="font-medium">{row.original.bill.billNo}</span>,
      },
      { id: "vendorName", accessorFn: (row) => row.vendorName, header: "Vendor" },
      { id: "date", accessorFn: (row) => row.bill.date, header: "Date" },
      { id: "dueDate", accessorFn: (row) => row.bill.dueDate, header: "Due" },
      {
        id: "total",
        accessorFn: (row) => row.totalPaise,
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Total
            <ArrowUpDown />
          </Button>
        ),
        meta: { label: "Total" },
        cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.totalPaise)}</span>,
      },
      {
        id: "outstanding",
        accessorFn: (row) => row.outstanding,
        header: "Outstanding",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.outstanding ? formatPaise(row.original.outstanding) : "—"}
          </span>
        ),
      },
      {
        id: "cancel",
        header: "",
        cell: ({ row }) =>
          row.original.bill.status === "OPEN" &&
          row.original.outstanding === row.original.totalPaise &&
          can("procurement.manage") ? (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit bill ${row.original.bill.billNo}`}
                onClick={() => {
                  setEditing(row.original.bill)
                  setEditNo(row.original.bill.billNo)
                  setEditDate(row.original.bill.date)
                  setEditDue(row.original.bill.dueDate)
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Cancel bill ${row.original.bill.billNo}`}
                onClick={() => {
                  if (cancelBill(row.original.bill.id)) toast(`Bill ${row.original.bill.billNo} cancelled`)
                  else toast.error("Payments are allocated — cannot cancel.")
                }}
              >
                <Ban />
              </Button>
            </div>
          ) : row.original.bill.status === "CANCELLED" ? (
            <Badge variant="secondary">Cancelled</Badge>
          ) : null,
      },
      {
        id: "match",
        header: "3-way match",
        meta: { label: "Three-way match" },
        cell: ({ row }) =>
          !row.original.bill.poId ? (
            <Badge variant="outline">No PO</Badge>
          ) : row.original.flags > 0 ? (
            <Badge variant="warning">
              {row.original.flags} flag{row.original.flags === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge variant="success">Clean</Badge>
          ),
      },
    ],
    [can, cancelBill]
  )

  const editDialog = (
    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit bill {editing?.billNo}</DialogTitle>
          <DialogDescription>
            Number and dates only — for wrong quantities or rates, cancel and re-record so the
            3-way match stays honest.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="edit-bill-no">Vendor's bill no.</FieldLabel>
            <Input id="edit-bill-no" value={editNo} onChange={(event) => setEditNo(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="edit-bill-date">Bill date</FieldLabel>
              <Input id="edit-bill-date" type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-bill-due">Due date</FieldLabel>
              <Input id="edit-bill-due" type="date" value={editDue} onChange={(event) => setEditDue(event.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => {
              if (editing && updateBillMeta(editing.id, { billNo: editNo.trim(), date: editDate, dueDate: editDue })) {
                toast.success("Bill updated")
                setEditing(null)
              } else toast.error("Payments are allocated — the bill is frozen.")
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  const record = () => {
    if (!selectedPo || !billNo.trim()) {
      toast.error("Pick a PO and enter the vendor's bill number.")
      return
    }
    const lines: PoLine[] = selectedPo.lines
      .filter((line) => (quantities[line.id] ?? 0) > 0)
      .map((line, index) => ({
        id: `bill_l${index}`,
        itemId: line.itemId,
        qty: quantities[line.id] ?? 0,
        unitPricePaise: rupeesToPaise(rates[line.id] ?? 0),
        gstRatePct: line.gstRatePct,
        discountPct: line.discountPct,
      }))
    if (lines.length === 0) {
      toast.error("At least one line must have a billed quantity.")
      return
    }
    const bill = recordBill(
      {
        billNo: billNo.trim(),
        vendorId: selectedPo.vendorId,
        poId: selectedPo.id,
        date: billDate,
        dueDate: shiftDateISO(
          billDate,
          vendors.find((vendor) => vendor.id === selectedPo.vendorId)?.paymentTermsDays ?? 30
        ),
        lines,
        remarks: "",
      },
      user?.email ?? ""
    )
    const match = threeWayMatch(bill, selectedPo, grns)
    const flagged = match.filter((line) => line.overBilledQty > 0 || line.rateDeltaPaise > 0)
    toast.success(`Bill ${bill.billNo} recorded`)
    if (flagged.length > 0) {
      // Flagged, never blocked — the bill is a fact; paying it is a judgement.
      toast.warning(
        `3-way match flagged ${flagged.length} line${flagged.length === 1 ? "" : "s"} — check before paying.`
      )
    }
    setOpen(false)
    setPoId("")
    setBillNo("")
  }

  return (
    <Page>
      <PageHeader
        title="Vendor Bills"
        description="Bills checked against what was ordered (PO) and what actually arrived (GRN)."
        actions={
          can("procurement.manage") ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus />
              Record bill
            </Button>
          ) : null
        }
      />
      <PageBodyFixed>
        <DataTable
          columns={columns}
          data={rows}
          searchColumn="vendorName"
          searchPlaceholder="Search vendor…"
          emptyTitle="No bills yet"
          emptyDescription="Record a vendor's bill against its PO to start the payable clock."
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.bill.billNo}</span>
                {row.flags > 0 ? (
                  <Badge variant="warning">{row.flags} flags</Badge>
                ) : row.bill.poId ? (
                  <Badge variant="success">Clean</Badge>
                ) : (
                  <Badge variant="outline">No PO</Badge>
                )}
              </div>
              <span className="text-muted-foreground text-xs">
                {row.vendorName} · due {row.bill.dueDate}
              </span>
              <span className="text-sm font-medium tabular-nums">
                {row.outstanding ? `${formatPaise(row.outstanding)} due` : formatPaise(row.totalPaise)}
              </span>
            </div>
          )}
        />
      </PageBodyFixed>

      {editDialog}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record vendor bill</DialogTitle>
            <DialogDescription>
              Lines prefill from the PO; change qty/rate to what the bill actually says — the
              3-way match flags any gap against order and receipt.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="bill-po">Against PO</FieldLabel>
                <Select value={poId} onValueChange={setPoId}>
                  <SelectTrigger id="bill-po">
                    <SelectValue placeholder="Select PO" />
                  </SelectTrigger>
                  <SelectContent>
                    {billablePos.map((po) => (
                      <SelectItem key={po.id} value={po.id}>
                        {po.number} · {vendors.find((vendor) => vendor.id === po.vendorId)?.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="bill-no">Vendor's bill no.</FieldLabel>
                <Input
                  id="bill-no"
                  value={billNo}
                  onChange={(event) => setBillNo(event.target.value)}
                  placeholder="SST/1234"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="bill-date">Bill date</FieldLabel>
              <Input
                id="bill-date"
                type="date"
                value={billDate}
                onChange={(event) => setBillDate(event.target.value)}
              />
              <FieldDescription>Due date follows the vendor's payment terms.</FieldDescription>
            </Field>
            {selectedPo ? (
              <div className="flex flex-col gap-2">
                {selectedPo.lines.map((line) => (
                  <div key={line.id} className="grid grid-cols-[1fr_5.5rem_6.5rem] items-end gap-2 rounded-md border px-3 py-2">
                    <p className="truncate text-sm font-medium">
                      {items.find((item) => item.id === line.itemId)?.name ?? "—"}
                    </p>
                    <Field>
                      <FieldLabel htmlFor={`bill-qty-${line.id}`}>Qty</FieldLabel>
                      <Input
                        id={`bill-qty-${line.id}`}
                        type="number"
                        min={0}
                        step="any"
                        value={quantities[line.id] ?? 0}
                        onChange={(event) =>
                          setQuantities((prev) => ({ ...prev, [line.id]: Number(event.target.value) }))
                        }
                        className="h-8 text-right"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`bill-rate-${line.id}`}>Rate ₹</FieldLabel>
                      <Input
                        id={`bill-rate-${line.id}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={rates[line.id] ?? 0}
                        onChange={(event) =>
                          setRates((prev) => ({ ...prev, [line.id]: Number(event.target.value) }))
                        }
                        className="h-8 text-right"
                      />
                    </Field>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={record}>Record bill</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
