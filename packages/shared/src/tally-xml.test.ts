import { describe, expect, it } from "vitest"

import type { SyncRecord } from "./tally-sync"
import {
  collectionRequestXml,
  entityForLedgerGroup,
  groupForEntity,
  importMasterXml,
  parseCollection,
  parseImportResponse,
  tallyError,
} from "./tally-xml"

const SEEN = "2026-08-08T10:00:00.000Z"

/** A response shaped like Tally's, including its unescaped ampersand. */
const LEDGER_XML = `<ENVELOPE>
 <BODY><DATA><COLLECTION>
  <LEDGER NAME="Kumar & Sons" RESERVEDNAME="">
   <GUID>abc-0001</GUID>
   <ALTERID>42</ALTERID>
   <PARENT>Sundry Debtors</PARENT>
   <PARTYGSTIN>27AAAPZ1234C1ZV</PARTYGSTIN>
   <EMAIL>accounts@kumar.example</EMAIL>
  </LEDGER>
  <LEDGER NAME="Steel Supplies Pvt Ltd">
   <GUID>abc-0002</GUID>
   <ALTERID>7</ALTERID>
   <PARENT>Sundry Creditors</PARENT>
  </LEDGER>
  <LEDGER NAME="Bank of India">
   <GUID>abc-0003</GUID>
   <ALTERID>3</ALTERID>
   <PARENT>Bank Accounts</PARENT>
  </LEDGER>
  <LEDGER NAME="Broken">
   <ALTERID>9</ALTERID>
   <PARENT>Sundry Debtors</PARENT>
  </LEDGER>
 </COLLECTION></DATA></BODY>
</ENVELOPE>`

describe("collectionRequestXml", () => {
  it("asks for the company by name and the fields we need", () => {
    const xml = collectionRequestXml({ company: "Delta Books", collection: "Ledger" })
    expect(xml).toContain("<SVCURRENTCOMPANY>Delta Books</SVCURRENTCOMPANY>")
    expect(xml).toContain("<TALLYREQUEST>Export</TALLYREQUEST>")
    expect(xml).toContain("<NATIVEMETHOD>ALTERID</NATIVEMETHOD>")
    expect(xml).toContain("<NATIVEMETHOD>GUID</NATIVEMETHOD>")
  })

  it("asks stock items for their own fields, not a ledger's", () => {
    const xml = collectionRequestXml({ company: "Delta Books", collection: "StockItem" })
    expect(xml).toContain("<TYPE>StockItem</TYPE>")
    expect(xml).toContain("<NATIVEMETHOD>CLOSINGBALANCE</NATIVEMETHOD>")
    expect(xml).not.toContain("PARTYGSTIN")
  })
})

describe("entityForLedgerGroup", () => {
  it("reads Tally's groups, since Tally has no idea what a customer is", () => {
    expect(entityForLedgerGroup("Sundry Debtors")).toBe("customer")
    expect(entityForLedgerGroup("sundry creditors")).toBe("vendor")
    expect(entityForLedgerGroup("Bank Accounts")).toBe("ledger")
    expect(entityForLedgerGroup("")).toBe("ledger")
  })
})

describe("parseCollection", () => {
  it("classifies by group and keeps Tally's identity", () => {
    const { records } = parseCollection(LEDGER_XML, "Ledger", SEEN)
    expect(records.map((row) => row.entity)).toEqual(["customer", "vendor", "ledger"])
    expect(records[0]).toMatchObject({
      tallyGuid: "abc-0001",
      alterId: 42,
      updatedAt: SEEN,
    })
  })

  it("survives the unescaped ampersand Tally really emits", () => {
    // A strict XML parser rejects this document outright, on a name that is
    // completely ordinary in Indian books.
    const { records } = parseCollection(LEDGER_XML, "Ledger", SEEN)
    expect(records[0].name).toBe("Kumar & Sons")
  })

  it("carries the fields that were present and omits the ones that were not", () => {
    const { records } = parseCollection(LEDGER_XML, "Ledger", SEEN)
    expect(records[0].fields).toMatchObject({
      parent: "Sundry Debtors",
      partygstin: "27AAAPZ1234C1ZV",
      email: "accounts@kumar.example",
    })
    expect(records[1].fields).not.toHaveProperty("email")
  })

  it("counts a master with no GUID instead of guessing at its identity", () => {
    // Matching on name would merge two masters the first time one is renamed.
    const { records, skipped } = parseCollection(LEDGER_XML, "Ledger", SEEN)
    expect(skipped).toBe(1)
    expect(records).toHaveLength(3)
  })

  it("stamps every record in a batch with the same time", () => {
    const { records } = parseCollection(LEDGER_XML, "Ledger", SEEN)
    expect(new Set(records.map((row) => row.updatedAt)).size).toBe(1)
  })

  it("an empty collection is empty, not an error", () => {
    const { records, skipped } = parseCollection(
      "<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>",
      "Ledger",
      SEEN
    )
    expect(records).toEqual([])
    expect(skipped).toBe(0)
  })
})

describe("tallyError", () => {
  it("catches the error Tally returns with a 200", () => {
    // Treating this as a successful empty sync is how a live book gets
    // overwritten by nothing.
    expect(
      tallyError("<ENVELOPE><HEADER><LINEERROR>No company is open</LINEERROR></HEADER></ENVELOPE>")
    ).toBe("No company is open")
  })

  it("passes a real response through", () => {
    expect(tallyError(LEDGER_XML)).toBeNull()
  })

  it("treats an empty body as a failure", () => {
    expect(tallyError("   ")).toBe("Tally returned an empty response.")
  })
})

describe("importMasterXml", () => {
  const customer: SyncRecord = {
    entity: "customer",
    tallyGuid: "local:cust-1",
    name: "Rathi & Co",
    alterId: 0,
    updatedAt: SEEN,
    fields: { partygstin: "27AAAPZ1234C1ZV", email: "ap@rathi.example" },
  }

  it("escapes on the way out, even though Tally does not on the way in", () => {
    const xml = importMasterXml({ company: "Delta Books", record: customer })
    expect(xml).toContain('NAME="Rathi &amp; Co"')
    expect(xml).toContain("<NAME>Rathi &amp; Co</NAME>")
  })

  it("files a customer under Sundry Debtors and turns on bill-wise tracking", () => {
    // Without bill-by-bill there is no due date, and credit-period reporting is
    // the reason to sync customers at all.
    const xml = importMasterXml({ company: "Delta Books", record: customer })
    expect(xml).toContain("<PARENT>Sundry Debtors</PARENT>")
    expect(xml).toContain("<ISBILLWISEON>Yes</ISBILLWISEON>")
    expect(xml).toContain("<TALLYREQUEST>Import</TALLYREQUEST>")
  })

  it("keeps a group the record already carries rather than imposing a default", () => {
    const xml = importMasterXml({
      company: "Delta Books",
      record: { ...customer, fields: { parent: "Sundry Debtors - North" } },
    })
    expect(xml).toContain("<PARENT>Sundry Debtors - North</PARENT>")
  })

  it("writes a stock item as a stock item, not a ledger", () => {
    const xml = importMasterXml({
      company: "Delta Books",
      record: { ...customer, entity: "item", name: "M8 Bolt", fields: { baseunits: "Nos" } },
    })
    expect(xml).toContain("<STOCKITEM")
    expect(xml).toContain("<BASEUNITS>Nos</BASEUNITS>")
    expect(xml).not.toContain("ISBILLWISEON")
  })

  it("creates rather than overwrites — a clash is an error we want to see", () => {
    expect(importMasterXml({ company: "C", record: customer })).toContain('ACTION="Create"')
  })
})

describe("groupForEntity", () => {
  it("maps our vocabulary onto Tally's groups", () => {
    expect(groupForEntity("customer")).toBe("Sundry Debtors")
    expect(groupForEntity("vendor")).toBe("Sundry Creditors")
    expect(groupForEntity("customer", "Retail Debtors")).toBe("Retail Debtors")
  })
})

describe("parseImportResponse", () => {
  it("counts what Tally accepted", () => {
    expect(
      parseImportResponse(
        "<ENVELOPE><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS></ENVELOPE>"
      )
    ).toMatchObject({ created: 1, altered: 0, errors: 0, message: null })
  })

  it("notices a rejection that arrived with a 200", () => {
    // Checking only the HTTP status records a master as written that Tally threw away.
    const result = parseImportResponse(
      "<ENVELOPE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger already exists</LINEERROR></ENVELOPE>"
    )
    expect(result.errors).toBe(1)
    expect(result.message).toBe("Ledger already exists")
  })

  it("counts exceptions as errors too", () => {
    expect(parseImportResponse("<ENVELOPE><EXCEPTIONS>2</EXCEPTIONS></ENVELOPE>").errors).toBe(2)
  })
})
