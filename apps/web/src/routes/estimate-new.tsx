import * as React from "react"
import { useLocation, useNavigate } from "react-router"
import { toast } from "sonner"
import { Eye, Pencil, Printer, SendHorizontal } from "lucide-react"
import { formatDocNumber, formatPaise, poTotals, type PoLine } from "@attendance/shared"

import { shiftDateISO } from "@attendance/shared"
import { todayISO, useProcurement } from "@/lib/procurement"
import { useSales } from "@/lib/sales"
import { useSession } from "@/lib/session"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { EstimateDocument, type EstimateDocLine } from "@/components/estimate-document"
import { printPoDocument } from "@/components/po-document"
import { Button } from "@/components/ui/button"

/** Same type-on-the-template builder as the PO, pointed at a customer. */
export function EstimateNewPage() {
  const { items } = useProcurement()
  const { customers, estimates, seq, createEstimate, updateEstimateDraft, sendEstimate } = useSales()
  const { user } = useSession()
  const navigate = useNavigate()
  const editState = (useLocation().state ?? null) as { editEstimateId?: string } | null
  const editing = editState?.editEstimateId
    ? (estimates.find(
        (candidate) => candidate.id === editState.editEstimateId && candidate.status === "DRAFT"
      ) ?? null)
    : null

  const [customerId, setCustomerId] = React.useState(editing?.customerId ?? "")
  const [date, setDate] = React.useState(editing?.date ?? todayISO())
  const [validUntil, setValidUntil] = React.useState<string | null>(
    editing ? editing.validUntil : shiftDateISO(todayISO(), 14)
  )
  const [terms, setTerms] = React.useState(editing?.terms ?? "")
  const [lines, setLines] = React.useState<EstimateDocLine[]>(() =>
    (editing?.lines ?? []).map((line) => ({
      key: line.id,
      itemId: line.itemId,
      qty: line.qty,
      unitPricePaise: line.unitPricePaise,
      discountPct: line.discountPct,
    }))
  )
  const [preview, setPreview] = React.useState(false)
  const nextKey = React.useRef(1)

  const customer = customers.find((candidate) => candidate.id === customerId) ?? null
  const number = editing?.number ?? formatDocNumber("EST", Number(date.slice(0, 4)), seq.est + 1)

  const totals = poTotals(
    lines
      .filter((line) => line.itemId && line.qty > 0)
      .map(
        (line): PoLine => ({
          id: line.key,
          itemId: line.itemId,
          qty: line.qty,
          unitPricePaise: line.unitPricePaise,
          gstRatePct: items.find((item) => item.id === line.itemId)?.gstRatePct ?? 18,
          discountPct: line.discountPct,
        })
      )
  )

  const patchLine = (key: string, patch: Partial<EstimateDocLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const validate = (): string | null => {
    if (!customerId) return "Pick a customer."
    if (lines.length === 0) return "Add at least one line."
    for (const [index, line] of lines.entries()) {
      if (!line.itemId) return `Line ${index + 1}: pick an item.`
      if (line.qty <= 0) return `Line ${index + 1}: quantity must be positive.`
    }
    return null
  }

  const save = (send: boolean) => {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    const draft = {
      customerId,
      date,
      validUntil,
      terms,
      notes: "",
      lines: lines.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        unitPricePaise: line.unitPricePaise,
        gstRatePct: items.find((item) => item.id === line.itemId)?.gstRatePct ?? 18,
        discountPct: line.discountPct,
      })),
    }
    if (editing) {
      updateEstimateDraft(editing.id, draft)
      if (send) sendEstimate(editing.id)
      toast.success(`${editing.number} ${send ? "updated and sent" : "updated"}`)
      navigate(`/estimates/${editing.id}`)
      return
    }
    const estimate = createEstimate(draft, user?.email ?? "unknown")
    if (send) sendEstimate(estimate.id)
    toast.success(`${estimate.number} ${send ? "sent" : "saved as draft"}`)
    navigate(`/estimates/${estimate.id}`)
  }

  return (
    <Page>
      <PageHeader
        title={editing ? `Edit ${editing.number}` : "New Estimate"}
        description={
          preview
            ? "Preview — exactly as it prints. Nothing is saved yet."
            : `Type directly on the document · Total ${formatPaise(totals.totalPaise)}`
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPreview((value) => !value)}>
              {preview ? (
                <>
                  <Pencil />
                  Edit
                </>
              ) : (
                <>
                  <Eye />
                  Preview
                </>
              )}
            </Button>
            {preview ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  printPoDocument(
                    [number, customer?.name ?? "Draft", date].filter(Boolean).join(" - ")
                  )
                }
              >
                <Printer />
                Print / PDF
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => save(false)}>
              Save draft
            </Button>
            <Button size="sm" onClick={() => save(true)}>
              <SendHorizontal />
              Save &amp; send
            </Button>
          </>
        }
      />
      <PageBody className="bg-muted/40">
        <EstimateDocument
          number={number}
          date={date}
          validUntil={validUntil}
          statusLabel="Draft"
          customer={customer}
          lines={lines}
          terms={terms}
          items={items.filter((item) => item.active)}
          editable={!preview}
          customers={customers.filter((candidate) => candidate.active)}
          onPickCustomer={setCustomerId}
          onClearCustomer={() => setCustomerId("")}
          onDate={setDate}
          onValidUntil={setValidUntil}
          onTerms={setTerms}
          onPatchLine={patchLine}
          onAddLine={() =>
            setLines((prev) => [
              ...prev,
              {
                key: `k${nextKey.current++}`,
                itemId: "",
                qty: 1,
                unitPricePaise: 0,
                discountPct: 0,
              },
            ])
          }
          onRemoveLine={(key) =>
            setLines((prev) => prev.filter((candidate) => candidate.key !== key))
          }
        />
      </PageBody>
    </Page>
  )
}
