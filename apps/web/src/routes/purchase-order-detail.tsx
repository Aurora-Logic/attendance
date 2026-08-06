import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { format } from "date-fns"
import { toast } from "sonner"
import {
  Ban,
  CalendarIcon,
  Check,
  FileDown,
  PackageCheck,
  Pencil,
  Printer,
  SendHorizontal,
  X,
} from "lucide-react"
import {
  poDisplayStatus,
  receiptProgress,
  scheduleProgress,
  type GrnLine,
} from "@attendance/shared"

import { todayISO, useProcurement } from "@/lib/procurement"
import { useSession } from "@/lib/session"
import { exportPoExcel } from "@/lib/po-export"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { PO_STATUS_LABEL, PoStatusBadge, ScheduleStatusBadge } from "@/components/po-status-badge"
import { PoDocument, printPoDocument, type DocLine } from "@/components/po-document"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { pos, grns, vendors, items, submitPo, recallPo, decidePo, cancelPo, closePo, recordGrn } =
    useProcurement()
  const { user, can } = useSession()

  const po = pos.find((candidate) => candidate.id === id)
  const [grnOpen, setGrnOpen] = React.useState(false)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")

  if (!po) {
    return (
      <Page>
        <PageHeader title="Purchase order not found" />
      </Page>
    )
  }

  const vendor = vendors.find((candidate) => candidate.id === po.vendorId) ?? null
  const display = poDisplayStatus(po, grns)
  const progress = receiptProgress(po, grns)
  const tranches = scheduleProgress(po, grns, todayISO())
  const poGrns = grns.filter((grn) => grn.poId === po.id)

  const docLines: DocLine[] = po.lines.map((line) => ({
    key: line.id,
    itemId: line.itemId,
    qty: line.qty,
    unitPricePaise: line.unitPricePaise,
    discountPct: line.discountPct,
    schedules: po.schedules
      .filter((schedule) => schedule.poLineId === line.id)
      .map((schedule) => ({ dueDate: schedule.dueDate, qty: schedule.qty })),
  }))

  const itemName = (itemId: string) =>
    items.find((candidate) => candidate.id === itemId)?.name ?? "—"
  const lineItemName = (poLineId: string) => {
    const line = po.lines.find((candidate) => candidate.id === poLineId)
    return line ? itemName(line.itemId) : "—"
  }

  const canManage = can("procurement.manage")
  // Raising and approving the same PO is never one person's job.
  const canDecide = can("po.approve") && po.createdBy !== user?.email

  const actions = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await exportPoExcel(po, vendor, items, poGrns)
          toast.success(`${po.number} exported to Excel`)
        }}
      >
        <FileDown />
        Excel
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          printPoDocument(
            [po.number, vendor?.name, po.orderDate].filter(Boolean).join(" - ")
          )
        }
      >
        <Printer />
        Print / PDF
      </Button>
      {po.status === "DRAFT" && canManage ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/purchase-orders/new", { state: { editPoId: po.id } })}
          >
            <Pencil />
            Edit draft
          </Button>
          <Button size="sm" onClick={() => submitPo(po.id)}>
            <SendHorizontal />
            Submit for approval
          </Button>
        </>
      ) : null}
      {po.status === "PENDING_APPROVAL" && canManage ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (recallPo(po.id)) toast(`${po.number} recalled to draft — edit away`)
          }}
        >
          <Pencil />
          Recall to draft
        </Button>
      ) : null}
      {po.status === "PENDING_APPROVAL" && canDecide ? (
        <>
          <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)}>
            <X />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={() => {
              decidePo(po.id, "APPROVE", user?.email ?? "")
              toast.success(`${po.number} approved`)
            }}
          >
            <Check />
            Approve
          </Button>
        </>
      ) : null}
      {(po.status === "DRAFT" || po.status === "PENDING_APPROVAL") && canManage ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            cancelPo(po.id)
            toast(`${po.number} cancelled`)
          }}
        >
          <Ban />
          Cancel
        </Button>
      ) : null}
      {po.status === "APPROVED" && can("grn.record") && display !== "RECEIVED" ? (
        <Button size="sm" onClick={() => setGrnOpen(true)}>
          <PackageCheck />
          Record receipt
        </Button>
      ) : null}
      {po.status === "APPROVED" && canManage && display !== "RECEIVED" ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            closePo(po.id)
            toast(`${po.number} short-closed`)
          }}
        >
          Close short
        </Button>
      ) : null}
    </>
  )

  return (
    <Page>
      <PageHeader
        title={po.number}
        description={
          po.status === "REJECTED" && po.rejectionReason
            ? `Rejected — ${po.rejectionReason}`
            : `${vendor?.name ?? "—"} · ordered ${po.orderDate}`
        }
        actions={
          <>
            <PoStatusBadge status={display} />
            {actions}
          </>
        }
      />
      <PageBody className="bg-muted/40">
        <PoDocument
          number={po.number}
          orderDate={po.orderDate}
          statusLabel={PO_STATUS_LABEL[display]}
          vendor={vendor}
          lines={docLines}
          terms={po.terms}
          items={items}
        />

        {po.status === "APPROVED" || po.status === "CLOSED" ? (
          <div className="grid gap-4 lg:grid-cols-2 print:hidden">
            <Card>
              <CardHeader>
                <CardTitle>Receipt progress</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Phones read this as cards; the table needs sm+. */}
                <div className="flex flex-col gap-2 sm:hidden">
                  {progress.map((line) => (
                    <div key={line.poLineId} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{lineItemName(line.poLineId)}</span>
                        {line.overReceivedQty > 0 ? (
                          <Badge variant="warning">+{line.overReceivedQty} over</Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                        Ordered {line.orderedQty} · Accepted {line.acceptedQty} · Rejected{" "}
                        {line.rejectedQty} · Pending {line.pendingQty}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="max-sm:hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Ordered</TableHead>
                        <TableHead className="text-right">Accepted</TableHead>
                        <TableHead className="text-right">Rejected</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {progress.map((line) => (
                        <TableRow key={line.poLineId}>
                          <TableCell className="font-medium">
                            {lineItemName(line.poLineId)}
                            {line.overReceivedQty > 0 ? (
                              <Badge variant="warning" className="ml-2">
                                +{line.overReceivedQty} over
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{line.orderedQty}</TableCell>
                          <TableCell className="text-right tabular-nums">{line.acceptedQty}</TableCell>
                          <TableCell className="text-right tabular-nums">{line.rejectedQty}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {line.pendingQty}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Delivery schedule</CardTitle>
              </CardHeader>
              <CardContent>
                {tranches.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No delivery schedule on this PO.</p>
                ) : (
                  <>
                    <div className="flex flex-col gap-2 sm:hidden">
                      {tranches.map((tranche) => (
                        <div key={tranche.schedule.id} className="rounded-md border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              {lineItemName(tranche.schedule.poLineId)}
                            </span>
                            <ScheduleStatusBadge status={tranche.status} />
                          </div>
                          <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                            Due {tranche.schedule.dueDate} · {tranche.allocatedQty}/
                            {tranche.schedule.qty} received
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="max-sm:hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead>Due</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Received</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tranches.map((tranche) => (
                            <TableRow key={tranche.schedule.id}>
                              <TableCell className="font-medium">
                                {lineItemName(tranche.schedule.poLineId)}
                              </TableCell>
                              <TableCell>{tranche.schedule.dueDate}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {tranche.schedule.qty}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {tranche.allocatedQty}
                              </TableCell>
                              <TableCell>
                                <ScheduleStatusBadge status={tranche.status} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {poGrns.length > 0 ? (
          <Card className="print:hidden">
            <CardHeader>
              <CardTitle>Goods receipts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 sm:hidden">
                {poGrns.map((grn) => (
                  <div key={grn.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{grn.number}</span>
                      <span className="text-muted-foreground text-xs">{grn.receivedDate}</span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {grn.lines
                        .map(
                          (line) =>
                            `${lineItemName(line.poLineId)}: ${line.qtyAccepted}${line.qtyRejected ? ` (+${line.qtyRejected} rej)` : ""}`
                        )
                        .join(", ")}
                    </p>
                    {(grn.invoiceNo || grn.remarks) && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {[grn.invoiceNo, grn.remarks].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="max-sm:hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>GRN</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Lines</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poGrns.map((grn) => (
                      <TableRow key={grn.id}>
                        <TableCell className="font-medium">{grn.number}</TableCell>
                        <TableCell>{grn.receivedDate}</TableCell>
                        <TableCell>{grn.invoiceNo || "—"}</TableCell>
                        <TableCell>
                          {grn.lines
                            .map(
                              (line) =>
                                `${lineItemName(line.poLineId)}: ${line.qtyAccepted}${line.qtyRejected ? ` (+${line.qtyRejected} rej)` : ""}`
                            )
                            .join(", ")}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{grn.remarks || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </PageBody>

      <RecordGrnDialog
        open={grnOpen}
        onOpenChange={setGrnOpen}
        poId={po.id}
        lines={progress.map((line) => ({
          poLineId: line.poLineId,
          itemName: lineItemName(line.poLineId),
          pendingQty: line.pendingQty,
        }))}
        onRecord={(grn) => {
          const saved = recordGrn(po.id, grn, user?.email ?? "")
          const over = receiptProgress(po, [...grns, saved]).filter(
            (line) => line.overReceivedQty > 0
          )
          toast.success(`${saved.number} recorded`)
          if (over.length > 0) {
            // Flagged, never blocked — same principle as §3's punch windows.
            toast.warning("Received more than ordered on some lines — flagged for review.")
          }
        }}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject {po.number}</DialogTitle>
            <DialogDescription>The reason is shown to whoever raised the PO.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Why is this being rejected?"
            rows={3}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                decidePo(po.id, "REJECT", user?.email ?? "", rejectReason)
                setRejectOpen(false)
                toast(`${po.number} rejected`)
              }}
            >
              Reject PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

function RecordGrnDialog({
  open,
  onOpenChange,
  lines,
  onRecord,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  poId: string
  lines: Array<{ poLineId: string; itemName: string; pendingQty: number }>
  onRecord: (grn: {
    receivedDate: string
    invoiceNo: string
    remarks: string
    lines: GrnLine[]
  }) => void
}) {
  const [receivedDate, setReceivedDate] = React.useState(todayISO())
  const [dateOpen, setDateOpen] = React.useState(false)
  const [invoiceNo, setInvoiceNo] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [quantities, setQuantities] = React.useState<
    Record<string, { accepted: number; rejected: number }>
  >({})

  React.useEffect(() => {
    if (open) {
      setReceivedDate(todayISO())
      setInvoiceNo("")
      setRemarks("")
      // Default to "everything still pending arrived, nothing rejected".
      setQuantities(
        Object.fromEntries(
          lines.map((line) => [line.poLineId, { accepted: line.pendingQty, rejected: 0 }])
        )
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const record = () => {
    const grnLines: GrnLine[] = lines
      .map((line) => ({
        poLineId: line.poLineId,
        qtyAccepted: quantities[line.poLineId]?.accepted ?? 0,
        qtyRejected: quantities[line.poLineId]?.rejected ?? 0,
        remarks: "",
      }))
      .filter((line) => line.qtyAccepted > 0 || line.qtyRejected > 0)
    if (grnLines.length === 0) {
      toast.error("Enter a received quantity on at least one line.")
      return
    }
    onRecord({ receivedDate, invoiceNo, remarks, lines: grnLines })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record goods receipt</DialogTitle>
          <DialogDescription>
            A receipt is append-only — a mistake is corrected by another receipt, never by
            editing this one.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="grn-date">Received on</FieldLabel>
              {/* date-picker is popover + calendar — there is no registry component. */}
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button id="grn-date" variant="outline" className="justify-start font-normal">
                    <CalendarIcon />
                    {format(new Date(`${receivedDate}T00:00:00`), "EEE, d MMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={new Date(`${receivedDate}T00:00:00`)}
                    defaultMonth={new Date(`${receivedDate}T00:00:00`)}
                    onSelect={(date) => {
                      if (date) setReceivedDate(format(date, "yyyy-MM-dd"))
                      setDateOpen(false)
                    }}
                  />
                </PopoverContent>
              </Popover>
            </Field>
            <Field>
              <FieldLabel htmlFor="grn-invoice">Vendor invoice / DC no.</FieldLabel>
              <Input
                id="grn-invoice"
                value={invoiceNo}
                onChange={(event) => setInvoiceNo(event.target.value)}
                placeholder="Optional"
              />
            </Field>
          </div>
          {/* Phones: one labelled card per line; sm+: the compact table. */}
          <div className="flex flex-col gap-2 sm:hidden">
            {lines.map((line) => (
              <div key={line.poLineId} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{line.itemName}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {line.pendingQty} pending
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor={`grn-acc-${line.poLineId}`}>Accepted</FieldLabel>
                    <Input
                      id={`grn-acc-${line.poLineId}`}
                      type="number"
                      min={0}
                      step="any"
                      value={quantities[line.poLineId]?.accepted ?? 0}
                      onChange={(event) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [line.poLineId]: {
                            accepted: Number(event.target.value),
                            rejected: prev[line.poLineId]?.rejected ?? 0,
                          },
                        }))
                      }
                      className="h-8 text-right"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`grn-rej-${line.poLineId}`}>Rejected</FieldLabel>
                    <Input
                      id={`grn-rej-${line.poLineId}`}
                      type="number"
                      min={0}
                      step="any"
                      value={quantities[line.poLineId]?.rejected ?? 0}
                      onChange={(event) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [line.poLineId]: {
                            accepted: prev[line.poLineId]?.accepted ?? 0,
                            rejected: Number(event.target.value),
                          },
                        }))
                      }
                      className="h-8 text-right"
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
          <div className="max-sm:hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="w-24 text-right">Accepted</TableHead>
                  <TableHead className="w-24 text-right">Rejected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.poLineId}>
                    <TableCell className="font-medium">{line.itemName}</TableCell>
                    <TableCell className="text-right tabular-nums">{line.pendingQty}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        aria-label={`${line.itemName} accepted quantity`}
                        value={quantities[line.poLineId]?.accepted ?? 0}
                        onChange={(event) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [line.poLineId]: {
                              accepted: Number(event.target.value),
                              rejected: prev[line.poLineId]?.rejected ?? 0,
                            },
                          }))
                        }
                        className="h-8 text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        aria-label={`${line.itemName} rejected quantity`}
                        value={quantities[line.poLineId]?.rejected ?? 0}
                        onChange={(event) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [line.poLineId]: {
                              accepted: prev[line.poLineId]?.accepted ?? 0,
                              rejected: Number(event.target.value),
                            },
                          }))
                        }
                        className="h-8 text-right"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Field>
            <FieldLabel htmlFor="grn-remarks">Remarks</FieldLabel>
            <Textarea
              id="grn-remarks"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Condition on arrival, short supply, transporter…"
              rows={2}
            />
          </Field>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={record}>
            <PackageCheck />
            Record receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
