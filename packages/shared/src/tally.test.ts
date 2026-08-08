import { describe, expect, it } from "vitest"

import {
  buildPayrollJournal,
  buildTallyVoucherXml,
  paiseToTallyAmount,
  tallyDate,
  tallyEscape,
} from "./tally"

describe("tally primitives", () => {
  it("escapes the five XML metacharacters", () => {
    expect(tallyEscape(`Salary & Wages <"Aug" '26'>`)).toBe(
      "Salary &amp; Wages &lt;&quot;Aug&quot; &apos;26&apos;&gt;"
    )
  })

  it("formats dates as YYYYMMDD and refuses garbage", () => {
    expect(tallyDate("2026-08-31")).toBe("20260831")
    expect(() => tallyDate("31/08/2026")).toThrow()
  })

  it("renders paise as rupee strings without float math", () => {
    expect(paiseToTallyAmount(1234567)).toBe("12345.67")
    expect(paiseToTallyAmount(-900000)).toBe("-9000.00")
    expect(paiseToTallyAmount(5)).toBe("0.05")
  })
})

describe("buildTallyVoucherXml", () => {
  const lines = [
    { ledger: "Salary & Wages", amountPaise: 900000, type: "Dr" as const },
    { ledger: "Salary Payable", amountPaise: 900000, type: "Cr" as const },
  ]

  it("builds a balanced journal with Tally's sign convention", () => {
    const xml = buildTallyVoucherXml({
      company: "Delta Attendance",
      voucherType: "Journal",
      voucherNumber: "PAY/2026-08",
      dateISO: "2026-08-31",
      narration: "Salary for 2026-08",
      lines,
    })
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>")
    expect(xml).toContain("<SVCURRENTCOMPANY>Delta Attendance</SVCURRENTCOMPANY>")
    expect(xml).toContain("<DATE>20260831</DATE>")
    // Debit: deemed positive, negative amount. Credit: the reverse.
    expect(xml).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n       <AMOUNT>-9000.00</AMOUNT>")
    expect(xml).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n       <AMOUNT>9000.00</AMOUNT>")
    expect(xml).toContain("Salary &amp; Wages")
  })

  it("refuses an unbalanced voucher", () => {
    expect(() =>
      buildTallyVoucherXml({
        company: "X",
        voucherType: "Journal",
        voucherNumber: "1",
        dateISO: "2026-08-31",
        narration: "",
        lines: [
          { ledger: "A", amountPaise: 100, type: "Dr" },
          { ledger: "B", amountPaise: 99, type: "Cr" },
        ],
      })
    ).toThrow(/does not balance/)
  })

  it("refuses zero, negative and fractional paise lines", () => {
    for (const amountPaise of [0, -5, 10.5]) {
      expect(() =>
        buildTallyVoucherXml({
          company: "X",
          voucherType: "Journal",
          voucherNumber: "1",
          dateISO: "2026-08-31",
          narration: "",
          lines: [
            { ledger: "A", amountPaise, type: "Dr" },
            { ledger: "B", amountPaise, type: "Cr" },
          ],
        })
      ).toThrow()
    }
  })
})

describe("buildPayrollJournal", () => {
  const items = [
    { name: "Kabir Singh", code: "DLT0004", grossPaise: 900000 },
    { name: "Meera Joshi", code: "DLT0005", grossPaise: 350050 },
    { name: "Unpaid Intern", code: "DLT0099", grossPaise: 0 },
  ]

  it("control-ledger mode: one Dr, one Cr, dated month-end, zero-gross skipped", () => {
    const xml = buildPayrollJournal({
      company: "Delta",
      month: "2026-08",
      items,
      expenseLedger: "Salary & Wages",
      payableLedger: "Salary Payable",
      perEmployeeLedgers: false,
    })
    expect(xml).toContain("<DATE>20260831</DATE>")
    expect(xml).toContain("<AMOUNT>-12500.50</AMOUNT>")
    expect(xml).toContain("<AMOUNT>12500.50</AMOUNT>")
    expect(xml).toContain("2 employees")
    expect(xml).not.toContain("Unpaid Intern")
  })

  it("per-employee mode: one credit line per paid employee, still balanced", () => {
    const xml = buildPayrollJournal({
      company: "Delta",
      month: "2026-02",
      items,
      expenseLedger: "Salary & Wages",
      payableLedger: "unused",
      perEmployeeLedgers: true,
    })
    expect(xml).toContain("Kabir Singh (DLT0004)")
    expect(xml).toContain("Meera Joshi (DLT0005)")
    expect(xml).toContain("<AMOUNT>9000.00</AMOUNT>")
    expect(xml).toContain("<AMOUNT>3500.50</AMOUNT>")
    expect(xml).toContain("<DATE>20260228</DATE>")
  })

  it("refuses an all-zero month", () => {
    expect(() =>
      buildPayrollJournal({
        company: "Delta",
        month: "2026-08",
        items: [{ name: "A", code: "1", grossPaise: 0 }],
        expenseLedger: "E",
        payableLedger: "P",
        perEmployeeLedgers: false,
      })
    ).toThrow(/Nothing payable/)
  })
})

describe("a correction run is a distinct voucher", () => {
  const items = [{ name: "Kabir Singh", code: "DLT0004", grossPaise: 900_000 }]
  const base = {
    company: "Delta",
    month: "2026-08",
    items,
    expenseLedger: "Salary & Wages",
    payableLedger: "Salary Payable",
    perEmployeeLedgers: false,
  }

  it("version 1 keeps the plain number", () => {
    expect(buildPayrollJournal({ ...base, version: 1 })).toContain(
      "<VOUCHERNUMBER>PAY/2026-08</VOUCHERNUMBER>"
    )
  })

  it("a later version is distinguishable, so Tally cannot double-book the month", () => {
    expect(buildPayrollJournal({ ...base, version: 2 })).toContain(
      "<VOUCHERNUMBER>PAY/2026-08/V2</VOUCHERNUMBER>"
    )
  })
})
