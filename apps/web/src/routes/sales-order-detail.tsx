import { Link, useParams } from "react-router"
import { toast } from "sonner"
import { Ban, FileText, Printer } from "lucide-react"

import { useProcurement } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
import { useSession } from "@/lib/session"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { SO_STATUS_LABEL, SoStatusBadge } from "@/components/po-status-badge"
import { EstimateDocument } from "@/components/estimate-document"
import { printPoDocument } from "@/components/po-document"
import { Button } from "@/components/ui/button"

export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { items } = useProcurement()
  const { salesOrders, customers, closeSalesOrder, cancelSalesOrder } = useSales()
  const { can } = useSession()

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

  return (
    <Page>
      <PageHeader
        title={so.number}
        description={`${customer?.name ?? "—"} · ordered ${so.orderDate}${so.customerRef ? ` · ref ${so.customerRef}` : ""}`}
        actions={
          <>
            <SoStatusBadge status={so.status} />
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
            {so.status === "OPEN" && canManage ? (
              <>
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
                <Button
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
          statusLabel={SO_STATUS_LABEL[so.status]}
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
      </PageBody>
    </Page>
  )
}
