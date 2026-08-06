import * as React from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import { Ban, FileText, Printer, ReceiptText, Truck } from "lucide-react"
import { soDisplayStatus, soFulfilment, shiftDateISO } from "@attendance/shared"

import { todayISO, useProcurement } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
import { useSession } from "@/lib/session"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { SO_STATUS_LABEL, SoStatusBadge } from "@/components/po-status-badge"
import { EstimateDocument } from "@/components/estimate-document"
import { printPoDocument } from "@/components/po-document"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

/** Display labels for the derived dispatch dimension. */
const DISPLAY_LABEL: Record<string, string> = {
  ...SO_STATUS_LABEL,
  PARTIALLY_DISPATCHED: "Partially dispatched",
  DISPATCHED: "Dispatched",
}

export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { items } = useProcurement()
  const {
    salesOrders,
    customers,
    challans,
    invoices,
    closeSalesOrder,
    cancelSalesOrder,
    recordChallan,
    createInvoiceFromSo,
  } = useSales()
  const { can, user } = useSession()
  const [dispatchOpen, setDispatchOpen] = React.useState(false)

  const so = salesOrders.find((candidate) => candidate.id === id)
  if (!so) {
    return (
      <Page>
        <PageHeader title="Sales order not found" />
      </Page>
    )
  }

  const customer = customers.find((candidate) => candidate.id === so.customerId) ?? null
  const canManage = can("sales.manage")
  const display = soDisplayStatus(so, challans)
  const fulfilment = soFulfilment(so, challans)
  const ownChallans = challans.filter((challan) => challan.soId === so.id)
  const ownInvoices = invoices.filter((invoice) => invoice.soId === so.id)
  const anyDispatched = ownChallans.length > 0
  const itemName = (soLineId: string) => {
    const line = so.lines.find((candidate) => candidate.id === soLineId)
    return items.find((candidate) => candidate.id === line?.itemId)?.name ?? "—"
  }

  return (
    <Page>
      <PageHeader
        title={so.number}
        description={`${customer?.name ?? "—"} · ordered ${so.orderDate}${so.customerRef ? ` · ref ${so.customerRef}` : ""}`}
        actions={
          <>
            <SoStatusBadge status={so.status} />
            {display !== so.status ? <Badge variant="info">{DISPLAY_LABEL[display]}</Badge> : null}
            {so.sourceEstimateId ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/estimates/${so.sourceEstimateId}`}>
                  <FileText />
                  Source estimate
                </Link>
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                printPoDocument(
                  [so.number, customer?.name, so.orderDate].filter(Boolean).join(" - ")
                )
              }
            >
              <Printer />
              Print / PDF
            </Button>
            {so.status === "OPEN" && canManage && display !== "DISPATCHED" ? (
              <Button size="sm" onClick={() => setDispatchOpen(true)}>
                <Truck />
                Record dispatch
              </Button>
            ) : null}
            {so.status === "OPEN" && canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const invoice = createInvoiceFromSo(so.id, {
                    date: todayISO(),
                    dueDate: shiftDateISO(todayISO(), customer?.paymentTermsDays ?? 30),
                    createdBy: user?.email ?? "",
                  })
                  if (invoice) {
                    toast.success(`${invoice.number} raised from ${so.number}`)
                    navigate(`/invoices/${invoice.id}`)
                  }
                }}
              >
                <ReceiptText />
                Create invoice
              </Button>
            ) : null}
            {so.status === "OPEN" && canManage ? (
              <>
                {!anyDispatched ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      cancelSalesOrder(so.id)
                      toast(`${so.number} cancelled`)
                    }}
                  >
                    <Ban />
                    Cancel
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    closeSalesOrder(so.id)
                    toast.success(`${so.number} closed`)
                  }}
                >
                  Close order
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <PageBody className="bg-muted/40">
        <EstimateDocument
          number={so.number}
          date={so.orderDate}
          validUntil={null}
          statusLabel={DISPLAY_LABEL[display]}
          title="SALES ORDER"
          numberLabel="Order No."
          thirdRef={{ label: "Customer ref", value: so.customerRef }}
          customer={customer}
          lines={so.lines.map((line) => ({
            key: line.id,
            itemId: line.itemId,
            qty: line.qty,
            unitPricePaise: line.unitPricePaise,
            discountPct: line.discountPct,
          }))}
          terms={so.terms}
          items={items}
        />

        {(anyDispatched || ownInvoices.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2 print:hidden">
            <Card>
              <CardHeader>
                <CardTitle>Fulfilment</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {fulfilment.map((line) => (
                  <div key={line.soLineId} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{itemName(line.soLineId)}</span>
                      {line.pendingQty === 0 ? (
                        <Badge variant="success">Complete</Badge>
                      ) : (
                        <Badge variant="warning">{line.pendingQty} pending</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                      {line.dispatchedQty}/{line.orderedQty} dispatched
                    </p>
                  </div>
                ))}
                {ownChallans.map((challan) => (
                  <div key={challan.id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{challan.number}</span>
                      <span className="text-muted-foreground text-xs">{challan.dispatchDate}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {challan.lines
                        .map((line) => `${itemName(line.soLineId)}: ${line.qty}`)
                        .join(", ")}
                      {challan.vehicleNo ? ` · ${challan.vehicleNo}` : ""}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invoices</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {ownInvoices.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Not invoiced yet.</p>
                ) : (
                  ownInvoices.map((invoice) => (
                    <Link
                      key={invoice.id}
                      to={`/invoices/${invoice.id}`}
                      className="hover:bg-muted/50 rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{invoice.number}</span>
                        <span className="text-muted-foreground text-xs">due {invoice.dueDate}</span>
                      </div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </PageBody>

      <DispatchDialog
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        lines={fulfilment.map((line) => ({
          soLineId: line.soLineId,
          itemName: itemName(line.soLineId),
          pendingQty: line.pendingQty,
        }))}
        onRecord={(challan) => {
          const saved = recordChallan(so.id, challan, user?.email ?? "")
          toast.success(`${saved.number} recorded — stock updated`)
        }}
      />
    </Page>
  )
}

function DispatchDialog({
  open,
  onOpenChange,
  lines,
  onRecord,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lines: Array<{ soLineId: string; itemName: string; pendingQty: number }>
  onRecord: (challan: {
    dispatchDate: string
    vehicleNo: string
    remarks: string
    lines: Array<{ soLineId: string; qty: number }>
  }) => void
}) {
  const [dispatchDate, setDispatchDate] = React.useState(todayISO())
  const [vehicleNo, setVehicleNo] = React.useState("")
  const [quantities, setQuantities] = React.useState<Record<string, number>>({})

  React.useEffect(() => {
    if (open) {
      setDispatchDate(todayISO())
      setVehicleNo("")
      // Default to "everything still pending goes on this vehicle".
      setQuantities(Object.fromEntries(lines.map((line) => [line.soLineId, line.pendingQty])))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record dispatch</DialogTitle>
          <DialogDescription>
            Creates a delivery challan and moves the goods out of stock — append-only, like every
            movement.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="ch-date">Dispatch date</FieldLabel>
              <Input
                id="ch-date"
                type="date"
                value={dispatchDate}
                onChange={(event) => setDispatchDate(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ch-vehicle">Vehicle no.</FieldLabel>
              <Input
                id="ch-vehicle"
                value={vehicleNo}
                onChange={(event) => setVehicleNo(event.target.value)}
                placeholder="MH01AB1234"
              />
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((line) => (
              <div key={line.soLineId} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{line.itemName}</p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {line.pendingQty} pending
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  aria-label={`${line.itemName} dispatch quantity`}
                  value={quantities[line.soLineId] ?? 0}
                  onChange={(event) =>
                    setQuantities((prev) => ({
                      ...prev,
                      [line.soLineId]: Number(event.target.value),
                    }))
                  }
                  className="h-8 w-24 text-right"
                />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => {
              const challanLines = lines
                .map((line) => ({ soLineId: line.soLineId, qty: quantities[line.soLineId] ?? 0 }))
                .filter((line) => line.qty > 0)
              if (challanLines.length === 0) {
                toast.error("Enter a dispatch quantity on at least one line.")
                return
              }
              onRecord({ dispatchDate, vehicleNo, remarks: "", lines: challanLines })
              onOpenChange(false)
            }}
          >
            <Truck />
            Record dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
