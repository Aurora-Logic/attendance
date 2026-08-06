import * as React from "react"
import {
  allocateOldestFirst,
  formatDocNumber,
  outstandingPaise,
  shiftDateISO,
  type Grn,
  type GrnLine,
  type Indent,
  type Item,
  type PaymentEntry,
  type PoLine,
  type PoSchedule,
  type PurchaseOrder,
  type StockAdjustment,
  type Vendor,
  type VendorBill,
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
  /** Master lists for the item form's pickers — grown inline, never typo'd. */
  brands: string[]
  categories: string[]
  pos: PurchaseOrder[]
  grns: Grn[]
  vendorBills: VendorBill[]
  /** Money paid to vendors, allocated to bills. */
  payments: PaymentEntry[]
  indents: Indent[]
  stockAdjustments: StockAdjustment[]
  seq: { po: number; grn: number; ind: number; entity: number }
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
  addBrand: (brand: string) => void
  addCategory: (category: string) => void
  createPo: (draft: PoDraft, createdBy: string) => PurchaseOrder
  /** Rewrite a DRAFT in place — the one lifecycle stage where editing is honest. */
  updatePoDraft: (poId: string, draft: PoDraft) => boolean
  submitPo: (poId: string) => void
  decidePo: (poId: string, action: "APPROVE" | "REJECT", decidedBy: string, reason?: string) => void
  cancelPo: (poId: string) => void
  closePo: (poId: string) => void
  recordGrn: (
    poId: string,
    grn: { receivedDate: string; invoiceNo: string; remarks: string; lines: GrnLine[] },
    recordedBy: string
  ) => Grn
  recordBill: (bill: Omit<VendorBill, "id" | "status" | "recordedBy">, recordedBy: string) => VendorBill
  /** Refused once any payment is allocated — money history is never orphaned. */
  cancelBill: (billId: string) => boolean
  /** Auto-allocates oldest-due-first across the vendor's open bills. */
  recordPayment: (
    input: Omit<PaymentEntry, "id" | "allocations" | "recordedBy">,
    recordedBy: string
  ) => PaymentEntry | null
  createIndent: (
    indent: Omit<Indent, "id" | "number" | "status" | "decisionNote" | "poId">,
  ) => Indent
  decideIndent: (indentId: string, action: "APPROVE" | "REJECT", note?: string) => void
  markIndentOrdered: (indentId: string, poId: string) => void
  adjustStock: (adjustment: Omit<StockAdjustment, "id" | "recordedBy">, recordedBy: string) => void
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
    { id: "i1", code: "ITM001", name: "MS Sheet 2mm", brand: "Tata Steel", category: "Raw Material", unit: "KG", hsn: "7208", gstRatePct: 18, lastPricePaise: 6_500, salePricePaise: 6_500, reorderLevel: 0, active: true },
    { id: "i2", code: "ITM002", name: "Corrugated Box 18×12×10", brand: "", category: "Packaging", unit: "PCS", hsn: "4819", gstRatePct: 12, lastPricePaise: 3_200, salePricePaise: 3_200, reorderLevel: 0, active: true },
    { id: "i3", code: "ITM003", name: "Machine Oil SAE-40", brand: "Castrol", category: "Consumables", unit: "L", hsn: "2710", gstRatePct: 18, lastPricePaise: 28_000, salePricePaise: 28_000, reorderLevel: 0, active: true },
    { id: "i4", code: "ITM004", name: "Nitrile Gloves (100)", brand: "3M", category: "Safety", unit: "BOX", hsn: "4015", gstRatePct: 12, lastPricePaise: 45_000, salePricePaise: 45_000, reorderLevel: 0, active: true },
    { id: "i5", code: "ITM005", name: "MCB 32A C-Curve", brand: "Havells", category: "Electrical", unit: "PCS", hsn: "8536", gstRatePct: 18, lastPricePaise: 21_500, salePricePaise: 21_500, reorderLevel: 0, active: true },
  ]
  const brands = ["Tata Steel", "Castrol", "3M", "Havells"]
  const categories = ["Raw Material", "Packaging", "Consumables", "Safety", "Electrical"]
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
  return {
    vendors,
    items,
    brands,
    categories,
    pos,
    grns,
    vendorBills: [],
    payments: [],
    indents: [],
    stockAdjustments: [],
    seq: { po: 3, grn: 3, ind: 0, entity: 1 },
  }
}

/** A blob saved before a field existed must never brick the app. */
function normalizeState(raw: ProcurementState): ProcurementState {
  const items = raw.items.map((item) => ({ ...item, brand: item.brand ?? "" }))
  const fromItems = (pick: (item: Item) => string) =>
    [...new Set(items.map(pick).filter(Boolean))]
  return {
    ...raw,
    items,
    brands: raw.brands ?? fromItems((item) => item.brand),
    categories: raw.categories ?? fromItems((item) => item.category),
    vendorBills: raw.vendorBills ?? [],
    payments: raw.payments ?? [],
    indents: raw.indents ?? [],
    stockAdjustments: raw.stockAdjustments ?? [],
    seq: { ...raw.seq, ind: raw.seq.ind ?? 0 },
  }
}

export function ProcurementProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ProcurementState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return normalizeState(JSON.parse(raw) as ProcurementState)
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

    const register = (list: string[], value: string) =>
      value.trim() && !list.includes(value.trim()) ? [...list, value.trim()] : list

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
            // A brand/category typed fresh on the form joins the master list.
            brands: register(prev.brands, saved.brand),
            categories: register(prev.categories, saved.category),
          })
        )
        return saved
      },

      addBrand: (brand) =>
        setState((prev) => ({ ...prev, brands: register(prev.brands, brand) })),

      addCategory: (category) =>
        setState((prev) => ({ ...prev, categories: register(prev.categories, category) })),

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

      updatePoDraft: (poId, draft) => {
        const po = state.pos.find((candidate) => candidate.id === poId)
        if (!po || po.status !== "DRAFT") return false
        const lines: PoLine[] = []
        const schedules: PoSchedule[] = []
        draft.lines.forEach((draftLine, lineIndex) => {
          const item = state.items.find((candidate) => candidate.id === draftLine.itemId)
          const line: PoLine = {
            id: `${poId}_l${lineIndex}`,
            itemId: draftLine.itemId,
            qty: draftLine.qty,
            unitPricePaise: draftLine.unitPricePaise,
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
        patchPo(poId, () => ({
          vendorId: draft.vendorId,
          orderDate: draft.orderDate,
          terms: draft.terms,
          notes: draft.notes,
          lines,
          schedules,
        }))
        return true
      },

      cancelBill: (billId) => {
        const bill = state.vendorBills.find((candidate) => candidate.id === billId)
        if (!bill || bill.status !== "OPEN") return false
        const allocated = state.payments.some((payment) =>
          payment.allocations.some((allocation) => allocation.docId === billId)
        )
        if (allocated) return false
        setState((prev) => ({
          ...prev,
          vendorBills: prev.vendorBills.map((bill) =>
            bill.id === billId ? { ...bill, status: "CANCELLED" } : bill
          ),
        }))
        return true
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

      recordBill: (bill, recordedBy) => {
        const saved: VendorBill = { id: `vb_${state.seq.entity}`, status: "OPEN", recordedBy, ...bill }
        setState((prev) => ({
          ...prev,
          vendorBills: [...prev.vendorBills, saved],
          seq: { ...prev.seq, entity: prev.seq.entity + 1 },
        }))
        return saved
      },

      recordPayment: (input, recordedBy) => {
        const allocations = allocateOldestFirst(
          input.amountPaise,
          state.vendorBills
            .filter((bill) => bill.vendorId === input.partyId && bill.status === "OPEN")
            .map((bill) => ({
              id: bill.id,
              dueDate: bill.dueDate,
              outstandingPaise: outstandingPaise(bill, state.payments),
            }))
        )
        if (allocations.length === 0) return null
        // Excess money must never vanish into unallocated air.
        const allocatable = allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0)
        if (input.amountPaise > allocatable) return null
        const payment: PaymentEntry = { id: `pay_${state.seq.entity}`, recordedBy, ...input, allocations }
        setState((prev) => ({
          ...prev,
          payments: [...prev.payments, payment],
          seq: { ...prev.seq, entity: prev.seq.entity + 1 },
        }))
        return payment
      },

      createIndent: (indent) => {
        const saved: Indent = {
          id: `ind_${state.seq.entity}`,
          number: formatDocNumber("IND", Number(indent.date.slice(0, 4)), state.seq.ind + 1),
          status: "PENDING",
          decisionNote: "",
          poId: null,
          ...indent,
        }
        setState((prev) => ({
          ...prev,
          indents: [...prev.indents, saved],
          seq: { ...prev.seq, ind: prev.seq.ind + 1, entity: prev.seq.entity + 1 },
        }))
        return saved
      },

      decideIndent: (indentId, action, note = "") =>
        setState((prev) => ({
          ...prev,
          indents: prev.indents.map((indent) =>
            indent.id === indentId
              ? {
                  ...indent,
                  status: action === "APPROVE" ? "APPROVED" : "REJECTED",
                  decisionNote: note,
                }
              : indent
          ),
        })),

      markIndentOrdered: (indentId, poId) =>
        setState((prev) => ({
          ...prev,
          indents: prev.indents.map((indent) =>
            indent.id === indentId ? { ...indent, status: "ORDERED", poId } : indent
          ),
        })),

      adjustStock: (adjustment, recordedBy) =>
        setState((prev) => ({
          ...prev,
          stockAdjustments: [
            ...prev.stockAdjustments,
            { id: `adj_${prev.seq.entity}`, recordedBy, ...adjustment },
          ],
          seq: { ...prev.seq, entity: prev.seq.entity + 1 },
        })),
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
