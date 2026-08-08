import type { SyncRecord, TallyEntity } from "./tally-sync"

/**
 * Reading Tally's XML.
 *
 * The parsing lives here rather than inside the Windows agent so it can be
 * tested on any machine. The agent is then a thin shell: post a request, hand
 * the response to these functions, post the result onward. A parser that only
 * runs where Tally is installed is a parser nobody tests.
 *
 * Tally's export XML is not well-formed by XML standards — it emits unescaped
 * ampersands in names like "Kumar & Sons" — so this reads it with tolerant
 * scanning rather than a strict parser, which would reject a real company's
 * data on its first ampersand.
 */

/** The request that asks Tally for a master collection and its AlterIDs. */
export function collectionRequestXml(input: {
  company: string
  collection: "Ledger" | "StockItem"
}): string {
  const fetchFields =
    input.collection === "Ledger"
      ? ["NAME", "GUID", "ALTERID", "PARENT", "LEDGERPHONE", "EMAIL", "PARTYGSTIN", "OPENINGBALANCE"]
      : ["NAME", "GUID", "ALTERID", "PARENT", "BASEUNITS", "CLOSINGBALANCE", "CLOSINGVALUE"]

  return [
    "<ENVELOPE>",
    " <HEADER>",
    "  <VERSION>1</VERSION>",
    "  <TALLYREQUEST>Export</TALLYREQUEST>",
    "  <TYPE>Collection</TYPE>",
    `  <ID>${input.collection}Collection</ID>`,
    " </HEADER>",
    " <BODY>",
    "  <DESC>",
    "   <STATICVARIABLES>",
    "    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>",
    `    <SVCURRENTCOMPANY>${input.company}</SVCURRENTCOMPANY>`,
    "   </STATICVARIABLES>",
    "   <TDL>",
    "    <TDLMESSAGE>",
    `     <COLLECTION NAME="${input.collection}Collection" ISMODIFY="No">`,
    `      <TYPE>${input.collection}</TYPE>`,
    fetchFields.map((field) => `      <NATIVEMETHOD>${field}</NATIVEMETHOD>`).join("\n"),
    "     </COLLECTION>",
    "    </TDLMESSAGE>",
    "   </TDL>",
    "  </DESC>",
    " </BODY>",
    "</ENVELOPE>",
  ].join("\n")
}

/** Everything between <TAG> and </TAG>, non-greedy, first match only. */
function tagValue(chunk: string, tag: string): string | null {
  const match = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))
  return match ? match[1].trim() : null
}

/**
 * Tally escapes very little, so a name can contain a bare `&` or a stray `<`
 * that would break a strict parser. Decode the entities it *does* emit and
 * leave the rest alone.
 */
function decode(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

/**
 * A ledger's parent group decides what it *is* to us: Sundry Debtors are
 * customers, Sundry Creditors vendors, everything else a plain ledger. Tally
 * has no "customer" concept — it has groups.
 */
export function entityForLedgerGroup(parent: string): TallyEntity {
  const group = parent.toLowerCase()
  if (group.includes("sundry debtor")) return "customer"
  if (group.includes("sundry creditor")) return "vendor"
  return "ledger"
}

export interface ParseResult {
  records: SyncRecord[]
  /** Blocks that carried no GUID — reported rather than dropped in silence. */
  skipped: number
}

/**
 * Turn a Tally collection response into sync records.
 *
 * `seenAt` is passed in rather than read from the clock so the same response
 * always parses to the same thing — the agent stamps one time per batch, and
 * tests are not racing a timer.
 */
export function parseCollection(
  xml: string,
  collection: "Ledger" | "StockItem",
  seenAt: string
): ParseResult {
  const tag = collection === "Ledger" ? "LEDGER" : "STOCKITEM"
  const blocks = xml.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi")) ?? []

  const records: SyncRecord[] = []
  let skipped = 0

  for (const block of blocks) {
    const guid = tagValue(block, "GUID")
    if (!guid) {
      // Without a GUID there is no stable identity, and matching on name would
      // merge two masters the first time somebody renames one.
      skipped += 1
      continue
    }

    // The name arrives either as an attribute or a child element.
    const nameAttr = block.match(/<[A-Z]+[^>]*\sNAME="([^"]*)"/i)
    const name = decode(nameAttr?.[1] ?? tagValue(block, "NAME") ?? "")
    const parent = decode(tagValue(block, "PARENT") ?? "")
    const alterId = Number(tagValue(block, "ALTERID") ?? 0)

    const fields: Record<string, unknown> = { parent }
    for (const field of [
      "LEDGERPHONE",
      "EMAIL",
      "PARTYGSTIN",
      "OPENINGBALANCE",
      "BASEUNITS",
      "CLOSINGBALANCE",
      "CLOSINGVALUE",
    ]) {
      const value = tagValue(block, field)
      if (value !== null && value !== "") fields[field.toLowerCase()] = decode(value)
    }

    records.push({
      entity: collection === "Ledger" ? entityForLedgerGroup(parent) : "item",
      tallyGuid: decode(guid),
      name,
      alterId: Number.isFinite(alterId) ? alterId : 0,
      updatedAt: seenAt,
      fields,
    })
  }

  return { records, skipped }
}

/**
 * Did Tally answer with an error rather than data? It returns HTTP 200 with a
 * `<LINEERROR>` body, so a status check alone would treat "no company is open"
 * as a successful empty sync and quietly wipe nothing into everything.
 */
export function tallyError(xml: string): string | null {
  const lineError = tagValue(xml, "LINEERROR")
  if (lineError) return lineError
  if (/<ENVELOPE>/i.test(xml) || /<COLLECTION/i.test(xml)) return null
  return xml.trim().length === 0 ? "Tally returned an empty response." : null
}

/* ------------------------------------------------------- writing to Tally */

/** Escaping on the way out. Tally is lax about what it emits, not what it reads. */
function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

/** The Tally group a master of ours belongs under when we create it there. */
export function groupForEntity(entity: TallyEntity, fallbackParent?: string): string {
  if (fallbackParent) return fallbackParent
  switch (entity) {
    case "customer":
      return "Sundry Debtors"
    case "vendor":
      return "Sundry Creditors"
    case "item":
      return "Primary"
    default:
      return "Primary"
  }
}

/**
 * An Import Data envelope that creates or alters one master.
 *
 * `ACTION="Create"` on a name Tally already holds is an error rather than an
 * overwrite, which is the behaviour we want: this side never silently replaces
 * a master somebody keyed into the books.
 */
export function importMasterXml(input: { company: string; record: SyncRecord }): string {
  const { company, record } = input
  const isItem = record.entity === "item"
  const tag = isItem ? "STOCKITEM" : "LEDGER"
  const parent = groupForEntity(record.entity, String(record.fields.parent ?? "") || undefined)

  const extras: string[] = []
  if (!isItem) {
    const gstin = record.fields.partygstin
    const email = record.fields.email
    const phone = record.fields.ledgerphone
    if (gstin) extras.push(`    <PARTYGSTIN>${escape(String(gstin))}</PARTYGSTIN>`)
    if (email) extras.push(`    <EMAIL>${escape(String(email))}</EMAIL>`)
    if (phone) extras.push(`    <LEDGERPHONE>${escape(String(phone))}</LEDGERPHONE>`)
    // A party ledger with no bill-by-bill tracking cannot carry a due date, and
    // credit-period reporting is the point of syncing customers at all.
    if (record.entity === "customer" || record.entity === "vendor")
      extras.push("    <ISBILLWISEON>Yes</ISBILLWISEON>")
  } else {
    const units = record.fields.baseunits
    if (units) extras.push(`    <BASEUNITS>${escape(String(units))}</BASEUNITS>`)
  }

  return [
    "<ENVELOPE>",
    " <HEADER>",
    "  <VERSION>1</VERSION>",
    "  <TALLYREQUEST>Import</TALLYREQUEST>",
    "  <TYPE>Data</TYPE>",
    "  <ID>All Masters</ID>",
    " </HEADER>",
    " <BODY>",
    "  <DESC>",
    "   <STATICVARIABLES>",
    `    <SVCURRENTCOMPANY>${escape(company)}</SVCURRENTCOMPANY>`,
    "   </STATICVARIABLES>",
    "  </DESC>",
    "  <DATA>",
    "   <TALLYMESSAGE>",
    `    <${tag} NAME="${escape(record.name)}" ACTION="Create">`,
    `     <NAME>${escape(record.name)}</NAME>`,
    `     <PARENT>${escape(parent)}</PARENT>`,
    ...extras.map((line) => ` ${line}`),
    `    </${tag}>`,
    "   </TALLYMESSAGE>",
    "  </DATA>",
    " </BODY>",
    "</ENVELOPE>",
  ].join("\n")
}

export interface ImportResult {
  created: number
  altered: number
  errors: number
  /** Tally's own words, when it refused. */
  message: string | null
}

/**
 * Read an import response.
 *
 * Tally answers a rejected import with HTTP 200 and a non-zero `<ERRORS>`
 * count, so anything that only checks the status code will record a master as
 * written when Tally threw it away.
 */
export function parseImportResponse(xml: string): ImportResult {
  const count = (tag: string) => {
    const raw = tagValue(xml, tag)
    const value = Number(raw ?? 0)
    return Number.isFinite(value) ? value : 0
  }
  const errors = count("ERRORS") + count("EXCEPTIONS")
  const message = tagValue(xml, "LINEERROR") ?? tagValue(xml, "DESC")
  return {
    created: count("CREATED"),
    altered: count("ALTERED"),
    errors,
    message: errors > 0 ? (message ?? "Tally rejected the import.") : null,
  }
}
