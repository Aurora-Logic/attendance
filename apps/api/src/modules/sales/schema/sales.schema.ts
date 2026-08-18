import { date, index, integer, numeric, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../../../platform/db/columns.js';
import { employees, organizations, parties, stockItems } from '../../../platform/db/schema/index.js';

/**
 * Sales documents (08 Area W). One table with a type discriminator, as
 * Tally models vouchers and 09 §4.3 models the projection: an estimate, a
 * sales order and a challan are the same header-and-lines shape at
 * different points in a life, and one line editor serves them all.
 *
 * The customer is one of three: a Tally party (`party_id`), a CRM company
 * that is not yet a party (`company_id`, no FK — the sales module may not
 * import the CRM schema, technical design §1), or a name typed in.
 * `customer_name` is what prints, snapshotted so a rename later does not
 * rewrite what was sent. `deal_id` is likewise an unreferenced uuid: the
 * link REQ-U-06 wants is read from this side by deal id.
 */

export const salesDocumentTypeEnum = pgEnum('sales_document_type', ['ESTIMATE']);
export const estimateStatusEnum = pgEnum('estimate_status', ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']);

export const salesDocuments = pgTable(
  'sales_documents',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    docType: salesDocumentTypeEnum('doc_type').notNull(),
    /** `EST-0001`, per organisation per type, from `sales_document_sequences`. */
    number: text('number').notNull(),
    status: estimateStatusEnum('status').notNull().default('DRAFT'),
    date: date('date', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    companyId: uuid('company_id'),
    dealId: uuid('deal_id'),
    customerName: text('customer_name').notNull(),
    ownerId: uuid('owner_id').references(() => employees.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    terms: text('terms'),
    subtotal: numeric('subtotal', { precision: 16, scale: 2 }).notNull().default('0'),
    discountTotal: numeric('discount_total', { precision: 16, scale: 2 }).notNull().default('0'),
    taxTotal: numeric('tax_total', { precision: 16, scale: 2 }).notNull().default('0'),
    grandTotal: numeric('grand_total', { precision: 16, scale: 2 }).notNull().default('0'),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('sales_documents_org_type_number_uq').on(t.orgId, t.docType, t.number),
    index('sales_documents_org_type_date_idx').on(t.orgId, t.docType, t.date).where(ALIVE),
    index('sales_documents_org_party_idx').on(t.orgId, t.partyId).where(ALIVE),
    index('sales_documents_org_company_idx').on(t.orgId, t.companyId).where(ALIVE),
    index('sales_documents_org_deal_idx').on(t.orgId, t.dealId).where(ALIVE),
    index('sales_documents_org_owner_idx').on(t.orgId, t.ownerId).where(ALIVE),
  ],
);

export const salesDocumentLines = pgTable(
  'sales_document_lines',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => salesDocuments.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    stockItemId: uuid('stock_item_id').references(() => stockItems.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
    unit: text('unit'),
    rate: numeric('rate', { precision: 16, scale: 2 }).notNull(),
    discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    taxPct: numeric('tax_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
    taxAmount: numeric('tax_amount', { precision: 16, scale: 2 }).notNull().default('0'),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('sales_document_lines_doc_line_uq').on(t.documentId, t.lineNo),
    // REQ-W-02: what was quoted for this item, by document.
    index('sales_document_lines_org_item_idx').on(t.orgId, t.stockItemId).where(ALIVE),
  ],
);

/**
 * One row per organisation per document type: the last number issued.
 * Bumped with `UPDATE … RETURNING` inside the insert's transaction, so two
 * estimates raised together cannot share a number and a rolled-back one
 * leaves a gap rather than a duplicate — a gap is a fact, a duplicate is a
 * dispute.
 */
export const salesDocumentSequences = pgTable(
  'sales_document_sequences',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    docType: salesDocumentTypeEnum('doc_type').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (t) => [uniqueIndex('sales_document_sequences_uq').on(t.orgId, t.docType)],
);
