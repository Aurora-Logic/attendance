import { describe, expect, it } from 'vitest';

import type { VoucherDetailView } from './masters.js';
import { splitQuantity, voucherPaper, voucherPaperTitle, voucherPaperType } from './voucher-paper.js';

const base = { id: 'v1', connectionId: 'c', date: '2026-08-10', partyName: 'Asha Traders', partyId: 'p', narration: '', isCancelled: false, lastPulledAt: '2026-08-22T00:00:00.000Z' };

describe('voucherPaper', () => {
  it('prints a Sales voucher as a tax invoice: goods as lines, tax ledgers as the tax total, the party ledger as nothing', () => {
    const voucher: VoucherDetailView = {
      ...base,
      voucherType: 'Sales',
      voucherNumber: 'INV-31',
      amount: '9440.00',
      lines: [
        { lineNo: 1, kind: 'ledger', ledgerName: 'Asha Traders', isDeemedPositive: true, stockItemName: null, stockItemId: null, actualQty: null, billedQty: null, rate: null, amount: '9440.00' },
        { lineNo: 2, kind: 'ledger', ledgerName: 'Sales @ 18%', isDeemedPositive: false, stockItemName: null, stockItemId: null, actualQty: null, billedQty: null, rate: null, amount: '-8000.00' },
        { lineNo: 3, kind: 'ledger', ledgerName: 'Output CGST', isDeemedPositive: false, stockItemName: null, stockItemId: null, actualQty: null, billedQty: null, rate: null, amount: '-720.00' },
        { lineNo: 4, kind: 'ledger', ledgerName: 'Output SGST', isDeemedPositive: false, stockItemName: null, stockItemId: null, actualQty: null, billedQty: null, rate: null, amount: '-720.00' },
        { lineNo: 5, kind: 'inventory', ledgerName: null, isDeemedPositive: null, stockItemName: 'Cat6 cable 305m', stockItemId: 'i', actualQty: '2 BOX', billedQty: '2 BOX', rate: '4000.00', amount: '8000.00' },
      ],
    };
    const paper = voucherPaper(voucher);
    expect(paper.type).toBe('INVOICE');
    expect(paper.title).toBe('Tax Invoice');
    expect(paper.lines).toEqual([{ id: '5', stockItemId: 'i', description: 'Cat6 cable 305m', quantity: '2', unit: 'BOX', rate: '4000.00', amount: '8000.00' }]);
    expect(paper.subtotal).toBe('8000.00');
    expect(paper.taxTotal).toBe('1440.00');
    expect(paper.grandTotal).toBe('9440.00');
  });

  it('prints a Receipt as its ledgers, each marked as Tally marks it, on the invoice paper under its own title', () => {
    const voucher: VoucherDetailView = {
      ...base,
      voucherType: 'Receipt',
      voucherNumber: 'RCP-7',
      amount: '5000.00',
      lines: [
        { lineNo: 1, kind: 'ledger', ledgerName: 'HDFC Bank', isDeemedPositive: true, stockItemName: null, stockItemId: null, actualQty: null, billedQty: null, rate: null, amount: '5000.00' },
        { lineNo: 2, kind: 'ledger', ledgerName: 'Asha Traders', isDeemedPositive: false, stockItemName: null, stockItemId: null, actualQty: null, billedQty: null, rate: null, amount: '-5000.00' },
      ],
    };
    const paper = voucherPaper(voucher);
    expect(paper.title).toBe('Receipt Voucher');
    expect(paper.type).toBe('INVOICE');
    expect(paper.lines).toEqual([{ id: '1', stockItemId: null, description: 'HDFC Bank (Dr)', quantity: '1', unit: null, rate: '5000.00', amount: '5000.00' }]);
    expect(paper.grandTotal).toBe('5000.00');
  });

  it('borrows the vendor-facing paper for a purchase, and reads quantities as text', () => {
    expect(voucherPaperType('Purchase')).toBe('PURCHASE_ORDER');
    expect(voucherPaperTitle('Stock Journal')).toBe('Stock Journal Voucher');
    expect(splitQuantity('12.5 KG')).toEqual({ quantity: '12.5', unit: 'KG' });
    expect(splitQuantity('7')).toEqual({ quantity: '7', unit: null });
    expect(splitQuantity(null)).toEqual({ quantity: '0', unit: null });
  });
});
