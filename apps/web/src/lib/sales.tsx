import * as React from "react"
import {
  allocateOldestFirst,
  formatDocNumber,
  outstandingPaise,
  salesOrderFromEstimate,
  type Challan,
  type Customer,
  type Estimate,
  type Invoice,
  type PaymentEntry,
  type PoLine,
  type SalesOrder,
} from "@attendance/shared"

/**
 * Sales store: customers and estimates, persisted locally and mirroring
 * `apps/api/src/sales.ts` 1:1 — the same contract as the procurement store,
 * so both modules swap to the API together. Estimate lines are PO lines;
 * every derived number comes from the shared maths.
 */

export interface SalesState {
  customers: Customer[]
  estimates: Estimate[]
  salesOrders: SalesOrder[]
  challans: Challan[]
  invoices: Invoice[]
  /** Money received from customers, allocated to invoices. */
  receipts: PaymentEntry[]
  seq: { est: number; so: number; ch: number; inv: number; entity: number }
}

export interface EstimateDraftLine {
  itemId: string
  qty: number
  unitPricePaise: number
  /** Copied from the item at quote time — a later slab change must not reprice history. */
  gstRatePct: number
  discountPct: number
}

export interface EstimateDraft {
  customerId: string
  date: string
  validUntil: string | null
  lines: EstimateDraftLine[]
  terms: string
  notes: string
}

interface SalesValue extends SalesState {
  upsertCustomer: (customer: Omit<Customer, "id"> & { id?: string }) => Customer
  createEstimate: (draft: EstimateDraft, createdBy: string) => Estimate
  sendEstimate: (estimateId: string) => void
  decideEstimate: (estimateId: string, action: "ACCEPT" | "REJECT", note?: string) => void
  closeEstimate: (estimateId: string) => void
  /** Accepted estimate → sales order, once; returns null if already converted. */
  convertEstimate: (
    estimateId: string,
    input: { orderDate: string; customerRef: string; createdBy: string }
  ) => SalesOrder | null
  closeSalesOrder: (soId: string) => void
  cancelSalesOrder: (soId: string) => void
  recordChallan: (
    soId: string,
    challan: { dispatchDate: string; vehicleNo: string; remarks: string; lines: Array<{ soLineId: string; qty: number }> },
    recordedBy: string
  ) => Challan
  /** Bills a sales order verbatim — billing never reprices. */
  createInvoiceFromSo: (
    soId: string,
    input: { date: string; dueDate: string; createdBy: string }
  ) => Invoice | null
  /** Auto-allocates oldest-due-first across the customer's open invoices. */
  recordReceipt: (
    input: Omit<PaymentEntry, "id" | "allocations" | "recordedBy">,
    recordedBy: string
  ) => PaymentEntry | null
}

const SalesContext = React.createContext<SalesValue | null>(null)

const STORAGE_KEY = "attendance.sales.v1"

function seedState(): SalesState {
  const customers: Customer[] = [
    { id: "c1", code: "CST001", name: "Acme Retail Pvt Ltd", gstin: "27AAACA1111A1Z5", contact: "Neha Gupta", email: "purchase@acmeretail.in", phone: "+91 98220 33445", address: "Linking Road, Bandra West", city: "Mumbai", state: "Maharashtra", paymentTermsDays: 30, active: true },
    { id: "c2", code: "CST002", name: "Zenith Traders", gstin: null, contact: "Farhan Ali", email: "zenith.traders@gmail.com", phone: "+91 99887 66554", address: "Chickpet Main Road", city: "Bengaluru", state: "Karnataka", paymentTermsDays: 15, active: true },
  ]
  const estimates: Estimate[] = [
    {
      id: "est1", number: "EST-2026-0001", customerId: "c1", date: "2026-07-28",
      validUntil: "2026-08-12", status: "SENT",
      lines: [{ id: "estl1", itemId: "i5", qty: 60, unitPricePaise: 24_500, gstRatePct: 18, discountPct: 0 }],
      terms: "Prices ex-works Mumbai. Delivery 7 days from confirmation.",
      notes: "", createdBy: "ops@delta.dev", decisionNote: "",
    },
  ]
  return {
    customers,
    estimates,
    salesOrders: [],
    challans: [],
    invoices: [],
    receipts: [],
    seq: { est: 1, so: 0, ch: 0, inv: 0, entity: 1 },
  }
}

/** A blob saved before sales orders existed must never brick the app. */
function normalizeState(raw: SalesState): SalesState {
  return {
    ...raw,
    salesOrders: raw.salesOrders ?? [],
    challans: raw.challans ?? [],
    invoices: raw.invoices ?? [],
    receipts: raw.receipts ?? [],
    seq: {
      est: raw.seq.est,
      so: raw.seq.so ?? 0,
      ch: raw.seq.ch ?? 0,
      inv: raw.seq.inv ?? 0,
      entity: raw.seq.entity,
    },
  }
}

export function SalesProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SalesState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return normalizeState(JSON.parse(raw) as SalesState)
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
    return seedState()
  })

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const value = React.useMemo<SalesValue>(() => {
    const patchEstimate = (estimateId: string, patch: Partial<Estimate>) =>
      setState((prev) => ({
        ...prev,
        estimates: prev.estimates.map((estimate) =>
          estimate.id === estimateId ? { ...estimate, ...patch } : estimate
        ),
      }))

    return {
      ...state,

      upsertCustomer: (customer) => {
        const saved: Customer = { ...customer, id: customer.id ?? `c_${state.seq.entity}` }
        setState((prev) => ({
          ...prev,
          customers: customer.id
            ? prev.customers.map((candidate) => (candidate.id === customer.id ? saved : candidate))
            : [...prev.customers, { ...saved, id: `c_${prev.seq.entity}` }],
          seq: { ...prev.seq, entity: prev.seq.entity + 1 },
        }))
        return saved
      },

      createEstimate: (draft, createdBy) => {
        const lines: PoLine[] = draft.lines.map((line, index) => ({
          id: `est_${state.seq.entity}_l${index}`,
          itemId: line.itemId,
          qty: line.qty,
          unitPricePaise: line.unitPricePaise,
          gstRatePct: line.gstRatePct,
          discountPct: line.discountPct,
        }))
        const estimate: Estimate = {
          id: `est_${state.seq.entity}`,
          number: formatDocNumber("EST", Number(draft.date.slice(0, 4)), state.seq.est + 1),
          customerId: draft.customerId,
          date: draft.date,
          validUntil: draft.validUntil,
          status: "DRAFT",
          lines,
          terms: draft.terms,
          notes: draft.notes,
          createdBy,
          decisionNote: "",
        }
        setState((prev) => ({
          ...prev,
          estimates: [...prev.estimates, estimate],
          seq: { ...prev.seq, est: prev.seq.est + 1, entity: prev.seq.entity + 1 },
        }))
        return estimate
      },

      sendEstimate: (estimateId) => patchEstimate(estimateId, { status: "SENT" }),

      decideEstimate: (estimateId, action, note = "") =>
        patchEstimate(estimateId, {
          status: action === "ACCEPT" ? "ACCEPTED" : "REJECTED",
          decisionNote: note,
        }),

      closeEstimate: (estimateId) => patchEstimate(estimateId, { status: "CLOSED" }),

      convertEstimate: (estimateId, input) => {
        const estimate = state.estimates.find((candidate) => candidate.id === estimateId)
        if (!estimate || estimate.status !== "ACCEPTED") return null
        if (state.salesOrders.some((so) => so.sourceEstimateId === estimateId)) return null
        const so = salesOrderFromEstimate(estimate, {
          id: `so_${state.seq.entity}`,
          number: formatDocNumber("SO", Number(input.orderDate.slice(0, 4)), state.seq.so + 1),
          orderDate: input.orderDate,
          customerRef: input.customerRef,
          createdBy: input.createdBy,
        })
        setState((prev) => ({
          ...prev,
          salesOrders: [...prev.salesOrders, so],
          seq: { ...prev.seq, so: prev.seq.so + 1, entity: prev.seq.entity + 1 },
        }))
        return so
      },

      closeSalesOrder: (soId) =>
        setState((prev) => ({
          ...prev,
          salesOrders: prev.salesOrders.map((so) =>
            so.id === soId ? { ...so, status: "CLOSED" } : so
          ),
        })),

      cancelSalesOrder: (soId) =>
        setState((prev) => ({
          ...prev,
          salesOrders: prev.salesOrders.map((so) =>
            so.id === soId ? { ...so, status: "CANCELLED" } : so
          ),
        })),

      recordChallan: (soId, challan, recordedBy) => {
        const saved: Challan = {
          id: `ch_${state.seq.entity}`,
          number: formatDocNumber("CH", Number(challan.dispatchDate.slice(0, 4)), state.seq.ch + 1),
          soId,
          recordedBy,
          ...challan,
        }
        setState((prev) => ({
          ...prev,
          challans: [...prev.challans, saved],
          seq: { ...prev.seq, ch: prev.seq.ch + 1, entity: prev.seq.entity + 1 },
        }))
        return saved
      },

      createInvoiceFromSo: (soId, input) => {
        const so = state.salesOrders.find((candidate) => candidate.id === soId)
        if (!so) return null
        const invoiceId = `inv_${state.seq.entity}`
        const invoice: Invoice = {
          id: invoiceId,
          number: formatDocNumber("INV", Number(input.date.slice(0, 4)), state.seq.inv + 1),
          customerId: so.customerId,
          soId: so.id,
          date: input.date,
          dueDate: input.dueDate,
          status: "OPEN",
          lines: so.lines.map((line, index): PoLine => ({ ...line, id: `${invoiceId}_l${index}` })),
          terms: so.terms,
          createdBy: input.createdBy,
        }
        setState((prev) => ({
          ...prev,
          invoices: [...prev.invoices, invoice],
          seq: { ...prev.seq, inv: prev.seq.inv + 1, entity: prev.seq.entity + 1 },
        }))
        return invoice
      },

      recordReceipt: (input, recordedBy) => {
        const allocations = allocateOldestFirst(
          input.amountPaise,
          state.invoices
            .filter((invoice) => invoice.customerId === input.partyId && invoice.status === "OPEN")
            .map((invoice) => ({
              id: invoice.id,
              dueDate: invoice.dueDate,
              outstandingPaise: outstandingPaise(invoice, state.receipts),
            }))
        )
        if (allocations.length === 0) return null
        const receipt: PaymentEntry = {
          id: `rcpt_${state.seq.entity}`,
          recordedBy,
          ...input,
          allocations,
        }
        setState((prev) => ({
          ...prev,
          receipts: [...prev.receipts, receipt],
          seq: { ...prev.seq, entity: prev.seq.entity + 1 },
        }))
        return receipt
      },
    }
  }, [state])

  return <SalesContext.Provider value={value}>{children}</SalesContext.Provider>
}

export function useSales() {
  const context = React.useContext(SalesContext)
  if (!context) throw new Error("useSales must be used inside SalesProvider")
  return context
}
