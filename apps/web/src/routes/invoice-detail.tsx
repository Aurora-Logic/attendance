import { Link, useParams } from "react-router"
import * as React from "react"
import { Ban, Pencil, Printer, ReceiptText } from "lucide-react"
import { toast } from "sonner"
import { formatPaise, outstandingPaise } from "@attendance/shared"

import { useProcurement } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
import { useSession } from "@/lib/session"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
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

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { items } = useProcurement()
  const { invoices, customers, receipts, cancelInvoice, updateInvoiceMeta } = useSales()
  const [editOpen, setEditOpen] = React.useState(false)
  const [editDate, setEditDate] = React.useState("")
  const [editDue, setEditDue] = React.useState("")
  const { can } = useSession()

  const invoice = invoices.find((candidate) => candidate.id === id)
  if (!invoice) {
    return (
      <Page>
        <PageHeader title="Invoice not found" />
      </Page>
    )
  }

  const customer = customers.find((candidate) => candidate.id === invoice.customerId) ?? null
  const outstanding = outstandingPaise(invoice, receipts)
  const cancelled = invoice.status === "CANCELLED"
  const ownReceipts = receipts.filter((receipt) =>
    receipt.allocations.some((allocation) => allocation.docId === invoice.id)
  )

  return (
    <Page>
      <PageHeader
        title={invoice.number}
        description={`${customer?.name ?? "—"} · ${invoice.date} · due ${invoice.dueDate}`}
        actions={
          <>
            {cancelled ? (
              <Badge variant="secondary">Cancelled</Badge>
            ) : outstanding === 0 ? (
              <Badge variant="success">Paid</Badge>
            ) : (
              <Badge variant="warning">{formatPaise(outstanding)} outstanding</Badge>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/receivables">
                <ReceiptText />
                Record payment
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                printPoDocument(
                  [invoice.number, customer?.name, invoice.date].filter(Boolean).join(" - ")
                )
              }
            >
              <Printer />
              Print / PDF
            </Button>
            {invoice.status === "OPEN" && ownReceipts.length === 0 && can("sales.manage") ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditDate(invoice.date)
                  setEditDue(invoice.dueDate)
                  setEditOpen(true)
                }}
              >
                <Pencil />
                Edit dates
              </Button>
            ) : null}
            {invoice.status === "OPEN" && ownReceipts.length === 0 && can("sales.manage") ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (cancelInvoice(invoice.id)) toast(`${invoice.number} cancelled`)
                  else toast.error("Receipts are allocated — cannot cancel.")
                }}
              >
                <Ban />
                Cancel
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody className="bg-muted/40">
        <EstimateDocument
          number={invoice.number}
          date={invoice.date}
          validUntil={null}
          statusLabel={cancelled ? "Cancelled" : outstanding === 0 ? "Paid" : "Open"}
          title="TAX INVOICE"
          numberLabel="Invoice No."
          thirdRef={{ label: "Due date", value: invoice.dueDate }}
          customer={customer}
          lines={invoice.lines.map((line) => ({
            key: line.id,
            itemId: line.itemId,
            qty: line.qty,
            unitPricePaise: line.unitPricePaise,
            discountPct: line.discountPct,
          }))}
          terms={invoice.terms}
          items={items}
        />

        {ownReceipts.length > 0 ? (
          <Card className="print:hidden">
            <CardHeader>
              <CardTitle>Payments received</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {ownReceipts.map((receipt) => (
                <div key={receipt.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium tabular-nums">
                      {formatPaise(
                        receipt.allocations
                          .filter((allocation) => allocation.docId === invoice.id)
                          .reduce((sum, allocation) => sum + allocation.amountPaise, 0)
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {receipt.date} · {receipt.mode}
                      {receipt.reference ? ` · ${receipt.reference}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </PageBody>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit {invoice.number} dates</DialogTitle>
            <DialogDescription>
              Amounts come from the sales order and never change here.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="edit-inv-date">Invoice date</FieldLabel>
              <Input id="edit-inv-date" type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-inv-due">Due date</FieldLabel>
              <Input id="edit-inv-due" type="date" value={editDue} onChange={(event) => setEditDue(event.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => {
                if (updateInvoiceMeta(invoice.id, { date: editDate, dueDate: editDue })) {
                  toast.success(`${invoice.number} updated`)
                  setEditOpen(false)
                } else toast.error("Receipts are allocated — dates are frozen.")
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
