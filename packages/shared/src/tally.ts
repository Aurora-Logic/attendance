/**
 * Tally integration — voucher XML the way Tally Prime / ERP 9 imports it:
 * an ENVELOPE of TALLYMESSAGE VOUCHER blocks, consumed either through
 * Gateway of Tally → Import Data, or POSTed to Tally's HTTP gateway
 * (default port 9000 with "Enable ODBC/HTTP" on).
 *
 * Conventions that matter and are easy to get wrong:
 * - Dates are YYYYMMDD.
 * - Amounts are rupees with two decimals. Tally's sign convention: a DEBIT
 *   line is ISDEEMEDPOSITIVE=Yes with a NEGATIVE amount; a CREDIT line is
 *   ISDEEMEDPOSITIVE=No with a POSITIVE amount.
 * - The voucher must balance. We refuse to build one that doesn't — a
 *   lopsided journal silently corrupts books downstream.
 * - Ledger names must already exist in Tally (masters are created there,
 *   not here) — the in-app guide walks through that.
 */

export interface TallyLine {
  ledger: string
  amountPaise: number
  type: "Dr" | "Cr"
}

export interface TallyVoucherInput {
  company: string
  voucherType: "Journal" | "Payment" | "Receipt" | "Sales"
  voucherNumber: string
  /** Business date, YYYY-MM-DD. */
  dateISO: string
  narration: string
  lines: TallyLine[]
}

export function tallyEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

export function tallyDate(dateISO: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) throw new Error(`Bad date for Tally: ${dateISO}`)
  return dateISO.replaceAll("-", "")
}

/** Paise → "12345.67". Tally wants rupees; we never do float rupee math. */
export function paiseToTallyAmount(paise: number): string {
  const rupees = Math.trunc(paise / 100)
  const rest = Math.abs(paise % 100)
  return `${rupees}.${String(rest).padStart(2, "0")}`
}

const line = (entry: TallyLine): string => {
  const signed = entry.type === "Dr" ? -entry.amountPaise : entry.amountPaise
  return [
    "      <ALLLEDGERENTRIES.LIST>",
    `       <LEDGERNAME>${tallyEscape(entry.ledger)}</LEDGERNAME>`,
    `       <ISDEEMEDPOSITIVE>${entry.type === "Dr" ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
    `       <AMOUNT>${paiseToTallyAmount(signed)}</AMOUNT>`,
    "      </ALLLEDGERENTRIES.LIST>",
  ].join("\n")
}

export function buildTallyVoucherXml(input: TallyVoucherInput): string {
  if (input.lines.length < 2) throw new Error("A voucher needs at least two ledger lines")
  if (input.lines.some((entry) => entry.amountPaise <= 0 || !Number.isInteger(entry.amountPaise)))
    throw new Error("Ledger amounts must be positive integer paise")
  const dr = input.lines.filter((entry) => entry.type === "Dr").reduce((sum, entry) => sum + entry.amountPaise, 0)
  const cr = input.lines.filter((entry) => entry.type === "Cr").reduce((sum, entry) => sum + entry.amountPaise, 0)
  if (dr !== cr)
    throw new Error(`Voucher does not balance: Dr ${paiseToTallyAmount(dr)} vs Cr ${paiseToTallyAmount(cr)}`)

  const date = tallyDate(input.dateISO)
  return [
    '<ENVELOPE>',
    ' <HEADER>',
    '  <TALLYREQUEST>Import Data</TALLYREQUEST>',
    ' </HEADER>',
    ' <BODY>',
    '  <IMPORTDATA>',
    '   <REQUESTDESC>',
    '    <REPORTNAME>Vouchers</REPORTNAME>',
    '    <STATICVARIABLES>',
    `     <SVCURRENTCOMPANY>${tallyEscape(input.company)}</SVCURRENTCOMPANY>`,
    '    </STATICVARIABLES>',
    '   </REQUESTDESC>',
    '   <REQUESTDATA>',
    '    <TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `     <VOUCHER VCHTYPE="${input.voucherType}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `      <DATE>${date}</DATE>`,
    `      <EFFECTIVEDATE>${date}</EFFECTIVEDATE>`,
    `      <VOUCHERTYPENAME>${input.voucherType}</VOUCHERTYPENAME>`,
    `      <VOUCHERNUMBER>${tallyEscape(input.voucherNumber)}</VOUCHERNUMBER>`,
    `      <NARRATION>${tallyEscape(input.narration)}</NARRATION>`,
    input.lines.map(line).join("\n"),
    '     </VOUCHER>',
    '    </TALLYMESSAGE>',
    '   </REQUESTDATA>',
    '  </IMPORTDATA>',
    ' </BODY>',
    '</ENVELOPE>',
  ].join("\n")
}

export interface PayrollJournalInput {
  company: string
  /** YYYY-MM. Voucher is dated the last day of the month. */
  month: string
  items: Array<{ name: string; code: string; grossPaise: number }>
  expenseLedger: string
  payableLedger: string
  /** true → one credit line per employee ("Name (CODE)"); false → one control line. */
  perEmployeeLedgers: boolean
}

/**
 * The month's salary journal: Dr expense by total gross, Cr payable — either
 * one control ledger or one ledger per employee. Zero-gross employees are
 * skipped (a zero AMOUNT line makes Tally imports fail).
 */
export function buildPayrollJournal(input: PayrollJournalInput): string {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error(`Bad month: ${input.month}`)
  const paid = input.items.filter((item) => item.grossPaise > 0)
  const total = paid.reduce((sum, item) => sum + item.grossPaise, 0)
  if (total === 0) throw new Error("Nothing payable this month — no voucher to build")

  const [year, monthIndex] = [Number(input.month.slice(0, 4)), Number(input.month.slice(5, 7))]
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  const dateISO = `${input.month}-${String(lastDay).padStart(2, "0")}`

  const credits: TallyLine[] = input.perEmployeeLedgers
    ? paid.map((item) => ({
        ledger: `${item.name} (${item.code})`,
        amountPaise: item.grossPaise,
        type: "Cr" as const,
      }))
    : [{ ledger: input.payableLedger, amountPaise: total, type: "Cr" }]

  return buildTallyVoucherXml({
    company: input.company,
    voucherType: "Journal",
    voucherNumber: `PAY/${input.month}`,
    dateISO,
    narration: `Salary for ${input.month} — ${paid.length} employees, generated by attendance system`,
    lines: [{ ledger: input.expenseLedger, amountPaise: total, type: "Dr" }, ...credits],
  })
}
