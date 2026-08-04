import * as React from "react"
import {
  formatDocNumber,
  shiftDateISO,
  type Grn,
  type GrnLine,
  type Item,
  type PoLine,
  type PoSchedule,
  type PurchaseOrder,
  type Vendor,
} from "@attendance/shared"

/**
 * Procurement store: vendors, items, POs and GRNs, persisted locally until the
 * Phase-3 API wiring — the state shape and every action mirror the
 * `apps/api/src/procurement.ts` routes 1:1, so the swap replaces storage, not
 * consumers. All derived numbers (totals, receipt progress, schedule status,
 * vendor analytics) come from `@attendance/shared`, never computed here.
 */

export interface ProcurementState {
  vendors: Vendor[]
  items: Item[]
  pos: PurchaseOrder[]
  grns: Grn[]
  seq: { po: number; grn: number; entity: number }
}

export interface PoDraftLine {
  itemId: string
  qty: number
  unitPricePaise: number
  discountPct: number
  /** Delivery tranches for this line; empty means "one lot, no promise". */
  schedules: { dueDate: string; qty: number }[]
}

export interface PoDraft {
  vendorId: string
  orderDate: string
  lines: PoDraftLine[]
  terms: string
  notes: string
}

interface ProcurementValue extends ProcurementState {
  upsertVendor: (vendor: Omit<Vendor, "id"> & { id?: string }) => Vendor
  upsertItem: (item: Omit<Item, "id"> & { id?: string }) => Item
  createPo: (draft: PoDraft, createdBy: string) => PurchaseOrder
  submitPo: (poId: string) => void
  decidePo: (poId: string, action: "APPROVE" | "REJECT", decidedBy: string, reason?: string) => void
  cancelPo: (poId: string) => void
  closePo: (poId: string) => void
  recordGrn: (
    poId: string,
    grn: { receivedDate: string; invoiceNo: string; remarks: string; lines: GrnLine[] },
    recordedBy: string
  ) => Grn
}

const ProcurementContext = React.createContext<ProcurementValue | null>(null)

const STORAGE_KEY = "attendance.procurement.v1"

/**
 * Seed mirrors the API store plus enough history for the analytics screen to
 * mean something on first open: one PO fully received on time, one running
 * late with a tranche outstanding, one awaiting approval.
 */
function seedState(): ProcurementState {
  const vendors: Vendor[] = [
    { id: "v1", code: "VND001", name: "Shree Steel Traders", gstin: "27AABCS1429B1ZP", contact: "Mahesh Kulkarni", email: "sales@shreesteel.in", phone: "+91 98200 11223", address: "Kalbadevi Road", city: "Mumbai", state: "Maharashtra", paymentTermsDays: 30, leadTimeDays: 7, active: true },
    { id: "v2", code: "VND002", name: "Om Packaging Co", gstin: null, contact: "Sunita Shah", email: "om.pack@gmail.com", phone: "+91 98111 44556", address: "MIDC Phase II", city: "Pune", state: "Maharashtra", paymentTermsDays: 15, leadTimeDays: 4, active: true },
    { id: "v3", code: "VND003", name: "Bharat Electricals", gstin: "27AACCB2230C1ZK", contact: "Ramesh Iyer", email: "sales@bharatelec.in", phone: "+91 99670 77889", address: "Lamington Road", city: "Mumbai", state: "Maharashtra", paymentTermsDays: 45, leadTimeDays: 10, active: true },
  ]
  const items: Item[] = [
    { id: "i1", code: "ITM001", name: "MS Sheet 2mm", category: "Raw Material", unit: "KG", hsn: "7208", gstRatePct: 18, lastPricePaise: 6_500, active: true },
    { id: "i2", code: "ITM002", name: "Corrugated Box 18×12×10", category: "Packaging", unit: "PCS", hsn: "4819", gstRatePct: 12, lastPricePaise: 3_200, active: true },
    { id: "i3", code: "ITM003", name: "Machine Oil SAE-40", category: "Consumables", unit: "L", hsn: "2710", gstRatePct: 18, lastPricePaise: 28_000, active: true },
    { id: "i4", code: "ITM004", name: "Nitrile Gloves (100)", category: "Safety", unit: "BOX", hsn: "4015", gstRatePct: 12, lastPricePaise: 45_000, active: true },
    { id: "i5", code: "ITM005", name: "MCB 32A C-Curve", category: "Electrical", unit: "PCS", hsn: "8536", gstRatePct: 18, lastPricePaise: 21_500, active: true },
  ]
  const pos: PurchaseOrder[] = [
    {
      id: "po1", number: "PO-2026-0001", vendorId: "v1", orderDate: "2026-07-06", status: "APPROVED",
      lines: [{ id: "pol1", itemId: "i1", qty: 500, unitPricePaise: 6_500, gstRatePct: 18, discountPct: 0 }],
      schedules: [
        { id: "sch1", poLineId: "pol1", dueDate: "2026-07-14", qty: 300 },
        { id: "sch2", poLineId: "pol1", dueDate: "2026-07-24", qty: 200 },
      ],
      terms: "Delivery at Mumbai HO stores. Freight included.", notes: "",
      createdBy: "ops@delta.dev", approvedBy: "admin@delta.dev", rejectionReason: null,
    },
    {
      id: "po2", number: "PO-2026-0002", vendorId: "v2", orderDate: "2026-07-20", status: "APPROVED",
      lines: [{ id: "pol2", itemId: "i2", qty: 1000, unitPricePaise: 3_200, gstRatePct: 12, discountPct: 5 }],
      schedules: [{ id: "sch3", poLineId: "pol2", dueDate: "2026-07-26", qty: 1000 }],
      terms: "", notes: "Monsoon stock.",
      createdBy: "ops@delta.dev", approvedBy: "admin@delta.dev", rejectionReason: null,
    },
    {
      id: "po3", number: "PO-2026-0003", vendorId: "v1", orderDate: "2026-08-01", status: "PENDING_APPROVAL",
      lines: [{ id: "pol3", itemId: "i3", qty: 100, unitPricePaise: 27_500, gstRatePct: 18, discountPct: 0 }],
      schedules: [{ id: "sch4", poLineId: "pol3", dueDate: "2026-08-10", qty: 100 }],
      terms: "", notes: "",
      createdBy: "ops@delta.dev", approvedBy: null, rejectionReason: null,
    },
  ]
  const grns: Grn[] = [
    {
      id: "grn1", number: "GRN-2026-0001", poId: "po1", receivedDate: "2026-07-13",
      invoiceNo: "SST/1142", remarks: "", recordedBy: "ops@delta.dev",
      lines: [{ poLineId: "pol1", qtyAccepted: 300, qtyRejected: 0, remarks: "" }],
    },
    {
      id: "grn2", number: "GRN-2026-0002", poId: "po1", receivedDate: "2026-07-28",
      invoiceNo: "SST/1201", remarks: "Short supply, balance promised", recordedBy: "ops@delta.dev",
      lines: [{ poLineId: "pol1", qtyAccepted: 150, qtyRejected: 10, remarks: "10 KG rusted, rejected" }],
    },
    {
      id: "grn3", number: "GRN-2026-0003", poId: "po2", receivedDate: "2026-07-25",
      invoiceNo: "OMP/889", remarks: "", recordedBy: "ops@delta.dev",
      lines: [{ poLineId: "pol2", qtyAccepted: 1000, qtyRejected: 0, remarks: "" }],
    },
  ]
  return { vendors, items, pos, grns, seq: { po: 3, grn: 3, entity: 1 } }
}

export function ProcurementProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ProcurementState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw) as ProcurementState
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
    return seedState()
  })

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const value = React.useMemo<ProcurementValue>(() => {
    const nextId = (prefix: string, state: ProcurementState) =>
      `${prefix}_${state.seq.entity}`

    const bumpEntity = (state: ProcurementState): ProcurementState => ({
      ...state,
      seq: { ...state.seq, entity: state.seq.entity + 1 },
    })

    const patchPo = (poId: string, patch: (po: PurchaseOrder) => Partial<PurchaseOrder>) =>
      setState((prev) => ({
        ...prev,
        pos: prev.pos.map((po) => (po.id === poId ? { ...po, ...patch(po) } : po)),
      }))

    return {
      ...state,

      upsertVendor: (vendor) => {
        const saved: Vendor = { ...vendor, id: vendor.id ?? `v_${state.seq.entity}` }
        setState((prev) =>
          bumpEntity({
            ...prev,
            vendors: vendor.id
              ? prev.vendors.map((candidate) => (candidate.id === vendor.id ? saved : candidate))
              : [...prev.vendors, { ...saved, id: `v_${prev.seq.entity}` }],
          })
        )
        return saved
      },

      upsertItem: (item) => {
        const saved: Item = { ...item, id: item.id ?? `i_${state.seq.entity}` }
        setState((prev) =>
          bumpEntity({
            ...prev,
            items: item.id
              ? prev.items.map((candidate) => (candidate.id === item.id ? saved : candidate))
              : [...prev.items, { ...saved, id: `i_${prev.seq.entity}` }],
          })
        )
        return saved
      },

      createPo: (draft, createdBy) => {
        const year = Number(draft.orderDate.slice(0, 4))
        const po: PurchaseOrder = {
          id: `po_${state.seq.entity}`,
          number: formatDocNumber("PO", year, state.seq.po + 1),
          vendorId: draft.vendorId,
          orderDate: draft.orderDate,
          status: "DRAFT",
          lines: [],
          schedules: [],
          terms: draft.terms,
          notes: draft.notes,
          createdBy,
          approvedBy: null,
          rejectionReason: null,
        }
        const lines: PoLine[] = []
        const schedules: PoSchedule[] = []
        draft.lines.forEach((draftLine, lineIndex) => {
          const item = state.items.find((candidate) => candidate.id === draftLine.itemId)
          const line: PoLine = {
            id: `${po.id}_l${lineIndex}`,
            itemId: draftLine.itemId,
            qty: draftLine.qty,
            unitPricePaise: draftLine.unitPricePaise,
            // Copied at order time — a later slab change must not reprice history.
            gstRatePct: item?.gstRatePct ?? 18,
            discountPct: draftLine.discountPct,
          }
          lines.push(line)
          draftLine.schedules.forEach((tranche, trancheIndex) =>
            schedules.push({
              id: `${line.id}_s${trancheIndex}`,
              poLineId: line.id,
              dueDate: tranche.dueDate,
              qty: tranche.qty,
            })
          )
        })
        po.lines = lines
        po.schedules = schedules
        setState((prev) => ({
          ...prev,
          pos: [...prev.pos, po],
          seq: { ...prev.seq, po: prev.seq.po + 1, entity: prev.seq.entity + 1 },
        }))
        return po
      },

      submitPo: (poId) => patchPo(poId, () => ({ status: "PENDING_APPROVAL" })),

      decidePo: (poId, action, decidedBy, reason = "") => {
        if (action === "APPROVE") {
          // The agreed price becomes the item's default for the next PO.
          setState((prev) => {
            const po = prev.pos.find((candidate) => candidate.id === poId)
            if (!po) return prev
            return {
              ...prev,
              items: prev.items.map((item) => {
                const line = po.lines.find((candidate) => candidate.itemId === item.id)
                return line ? { ...item, lastPricePaise: line.unitPricePaise } : item
              }),
              pos: prev.pos.map((candidate) =>
                candidate.id === poId
                  ? { ...candidate, status: "APPROVED", approvedBy: decidedBy }
                  : candidate
              ),
            }
          })
        } else {
          patchPo(poId, () => ({ status: "REJECTED", rejectionReason: reason }))
        }
      },

      cancelPo: (poId) => patchPo(poId, () => ({ status: "CANCELLED" })),
      closePo: (poId) => patchPo(poId, () => ({ status: "CLOSED" })),

      recordGrn: (poId, grn, recordedBy) => {
        const saved: Grn = {
          id: nextId("grn", state),
          number: formatDocNumber("GRN", Number(grn.receivedDate.slice(0, 4)), state.seq.grn + 1),
          poId,
          receivedDate: grn.receivedDate,
          invoiceNo: grn.invoiceNo,
          remarks: grn.remarks,
          recordedBy,
          lines: grn.lines,
        }
        setState((prev) => ({
          ...prev,
          grns: [...prev.grns, saved],
          seq: { ...prev.seq, grn: prev.seq.grn + 1, entity: prev.seq.entity + 1 },
        }))
        return saved
      },
    }
  }, [state])

  return <ProcurementContext.Provider value={value}>{children}</ProcurementContext.Provider>
}

export function useProcurement() {
  const context = React.useContext(ProcurementContext)
  if (!context) throw new Error("useProcurement must be used inside ProcurementProvider")
  return context
}

/** Default one-lot schedule for a new line: order date + the vendor's lead time. */
export function defaultDueDate(orderDate: string, vendor: Vendor | undefined): string {
  return shiftDateISO(orderDate, vendor?.leadTimeDays ?? 7)
}

export const todayISO = (): string => new Date().toISOString().slice(0, 10)
