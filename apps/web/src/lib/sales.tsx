import * as React from "react"
import { formatDocNumber, type Customer, type Estimate, type PoLine } from "@attendance/shared"

/**
 * Sales store: customers and estimates, persisted locally and mirroring
 * `apps/api/src/sales.ts` 1:1 — the same contract as the procurement store,
 * so both modules swap to the API together. Estimate lines are PO lines;
 * every derived number comes from the shared maths.
 */

export interface SalesState {
  customers: Customer[]
  estimates: Estimate[]
  seq: { est: number; entity: number }
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
  return { customers, estimates, seq: { est: 1, entity: 1 } }
}

export function SalesProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SalesState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw) as SalesState
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
          seq: { est: prev.seq.est + 1, entity: prev.seq.entity + 1 },
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
    }
  }, [state])

  return <SalesContext.Provider value={value}>{children}</SalesContext.Provider>
}

export function useSales() {
  const context = React.useContext(SalesContext)
  if (!context) throw new Error("useSales must be used inside SalesProvider")
  return context
}
