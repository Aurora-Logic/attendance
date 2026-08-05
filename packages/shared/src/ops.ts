import * as z from "zod"

/**
 * Small operational modules: purchase indents (department requisitions that
 * become POs) and employee expense claims. Both are request → decision flows;
 * both keep the decision and its reason on the record.
 */

/* ------------------------------------------------------------------ indents */

export const INDENT_STATUS = ["PENDING", "APPROVED", "REJECTED", "ORDERED"] as const
export const indentSchema = z.object({
  id: z.string(),
  /** IND-2026-0001. */
  number: z.string(),
  department: z.string().min(1),
  requestedBy: z.string().default(""),
  date: z.string(),
  status: z.enum(INDENT_STATUS),
  neededBy: z.string().nullable().default(null),
  note: z.string().default(""),
  decisionNote: z.string().default(""),
  /** The PO raised from this indent, once ordered. */
  poId: z.string().nullable().default(null),
  lines: z
    .array(z.object({ itemId: z.string(), qty: z.number().positive(), note: z.string().default("") }))
    .min(1),
})
export type Indent = z.infer<typeof indentSchema>

/* ----------------------------------------------------------- expense claims */

export const EXPENSE_STATUS = ["PENDING", "APPROVED", "REJECTED", "REIMBURSED"] as const
export const EXPENSE_CATEGORIES = [
  "Travel",
  "Food",
  "Fuel",
  "Supplies",
  "Communication",
  "Other",
] as const

export const expenseClaimSchema = z.object({
  id: z.string(),
  /** EXP-2026-0001. */
  number: z.string(),
  employeeEmail: z.string(),
  employeeName: z.string().default(""),
  date: z.string(),
  category: z.enum(EXPENSE_CATEGORIES),
  amountPaise: z.number().int().positive(),
  description: z.string().min(3),
  status: z.enum(EXPENSE_STATUS),
  decidedBy: z.string().default(""),
  decisionNote: z.string().default(""),
  /** Stamped when payroll (or petty cash) actually pays it out. */
  reimbursedOn: z.string().nullable().default(null),
})
export type ExpenseClaim = z.infer<typeof expenseClaimSchema>
