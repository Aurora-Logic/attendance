import type { VoucherPushPayload } from '@vyuha/shared';

/**
 * The push wire format (09 §3.3: "agent … generates Tally XML"). One
 * voucher per envelope, always — Tally gives no transactional guarantee
 * across a batch, so a batch is never sent.
 *
 * `renderVoucherImportXml` writes TallyPrime's Import Data envelope for a
 * Sales Order (or, later, any inventory voucher): the party ledger, one
 * inventory entry per line, and the sales ledger balancing the total.
 * `NARRATION` carries the idempotency key, which is what the agent asks
 * Tally for before any retry (09 §3.3: present means it landed). An alter
 * sets `ACTION="Alter"` with the voucher's GUID so Tally changes the voucher
 * it has rather than making a second (REQ-W-07).
 *
 * This is written to TallyPrime's documented import shape and has not yet
 * been driven against a live TallyPrime — that verification is the Phase 6e
 * exit gate (kill the agent mid-import, retry, count vouchers) and needs a
 * Tally to kill it against. Until then it is the best-known shape, marked
 * as such, and the parser beside it is what makes a wrong guess loud
 * rather than silent.
 */

const AMP = /&/gu;
const LT = /</gu;
const GT = />/gu;
const QUOT = /"/gu;

/** Tally reads XML but does not always write it strictly; we always write it strictly. */
export function escapeXml(text: string): string {
  return text.replace(AMP, '&amp;').replace(LT, '&lt;').replace(GT, '&gt;').replace(QUOT, '&quot;');
}

/** `2026-08-18` → `20260818`, Tally's date spelling. */
export function tallyDate(isoDate: string): string {
  return isoDate.replace(/-/gu, '');
}

export function renderVoucherImportXml(payload: VoucherPushPayload, companyName: string): string {
  const action = payload.remoteGuid === null ? 'Create' : 'Alter';
  const guidAttr = payload.remoteGuid === null ? '' : ` REMOTEID="${escapeXml(payload.remoteGuid)}"`;
  const total = payload.lines.reduce((sum, line) => sum + Number(line.amount), 0).toFixed(2);
  const inventory = payload.lines
    .map(
      (line) => `
          <ALLINVENTORYENTRIES.LIST>
            <STOCKITEMNAME>${escapeXml(line.stockItemName)}</STOCKITEMNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <RATE>${escapeXml(line.rate)}${line.unit === null ? '' : `/${escapeXml(line.unit)}`}</RATE>
            <DISCOUNT>${escapeXml(line.discountPct)}</DISCOUNT>
            <AMOUNT>${escapeXml(line.amount)}</AMOUNT>
            <ACTUALQTY>${escapeXml(line.quantity)}${line.unit === null ? '' : ` ${escapeXml(line.unit)}`}</ACTUALQTY>
            <BILLEDQTY>${escapeXml(line.quantity)}${line.unit === null ? '' : ` ${escapeXml(line.unit)}`}</BILLEDQTY>
            <ACCOUNTINGALLOCATIONS.LIST>
              <LEDGERNAME>Sales</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${escapeXml(line.amount)}</AMOUNT>
            </ACCOUNTINGALLOCATIONS.LIST>
          </ALLINVENTORYENTRIES.LIST>`,
    )
    .join('');
  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${escapeXml(payload.voucherType)}" ACTION="${action}" OBJVIEW="Invoice Voucher View"${guidAttr}>
            <DATE>${tallyDate(payload.date)}</DATE>
            <VOUCHERTYPENAME>${escapeXml(payload.voucherType)}</VOUCHERTYPENAME>
            <REFERENCE>${escapeXml(payload.reference)}</REFERENCE>
            <PARTYLEDGERNAME>${escapeXml(payload.partyName)}</PARTYLEDGERNAME>
            <PARTYNAME>${escapeXml(payload.partyName)}</PARTYNAME>
            <NARRATION>${escapeXml(payload.narration)}</NARRATION>
            <ISINVOICE>Yes</ISINVOICE>
            <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(payload.partyName)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${total}</AMOUNT>
            </LEDGERENTRIES.LIST>${inventory}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export interface ImportResponse {
  readonly created: number;
  readonly altered: number;
  readonly errors: number;
  /** Tally's own words, verbatim (REQ-T-01); empty when there were none. */
  readonly lineErrors: readonly string[];
  /** The GUID Tally assigned, when its response carried one. */
  readonly guid: string | null;
  readonly voucherNumber: string | null;
}

/**
 * Tally answers an import with counts and, on failure, one `<LINEERROR>`
 * per problem — in prose a person can act on. Read leniently: Tally's XML
 * is not strict, and a response that cannot be read is itself the fact to
 * report, not a reason to guess success.
 */
export function parseImportResponse(xml: string): ImportResponse {
  const num = (tag: string): number => {
    const match = new RegExp(`<${tag}>\\s*(\\d+)\\s*</${tag}>`, 'iu').exec(xml);
    return match?.[1] === undefined ? 0 : Number(match[1]);
  };
  const text = (tag: string): string | null => {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'iu').exec(xml);
    return match?.[1] === undefined ? null : unescapeXml(match[1].trim());
  };
  const lineErrors = [...xml.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/giu)].map((m) => unescapeXml((m[1] ?? '').trim()));
  return {
    created: num('CREATED'),
    altered: num('ALTERED'),
    errors: num('ERRORS'),
    lineErrors,
    guid: text('GUID') ?? text('REMOTEID'),
    voucherNumber: text('VOUCHERNUMBER'),
  };
}

function unescapeXml(text: string): string {
  return text.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, '&');
}
