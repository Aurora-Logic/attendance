import { Injectable } from '@nestjs/common';
import { PRINTED_DOCUMENT_TITLES, type DocumentProfile, type PrintedDocumentType } from '@vyuha/shared';
import ExcelJS from 'exceljs';

/**
 * One printed document as a workbook: an identity block, the addressee, the
 * lines, the totals — the same shape every module's Excel button produces,
 * so an accountant opening an estimate and a purchase order finds the same
 * cells in the same places.
 */
export interface DocumentSheetInput {
  readonly type: PrintedDocumentType;
  readonly number: string;
  readonly date: string;
  readonly status: string;
  readonly partyName: string;
  readonly partyDetail: string | null;
  readonly reference: string | null;
  readonly lines: readonly { description: string; quantity: string; unit: string | null; rate: string; discountPct: string; taxPct: string; amount: string; taxAmount: string }[];
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly grandTotal: string;
  readonly notes: string | null;
  readonly terms: string | null;
  /** False on a paper that carries goods, not money: quantities only, no rates, amounts or totals. */
  readonly showAmounts?: boolean;
}

@Injectable()
export class DocumentXlsxService {
  async build(profile: DocumentProfile, orgName: string, doc: DocumentSheetInput): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = orgName;
    workbook.created = new Date();
    // Excel refuses a sheet name with \ / ? * [ ] : — a packing slip is numbered SO-0016/AF71.
    const sheet = workbook.addWorksheet(doc.number.replace(/[\\/?*[\]:]/gu, '-').slice(0, 31));
    sheet.columns = [{ width: 6 }, { width: 44 }, { width: 12 }, { width: 8 }, { width: 14 }, { width: 10 }, { width: 8 }, { width: 16 }, { width: 14 }];

    const title = sheet.addRow([PRINTED_DOCUMENT_TITLES[doc.type]]);
    title.font = { bold: true, size: 16 };
    sheet.addRow([profile.legalName || orgName]).font = { bold: true };
    for (const line of profile.addressLines.split('\n').filter((l) => l.trim() !== '')) sheet.addRow([line]);
    if (profile.gstin) sheet.addRow([`GSTIN ${profile.gstin}`]);
    sheet.addRow([]);
    sheet.addRow(['Number', doc.number, '', 'Date', doc.date, '', 'Status', doc.status]);
    sheet.addRow(['To', doc.partyName, '', doc.partyDetail ?? '']);
    if (doc.reference) sheet.addRow(['Reference', doc.reference]);
    sheet.addRow([]);

    const money = doc.showAmounts ?? true;
    const header = sheet.addRow(money ? ['#', 'Description', 'Quantity', 'Unit', 'Rate', 'Disc %', 'Tax %', 'Amount', 'Tax'] : ['#', 'Description', 'Quantity', 'Unit']);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.border = { bottom: { style: 'thin' } };
    });
    doc.lines.forEach((line, index) => {
      const row = money
        ? sheet.addRow([index + 1, line.description, Number(line.quantity), line.unit ?? '', Number(line.rate), Number(line.discountPct), Number(line.taxPct), Number(line.amount), Number(line.taxAmount)])
        : sheet.addRow([index + 1, line.description, Number(line.quantity), line.unit ?? '']);
      for (const col of money ? [3, 5, 6, 7, 8, 9] : [3]) row.getCell(col).numFmt = '#,##0.00';
    });
    sheet.addRow([]);
    if (money) {
      const totals: [string, string][] = [
        ['Subtotal', doc.subtotal],
        ['Discount', doc.discountTotal],
        ['Tax', doc.taxTotal],
        ['Total', doc.grandTotal],
      ];
      for (const [label, value] of totals) {
        const row = sheet.addRow(['', '', '', '', '', '', label, Number(value)]);
        row.getCell(8).numFmt = '#,##0.00';
        if (label === 'Total') row.font = { bold: true };
      }
    } else {
      const total = doc.lines.reduce((sum, line) => sum + Number(line.quantity), 0);
      const row = sheet.addRow(['', 'Total quantity', total]);
      row.getCell(3).numFmt = '#,##0.00';
      row.font = { bold: true };
    }
    if (doc.notes) {
      sheet.addRow([]);
      sheet.addRow(['Notes', doc.notes]);
    }
    if (doc.terms) sheet.addRow(['Terms', doc.terms]);
    const written = await workbook.xlsx.writeBuffer();
    return Buffer.from(written);
  }
}
