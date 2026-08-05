import * as React from "react"
import { useParams } from "react-router"
import { toast } from "sonner"
import { Ban, Check, Printer, SendHorizontal, X } from "lucide-react"
import { estimateDisplayStatus } from "@attendance/shared"

import { todayISO, useProcurement } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
import { useSession } from "@/lib/session"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { ESTIMATE_STATUS_LABEL, EstimateStatusBadge } from "@/components/po-status-badge"
import { EstimateDocument } from "@/components/estimate-document"
import { printPoDocument } from "@/components/po-document"
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
import { Textarea } from "@/components/ui/textarea"

export function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { items } = useProcurement()
  const { estimates, customers, sendEstimate, decideEstimate, closeEstimate } = useSales()
  const { can } = useSession()
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectNote, setRejectNote] = React.useState("")

  const estimate = estimates.find((candidate) => candidate.id === id)
  if (!estimate) {
    return (
      <Page>
        <PageHeader title="Estimate not found" />
      </Page>
    )
  }

  const customer = customers.find((candidate) => candidate.id === estimate.customerId) ?? null
  const display = estimateDisplayStatus(estimate, todayISO())
  const canManage = can("sales.manage")

  return (
    <Page>
      <PageHeader
        title={estimate.number}
        description={
          estimate.status === "REJECTED" && estimate.decisionNote
            ? `Rejected — ${estimate.decisionNote}`
            : `${customer?.name ?? "—"} · ${estimate.date}${estimate.validUntil ? ` · valid till ${estimate.validUntil}` : ""}`
        }
        actions={
          <>
            <EstimateStatusBadge status={display} />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                printPoDocument(
                  [estimate.number, customer?.name, estimate.date].filter(Boolean).join(" - ")
                )
              }
            >
              <Printer />
              Print / PDF
            </Button>
            {estimate.status === "DRAFT" && canManage ? (
              <Button
                size="sm"
                onClick={() => {
                  sendEstimate(estimate.id)
                  toast.success(`${estimate.number} marked sent`)
                }}
              >
                <SendHorizontal />
                Mark sent
              </Button>
            ) : null}
            {estimate.status === "SENT" && canManage ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)}>
                  <X />
                  Rejected
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    decideEstimate(estimate.id, "ACCEPT")
                    toast.success(`${estimate.number} accepted — sales orders land next wave`)
                  }}
                >
                  <Check />
                  Accepted
                </Button>
              </>
            ) : null}
            {(estimate.status === "DRAFT" || estimate.status === "SENT") && canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  closeEstimate(estimate.id)
                  toast(`${estimate.number} closed`)
                }}
              >
                <Ban />
                Close
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody className="bg-muted/40">
        <EstimateDocument
          number={estimate.number}
          date={estimate.date}
          validUntil={estimate.validUntil}
          statusLabel={ESTIMATE_STATUS_LABEL[display]}
          customer={customer}
          lines={estimate.lines.map((line) => ({
            key: line.id,
            itemId: line.itemId,
            qty: line.qty,
            unitPricePaise: line.unitPricePaise,
            discountPct: line.discountPct,
          }))}
          terms={estimate.terms}
          items={items}
        />
      </PageBody>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Customer declined {estimate.number}</DialogTitle>
          <DialogHeader>
            <DialogDescription>
              Record why — it feeds the win-rate picture on the customer master.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectNote}
            onChange={(event) => setRejectNote(event.target.value)}
            placeholder="Price too high, went with a competitor, project dropped…"
            rows={3}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                decideEstimate(estimate.id, "REJECT", rejectNote)
                setRejectOpen(false)
                toast(`${estimate.number} marked rejected`)
              }}
            >
              Record rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
