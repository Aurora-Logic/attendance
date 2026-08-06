import { Link, useParams } from "react-router"
import { Printer, ReceiptText } from "lucide-react"
import { formatPaise, outstandingPaise } from "@attendance/shared"

import { useProcurement } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { EstimateDocument } from "@/components/estimate-document"
import { printPoDocument } from "@/components/po-document"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { items } = useProcurement()
  const { invoices, customers, receipts } = useSales()

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
            {outstanding === 0 ? (
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
          </>
        }
      />
      <PageBody className="bg-muted/40">
        <EstimateDocument
          number={invoice.number}
          date={invoice.date}
          validUntil={null}
          statusLabel={outstanding === 0 ? "Paid" : "Open"}
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
    </Page>
  )
}
