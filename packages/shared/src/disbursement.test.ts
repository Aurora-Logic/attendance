import { describe, expect, it } from "vitest"

import {
  bankDetailsSchema,
  buildBankTransferCsv,
  paiseToRupeeString,
  splitForDisbursement,
  type DisbursementRow,
} from "./disbursement"

const bank = {
  accountName: "Kabir Singh",
  accountNumber: "50100234567890",
  ifsc: "HDFC0001234",
  bankName: "HDFC Bank",
  pan: "ABCDE1234F",
  uan: "100200300400",
}

describe("bankDetailsSchema", () => {
  it("accepts a well-formed record and blank optional identifiers", () => {
    expect(bankDetailsSchema.safeParse(bank).success).toBe(true)
    expect(bankDetailsSchema.safeParse({ ...bank, pan: "", uan: "" }).success).toBe(true)
  })

  it("rejects the typos that actually happen", () => {
    // Fifth character of an IFSC is always 0.
    expect(bankDetailsSchema.safeParse({ ...bank, ifsc: "HDFC1001234" }).success).toBe(false)
    expect(bankDetailsSchema.safeParse({ ...bank, ifsc: "HDFC000123" }).success).toBe(false)
    expect(bankDetailsSchema.safeParse({ ...bank, accountNumber: "5010 0234" }).success).toBe(false)
    expect(bankDetailsSchema.safeParse({ ...bank, pan: "ABCDE12345" }).success).toBe(false)
    expect(bankDetailsSchema.safeParse({ ...bank, uan: "12345" }).success).toBe(false)
  })
})

describe("splitForDisbursement", () => {
  const rows: DisbursementRow[] = [
    { employeeId: "e1", code: "DLT0001", name: "Kabir", amountPaise: 900_000, bank },
    { employeeId: "e2", code: "DLT0002", name: "Meera", amountPaise: 350_000, bank: null },
    {
      employeeId: "e3",
      code: "DLT0003",
      name: "Sana",
      amountPaise: 500_000,
      bank: { ...bank, ifsc: "NOPE" },
    },
    { employeeId: "e4", code: "DLT0004", name: "Intern", amountPaise: 0, bank },
  ]

  it("pays only the rows that can actually be paid, and says why for the rest", () => {
    const split = splitForDisbursement(rows)
    expect(split.payable.map((row) => row.code)).toEqual(["DLT0001"])
    expect(split.totalPayablePaise).toBe(900_000)
    expect(split.held.map((entry) => entry.row.code)).toEqual(["DLT0002", "DLT0003", "DLT0004"])
    expect(split.held[0].reason).toMatch(/No bank details/)
    expect(split.held[1].reason).toMatch(/IFSC/)
    expect(split.held[2].reason).toMatch(/Nothing payable/)
  })

  it("never silently drops anyone — every input row appears in exactly one list", () => {
    const split = splitForDisbursement(rows)
    expect(split.payable.length + split.held.length).toBe(rows.length)
  })
})

describe("buildBankTransferCsv", () => {
  it("quotes fields, picks NEFT vs RTGS by amount, and uses CRLF", () => {
    const split = splitForDisbursement([
      { employeeId: "e1", code: "DLT0001", name: 'Ka"bir, Singh', amountPaise: 900_000, bank: { ...bank, accountName: 'Ka"bir, Singh' } },
      { employeeId: "e2", code: "DLT0002", name: "Big Pay", amountPaise: 25_000_000, bank },
    ])
    const csv = buildBankTransferCsv(split, { month: "2026-08", debitAccount: "00110022003300" })
    const lines = csv.split("\r\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('"Beneficiary Name"')
    // The comma inside the name must not create a column.
    expect(lines[1]).toContain('"Ka""bir, Singh"')
    expect(lines[1]).toContain('"9000.00"')
    expect(lines[1]).toContain('"NEFT"')
    expect(lines[2]).toContain('"RTGS"')
    expect(lines[2]).toContain('"250000.00"')
  })

  it("renders paise exactly, including sub-rupee amounts", () => {
    expect(paiseToRupeeString(1)).toBe("0.01")
    expect(paiseToRupeeString(123_456)).toBe("1234.56")
  })
})

describe("the bank file cannot carry a spreadsheet formula", () => {
  const formulaName = '=HYPERLINK("http://evil.example","Click")'

  it("refuses a beneficiary name that begins like a formula", () => {
    for (const lead of ["=", "+", "-", "@"]) {
      expect(
        bankDetailsSchema.safeParse({ ...bank, accountName: `${lead}payload` }).success,
        `leading ${lead}`
      ).toBe(false)
    }
    expect(bankDetailsSchema.safeParse({ ...bank, accountName: "Kabir Singh" }).success).toBe(true)
  })

  it("neutralises one that got in before the rule existed", () => {
    const split = splitForDisbursement([
      {
        employeeId: "e1",
        code: "DLT0001",
        name: "x",
        amountPaise: 900_000,
        bank: { ...bank, accountName: formulaName },
      },
    ])
    const row = buildBankTransferCsv(split, { month: "2026-08", debitAccount: "001100" }).split(
      "\r\n"
    )[1]
    // Prefixed, so a spreadsheet reads it as text rather than running it.
    expect(row.startsWith(`"'=HYPERLINK`)).toBe(true)
  })

  it("ordinary names are untouched", () => {
    const split = splitForDisbursement([
      { employeeId: "e1", code: "DLT0001", name: "x", amountPaise: 900_000, bank },
    ])
    const row = buildBankTransferCsv(split, { month: "2026-08", debitAccount: "001100" }).split(
      "\r\n"
    )[1]
    expect(row.startsWith(`"${bank.accountName}"`)).toBe(true)
  })
})
