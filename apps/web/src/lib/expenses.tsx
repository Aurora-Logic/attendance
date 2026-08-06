import * as React from "react"
import { formatDocNumber, type ExpenseClaim } from "@attendance/shared"

/**
 * Expense claims store, mirroring apps/api/src/ops.ts — claim → decide (never
 * your own) → reimburse, with the reason on record at every step.
 */

interface ExpensesState {
  claims: ExpenseClaim[]
  seq: { exp: number }
}

interface ExpensesValue extends ExpensesState {
  createClaim: (
    claim: Pick<ExpenseClaim, "date" | "category" | "amountPaise" | "description">,
    employee: { email: string; name: string }
  ) => ExpenseClaim
  decideClaim: (claimId: string, action: "APPROVE" | "REJECT", decidedBy: string, note?: string) => void
  reimburseClaim: (claimId: string, onISO: string) => void
}

const ExpensesContext = React.createContext<ExpensesValue | null>(null)

const STORAGE_KEY = "attendance.expenses.v1"

export function ExpensesProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ExpensesState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw) as ExpensesState
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
    return { claims: [], seq: { exp: 0 } }
  })

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const value = React.useMemo<ExpensesValue>(() => {
    const patch = (claimId: string, updates: Partial<ExpenseClaim>) =>
      setState((prev) => ({
        ...prev,
        claims: prev.claims.map((claim) =>
          claim.id === claimId ? { ...claim, ...updates } : claim
        ),
      }))

    return {
      ...state,

      createClaim: (claim, employee) => {
        const saved: ExpenseClaim = {
          id: `exp_${state.seq.exp + 1}`,
          number: formatDocNumber("EXP", Number(claim.date.slice(0, 4)), state.seq.exp + 1),
          status: "PENDING",
          decidedBy: "",
          decisionNote: "",
          reimbursedOn: null,
          employeeEmail: employee.email,
          employeeName: employee.name,
          ...claim,
        }
        setState((prev) => ({
          claims: [...prev.claims, saved],
          seq: { exp: prev.seq.exp + 1 },
        }))
        return saved
      },

      decideClaim: (claimId, action, decidedBy, note = "") =>
        patch(claimId, {
          status: action === "APPROVE" ? "APPROVED" : "REJECTED",
          decidedBy,
          decisionNote: note,
        }),

      reimburseClaim: (claimId, onISO) =>
        patch(claimId, { status: "REIMBURSED", reimbursedOn: onISO }),
    }
  }, [state])

  return <ExpensesContext.Provider value={value}>{children}</ExpensesContext.Provider>
}

export function useExpenses() {
  const context = React.useContext(ExpensesContext)
  if (!context) throw new Error("useExpenses must be used inside ExpensesProvider")
  return context
}
