import { z } from 'zod';

/**
 * Printed documents (estimate, sales order, invoice, purchase order): the
 * paper is the editor. One org-wide identity (what the paper says about the
 * business) and one design per document type — a template, an accent, and
 * which blocks and columns appear — so the four documents are one renderer
 * worn four ways. Stored as a setting; nothing here is a table.
 */

export const DOCUMENT_TEMPLATE_IDS = ['classic', 'modern', 'minimal', 'bold', 'ledger'] as const;
export type DocumentTemplateId = (typeof DOCUMENT_TEMPLATE_IDS)[number];
export const DOCUMENT_TEMPLATE_LABELS: Record<DocumentTemplateId, { label: string; note: string }> = {
  classic: { label: 'Classic', note: 'Ruled table, serif headline, the letterhead most accountants expect.' },
  modern: { label: 'Modern', note: 'Accent band across the top, generous white space, sans-serif.' },
  minimal: { label: 'Minimal', note: 'Type and hairlines only; the logo carries the identity.' },
  bold: { label: 'Bold', note: 'A coloured header block and strong totals; reads from across a counter.' },
  ledger: { label: 'Ledger', note: 'Dense, boxed, Tally-like; every figure in a cell.' },
};

export const PRINTED_DOCUMENT_TYPES = ['ESTIMATE', 'SALES_ORDER', 'INVOICE', 'PURCHASE_ORDER'] as const;
export type PrintedDocumentType = (typeof PRINTED_DOCUMENT_TYPES)[number];
export const PRINTED_DOCUMENT_TITLES: Record<PrintedDocumentType, string> = {
  ESTIMATE: 'Estimate',
  SALES_ORDER: 'Sales Order',
  INVOICE: 'Tax Invoice',
  PURCHASE_ORDER: 'Purchase Order',
};

/** A palette rather than a colour picker: every accent is a class the paper already knows, on screen and in print. */
export const DOCUMENT_ACCENTS = ['ink', 'blue', 'teal', 'green', 'amber', 'rose', 'violet', 'slate'] as const;
export type DocumentAccent = (typeof DOCUMENT_ACCENTS)[number];
export const DOCUMENT_ACCENT_LABELS: Record<DocumentAccent, string> = {
  ink: 'Ink',
  blue: 'Blue',
  teal: 'Teal',
  green: 'Green',
  amber: 'Amber',
  rose: 'Rose',
  violet: 'Violet',
  slate: 'Slate',
};

const shortText = (max: number) => z.string().trim().max(max);

/** What the business says about itself on every printed page. */
export const documentProfileSchema = z.object({
  legalName: shortText(200),
  addressLines: shortText(600),
  gstin: shortText(20),
  pan: shortText(12),
  phone: shortText(40),
  email: shortText(254),
  website: shortText(200),
  bankName: shortText(120),
  bankAccount: shortText(40),
  bankIfsc: shortText(20),
  bankBranch: shortText(120),
  signatoryName: shortText(120),
});
export type DocumentProfile = z.infer<typeof documentProfileSchema>;

export const documentDesignSchema = z.object({
  templateId: z.enum(DOCUMENT_TEMPLATE_IDS),
  accent: z.enum(DOCUMENT_ACCENTS),
  fontScale: z.enum(['sm', 'md', 'lg']),
  logoPlacement: z.enum(['left', 'right', 'none']),
  showDiscount: z.boolean(),
  showTax: z.boolean(),
  showUnit: z.boolean(),
  showTerms: z.boolean(),
  showBank: z.boolean(),
  showSignature: z.boolean(),
  /** The line under the totals; "Thank you for your business" and the like. */
  footerNote: shortText(300),
  /** Prefills a new document's terms; the document may still say its own. */
  defaultTerms: shortText(4000),
});
export type DocumentDesign = z.infer<typeof documentDesignSchema>;

export const documentSettingsSchema = z.object({
  profile: documentProfileSchema,
  designs: z.record(z.enum(PRINTED_DOCUMENT_TYPES), documentDesignSchema),
});
export type DocumentSettings = z.infer<typeof documentSettingsSchema>;

export const DEFAULT_DOCUMENT_DESIGN: DocumentDesign = {
  templateId: 'classic',
  accent: 'blue',
  fontScale: 'md',
  logoPlacement: 'left',
  showDiscount: true,
  showTax: true,
  showUnit: true,
  showTerms: true,
  showBank: false,
  showSignature: true,
  footerNote: '',
  defaultTerms: '',
};

export const DEFAULT_DOCUMENT_PROFILE: DocumentProfile = {
  legalName: '',
  addressLines: '',
  gstin: '',
  pan: '',
  phone: '',
  email: '',
  website: '',
  bankName: '',
  bankAccount: '',
  bankIfsc: '',
  bankBranch: '',
  signatoryName: '',
};

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  profile: DEFAULT_DOCUMENT_PROFILE,
  designs: {
    ESTIMATE: DEFAULT_DOCUMENT_DESIGN,
    SALES_ORDER: DEFAULT_DOCUMENT_DESIGN,
    INVOICE: { ...DEFAULT_DOCUMENT_DESIGN, showBank: true },
    PURCHASE_ORDER: { ...DEFAULT_DOCUMENT_DESIGN, showDiscount: false },
  },
};

/** GST's three copies of a tax invoice, printed as three pages with the copy named. */
export const INVOICE_COPIES = ['original', 'duplicate', 'triplicate'] as const;
export type InvoiceCopy = (typeof INVOICE_COPIES)[number];
export const INVOICE_COPY_LABELS: Record<InvoiceCopy, string> = {
  original: 'Original for Recipient',
  duplicate: 'Duplicate for Transporter',
  triplicate: 'Triplicate for Supplier',
};
