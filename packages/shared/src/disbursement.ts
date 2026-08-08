import * as z from "zod"

/**
 * Paying people: the bank details a salary transfer needs, and the NEFT/RTGS
 * upload row Indian banks accept. Kept in shared because both the API (which
 * builds the file) and the web app (which validates the form) must agree on
 * exactly what "payable" means.
 */

/**
 * IFSC: four letters, then 0, then six alphanumerics — e.g. HDFC0001234.
 * The fifth character is always zero; that rule catches most typos.
 */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
/** PAN: five letters, four digits, one letter — ABCDE1234F. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
/** UAN is exactly twelve digits. */
export const UAN_PATTERN = /^[0-9]{12}$/

export const bankDetailsSchema = z.object({
  accountName: z.string().min(2).max(80),
  accountNumber: z.string().regex(/^[0-9]{6,20}$/, "6–20 digits, no spaces."),
  ifsc: z.string().regex(IFSC_PATTERN, "Format: HDFC0001234."),
  bankName: z.string().max(80).default(""),
  pan: z.union([z.string().regex(PAN_PATTERN, "Format: ABCDE1234F."), z.literal("")]).default(""),
  uan: z.union([z.string().regex(UAN_PATTERN, "Exactly 12 digits."), z.literal("")]).default(""),
})
export type BankDetails = z.infer<typeof bankDetailsSchema>

export interface DisbursementRow {
  employeeId: string
  code: string
  name: string
  amountPaise: number
  bank: BankDetails | null
}

export interface DisbursementSplit {
  /** Rows that can be paid by transfer right now. */
  payable: Array<DisbursementRow & { bank: BankDetails }>
  /** Rows held back, each with the reason a human can act on. */
  held: Array<{ row: DisbursementRow; reason: string }>
  totalPayablePaise: number
}

/**
 * Split a run into "can be transferred" and "needs attention". A missing
 * account is not an error to swallow — it is a person who will not be paid,
 * so it surfaces as its own list rather than being dropped from the file.
 */
export function splitForDisbursement(rows: DisbursementRow[]): DisbursementSplit {
  const payable: DisbursementSplit["payable"] = []
  const held: DisbursementSplit["held"] = []

  for (const row of rows) {
    if (row.amountPaise <= 0) {
      held.push({ row, reason: "Nothing payable this month" })
      continue
    }
    if (!row.bank) {
      held.push({ row, reason: "No bank details on record" })
      continue
    }
    if (!IFSC_PATTERN.test(row.bank.ifsc)) {
      held.push({ row, reason: `IFSC looks wrong: ${row.bank.ifsc || "empty"}` })
      continue
    }
    if (!/^[0-9]{6,20}$/.test(row.bank.accountNumber)) {
      held.push({ row, reason: "Account number looks wrong" })
      continue
    }
    payable.push({ ...row, bank: row.bank })
  }

  return {
    payable,
    held,
    totalPayablePaise: payable.reduce((sum, row) => sum + row.amountPaise, 0),
  }
}

/** Rupees with two decimals — what bank upload templates expect. */
export const paiseToRupeeString = (paise: number): string =>
  `${Math.trunc(paise / 100)}.${String(Math.abs(paise % 100)).padStart(2, "0")}`

/**
 * A bank's bulk-transfer CSV. Banks differ in column order, so this is the
 * common shape (the one HDFC/ICICI/SBI corporate templates all accept after a
 * header remap) rather than a claim to be any one bank's exact format.
 *
 * Values are quoted and internal quotes doubled: a name containing a comma
 * must not shift every later column.
 */
export function buildBankTransferCsv(
  split: DisbursementSplit,
  meta: { month: string; debitAccount: string }
): string {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
  const header = [
    "Beneficiary Name",
    "Account Number",
    "IFSC",
    "Amount",
    "Transaction Type",
    "Debit Account",
    "Narration",
  ]
  const lines = [header.map(escape).join(",")]

  for (const row of split.payable) {
    // NEFT below ₹2,00,000, RTGS at or above — the usual Indian threshold.
    const mode = row.amountPaise >= 20_000_000 ? "RTGS" : "NEFT"
    lines.push(
      [
        escape(row.bank.accountName),
        escape(row.bank.accountNumber),
        escape(row.bank.ifsc),
        escape(paiseToRupeeString(row.amountPaise)),
        escape(mode),
        escape(meta.debitAccount),
        escape(`Salary ${meta.month} ${row.code}`),
      ].join(",")
    )
  }
  return lines.join("\r\n")
}
