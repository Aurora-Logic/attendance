import { code128, DEFAULT_DOCUMENT_SETTINGS, type DispatchView, type SalesDocumentView } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { renderDispatchNotice, renderInvoiceNotice } from './customer-notice.js';

const dispatch: DispatchView = {
  id: 'd1',
  number: 'DN-0042',
  documentId: 'o1',
  orderNumber: 'SO-0007',
  customerName: 'Asha Traders',
  mode: 'outstation',
  dispatchedById: null,
  dispatchedByName: 'Sunil',
  dispatchedAt: '2026-08-21T11:10:00.000Z',
  lrNumber: 'MH-4471-2026',
  transporterName: 'VRL Logistics',
  transporterContact: '98765 43210',
  vehicleNumber: 'MH 12 AB 4471',
  driverName: null,
  expectedDeliveryDate: '2026-08-24',
  notes: null,
  status: 'shipped',
  deliveredAt: null,
  deliveredByName: null,
  receivedBy: null,
  deliveryNote: null,
  syncState: 'QUEUED',
  remoteGuid: null,
  remoteVoucherNumber: null,
  lastError: null,
  lines: [
    { lineId: 'l1', description: 'Cat6 Cable Box, 305 m', quantity: '6', unit: 'BOX' },
    { lineId: 'l2', description: 'RJ45 Connector <pack of 100>', quantity: '4', unit: 'PKT' },
  ],
  attachments: [],
  notifications: [],
};

const profile = { ...DEFAULT_DOCUMENT_SETTINGS.profile, legalName: 'GC Communication', phone: '020 2712 3456', gstin: '27AAACG1234F1Z5', addressLines: '12, Industrial Estate\nPune 411 026' };

describe('renderDispatchNotice', () => {
  it('E1: the LR is the subject and the headline, the barcode is a row of cells, the items are listed', () => {
    const notice = renderDispatchNotice({ event: 'dispatched', orgName: 'GC', profile, dispatch, contactName: 'Rakesh Shah' });
    expect(notice.subject).toBe('SO-0007 is on its way — LR MH-4471-2026');
    expect(notice.text).toContain('Your order is on its way, Rakesh.');
    expect(notice.text).toContain('LR number (quote this to the transporter): MH-4471-2026');
    expect(notice.text).toContain('- Cat6 Cable Box, 305 m: 6 BOX');
    expect(notice.text).toContain('Expected by Monday, 24 August 2026');
    // Every bar of the Code 128 for DN-0042 is a cell, never an image.
    expect((notice.html.match(/background:#111111/gu) ?? []).length).toBe(code128('DN-0042').bars.length);
    expect(notice.html).not.toContain('<img');
    // Untrusted text is escaped on the way into the markup.
    expect(notice.html).toContain('RJ45 Connector &lt;pack of 100&gt;');
    expect(notice.html).toContain('Dispatch notice');
  });

  it('E2: delivered names the receiver, the date and the two-day window, without an LR block', () => {
    const delivered: DispatchView = { ...dispatch, mode: 'local_auto', lrNumber: null, transporterName: null, transporterContact: null, status: 'delivered', deliveredAt: '2026-08-22T05:50:00.000Z', receivedBy: 'Rakesh Shah', deliveryNote: 'Left at the counter.' };
    const notice = renderDispatchNotice({ event: 'delivered', orgName: 'GC', profile, dispatch: delivered, contactName: null });
    expect(notice.subject).toBe('SO-0007 delivered — received by Rakesh Shah');
    expect(notice.text).toContain('Delivered to Rakesh Shah.');
    expect(notice.text).toContain('reply within two working days quoting DN-0042');
    expect(notice.text).not.toContain('LR number');
    expect(notice.html).toContain('Delivery notice');
    expect(notice.html).toContain('Received by');
  });

  it('E3: a counter pickup is told it is ready, with the barcode to show, and its door step reads as collected', () => {
    const pickup: DispatchView = { ...dispatch, mode: 'customer_collects', lrNumber: null, transporterName: null, transporterContact: null, vehicleNumber: null, expectedDeliveryDate: null };
    const ready = renderDispatchNotice({ event: 'dispatched', orgName: 'GC', profile, dispatch: pickup, contactName: 'Rakesh Shah' });
    expect(ready.subject).toBe('SO-0007 is packed and ready to collect');
    expect(ready.text).toContain('Your order is packed and waiting for you, Rakesh.');
    expect(ready.text).toContain('call 020 2712 3456 before you come');
    expect(ready.html).toContain('Ready to collect');
    expect(ready.text).not.toContain('LR number');

    const collected = renderDispatchNotice({ event: 'delivered', orgName: 'GC', profile, dispatch: { ...pickup, status: 'delivered', deliveredAt: '2026-08-23T05:00:00.000Z', receivedBy: 'Rakesh Shah' }, contactName: null });
    expect(collected.subject).toBe('SO-0007 collected — by Rakesh Shah');
    expect(collected.html).toContain('Collection notice');
  });
});

describe('renderInvoiceNotice', () => {
  it('E4: amount due, invoice number and date, the bank, the lines — and no PDF promised', () => {
    const invoice = {
      number: 'INV-0118', date: '2026-08-21', customerName: 'Asha Traders', customerEmail: 'rakesh@ashatraders.in', grandTotal: '124560.00', terms: '30 days', sourceDocumentId: 'o1', id: 'i1',
      lines: [{ description: 'Cat6 Cable Box, 305 m', quantity: '12.000', unit: 'BOX', amount: '49806.00' }],
    } as unknown as SalesDocumentView;
    const notice = renderInvoiceNotice({ orgName: 'GC', profile: { ...profile, bankName: 'HDFC Bank', bankBranch: 'Pune Camp', bankAccount: '50100123456', bankIfsc: 'HDFC0000123' }, invoice, orderNumber: 'SO-0007', contactName: 'Rakesh Shah' });
    expect(notice.subject).toBe('Invoice INV-0118 for SO-0007 — ₹1,24,560.00');
    expect(notice.text).toContain('Invoice INV-0118 is ready, Rakesh.');
    expect(notice.text).toContain('Amount due: ₹1,24,560.00');
    expect(notice.text).toContain('IFSC: HDFC0000123');
    expect(notice.text).toContain('The PDF follows separately');
    expect(notice.html).toContain('Cat6 Cable Box, 305 m');
    expect(notice.html).not.toContain('<img');
  });
});
