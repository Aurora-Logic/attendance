import { describe, expect, it } from 'vitest';

import { parseImportResponse, renderVoucherImportXml, tallyDate } from './tally-xml.js';

describe('the push wire format', () => {
  const payload = {
    documentId: '01900000-0000-7000-8000-00000000aa01',
    kind: 'SALES_ORDER' as const,
    voucherType: 'Sales Order',
    reference: 'SO-0001',
    date: '2026-08-18',
    partyName: 'Asha & Sons <Traders>',
    narration: 'Cable order\nvyuha:SO-0001',
    idempotencyKey: 'vyuha:so-1',
    remoteGuid: null,
    lines: [{ stockItemName: 'Cat6 cable 305m', quantity: '2.000', unit: 'BOX', rate: '4000.00', discountPct: '0.00', amount: '8000.00' }],
  };

  it('writes one voucher per envelope, escaped, with the key in the narration and the party balancing the lines', () => {
    const xml = renderVoucherImportXml(payload, 'Orders Co');
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect((xml.match(/<VOUCHER /gu) ?? []).length).toBe(1);
    expect(xml).toContain('VCHTYPE="Sales Order" ACTION="Create"');
    expect(xml).toContain('<PARTYLEDGERNAME>Asha &amp; Sons &lt;Traders&gt;</PARTYLEDGERNAME>');
    expect(xml).toContain('<NARRATION>Cable order\nvyuha:SO-0001</NARRATION>');
    expect(xml).toContain('<DATE>20260818</DATE>');
    expect(xml).toContain('<AMOUNT>-8000.00</AMOUNT>');
    expect(xml).toContain('<STOCKITEMNAME>Cat6 cable 305m</STOCKITEMNAME>');
  });

  it('an alter names the voucher it changes and never creates', () => {
    const xml = renderVoucherImportXml({ ...payload, remoteGuid: 'abc-123' }, 'Orders Co');
    expect(xml).toContain('ACTION="Alter"');
    expect(xml).toContain('REMOTEID="abc-123"');
  });

  it('reads counts and LINEERRORs leniently, and never invents success', () => {
    const ok = parseImportResponse('<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS></RESPONSE>');
    expect(ok).toMatchObject({ created: 1, errors: 0, lineErrors: [] });
    const bad = parseImportResponse(
      "<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger &apos;Asha&apos; does not exist!</LINEERROR></RESPONSE>",
    );
    expect(bad.errors).toBe(1);
    expect(bad.lineErrors).toEqual(["Ledger 'Asha' does not exist!"]);
    const garbage = parseImportResponse('not xml at all');
    expect(garbage).toMatchObject({ created: 0, altered: 0, errors: 0, lineErrors: [], guid: null });
    expect(tallyDate('2026-01-05')).toBe('20260105');
  });
});
