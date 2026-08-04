import * as React from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { Eye, Pencil, Printer, SendHorizontal } from "lucide-react"
import { formatDocNumber, formatPaise, poTotals, type PoLine } from "@attendance/shared"

import { defaultDueDate, todayISO, useProcurement } from "@/lib/procurement"
import { useSession } from "@/lib/session"
import { Page, PageBody, PageHeader } from "@/components/page-shell"
import { PoDocument, type DocLine } from "@/components/po-document"
import { Button } from "@/components/ui/button"

/**
 * Type-on-the-template builder: the sheet below IS the PO document, edited
 * inline (OCC estimate pattern). Preview renders the identical sheet without
 * affordances; Print uses the browser's A4 output of the same markup.
 */
export function PurchaseOrderNewPage() {
  const { vendors, items, seq, createPo, submitPo } = useProcurement()
  const { user } = useSession()
  const navigate = useNavigate()

  const [vendorId, setVendorId] = React.useState("")
  const [orderDate, setOrderDate] = React.useState(todayISO())
  const [terms, setTerms] = React.useState("")
  const [lines, setLines] = React.useState<DocLine[]>([])
  const [preview, setPreview] = React.useState(false)
  const nextKey = React.useRef(1)

  const vendor = vendors.find((candidate) => candidate.id === vendorId) ?? null
  const number = formatDocNumber("PO", Number(orderDate.slice(0, 4)), seq.po + 1)

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

  const patchLine = (key: string, patch: Partial<DocLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        key: `k${nextKey.current++}`,
        itemId: "",
        qty: 1,
        unitPricePaise: 0,
        discountPct: 0,
        schedules: [{ dueDate: defaultDueDate(orderDate, vendor ?? undefined), qty: 1 }],
      },
    ])

  const validate = (): string | null => {
    if (!vendorId) return "Pick a vendor."
    if (lines.length === 0) return "Add at least one line."
    for (const [index, line] of lines.entries()) {
      if (!line.itemId) return `Line ${index + 1}: pick an item.`
      if (line.qty <= 0) return `Line ${index + 1}: quantity must be positive.`
      const scheduled = line.schedules.reduce((sum, tranche) => sum + tranche.qty, 0)
      if (line.schedules.length > 0 && Math.abs(scheduled - line.qty) > 1e-9) {
        return `Line ${index + 1}: delivery tranches add up to ${scheduled}, but the line orders ${line.qty}.`
      }
    }
    return null
  }

  const save = (submit: boolean) => {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    const po = createPo(
      { vendorId, orderDate, terms, notes: "", lines },
      user?.email ?? "unknown"
    )
    if (submit) submitPo(po.id)
    toast.success(`${po.number} ${submit ? "submitted for approval" : "saved as draft"}`)
    navigate(`/purchase-orders/${po.id}`)
  }

  return (
    <Page>
      <PageHeader
        title="New Purchase Order"
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
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer />
                Print / PDF
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => save(false)}>
              Save draft
            </Button>
            <Button size="sm" onClick={() => save(true)}>
              <SendHorizontal />
              Submit for approval
            </Button>
          </>
        }
      />
      <PageBody className="bg-muted/40">
        <PoDocument
          number={number}
          orderDate={orderDate}
          statusLabel="Draft"
          vendor={vendor}
          lines={lines}
          terms={terms}
          items={items.filter((item) => item.active)}
          editable={!preview}
          vendors={vendors.filter((candidate) => candidate.active)}
          onPickVendor={setVendorId}
          onClearVendor={() => setVendorId("")}
          onOrderDate={setOrderDate}
          onTerms={setTerms}
          onPatchLine={patchLine}
          onAddLine={addLine}
          onRemoveLine={(key) =>
            setLines((prev) => prev.filter((candidate) => candidate.key !== key))
          }
        />
      </PageBody>
    </Page>
  )
}
