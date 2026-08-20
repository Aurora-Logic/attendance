import { sql } from 'drizzle-orm';
import { check, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../columns.js';
import { organizations } from './organizations.schema.js';
import { stockItems } from './projections.schema.js';

/**
 * Procurement requirements (13 §4.1) and the Vyuha-owned item facts.
 * Platform, not a module (D-35): a requirement hangs off a sales order line
 * and a purchase order line, and the two modules may not import each other.
 * The ids of those lines are held without foreign keys, for the same reason
 * `tasks.subject_id` is.
 */

export const requirementSourceEnum = pgEnum('requirement_source', ['shortage', 'reorder', 'manual']);
export const requirementStateEnum = pgEnum('requirement_state', ['open', 'ordered', 'received', 'closed']);

export const procurementRequirements = pgTable(
  'procurement_requirements',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    stockItemId: uuid('stock_item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
    source: requirementSourceEnum('source').notNull(),
    /** The order and line that stalled (REQ-X-07); null for a reorder breach. */
    salesOrderId: uuid('sales_order_id'),
    salesOrderLineId: uuid('sales_order_line_id'),
    neededBy: date('needed_by', { mode: 'string' }),
    state: requirementStateEnum('state').notNull().default('open'),
    /** Quantity a purchase order line has taken up (REQ-X-10); the rest is still open. */
    orderedQty: numeric('ordered_qty', { precision: 16, scale: 3 }).notNull().default('0'),
    receivedQty: numeric('received_qty', { precision: 16, scale: 3 }).notNull().default('0'),
    closedReason: text('closed_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...standardColumns(),
  },
  (t) => [
    index('procurement_requirements_org_state_idx').on(t.orgId, t.state).where(ALIVE),
    index('procurement_requirements_org_item_idx').on(t.orgId, t.stockItemId).where(ALIVE),
    index('procurement_requirements_order_idx').on(t.salesOrderId),
    check('procurement_requirements_qty_positive', sql`quantity > 0`),
  ],
);

/**
 * D-28: reorder level and minimum order quantity are Vyuha's until Tally is
 * shown to hold them. Beside the projection, not on it — the projection is
 * truncatable and rebuildable and these must survive that.
 */
export const itemSettings = pgTable(
  'item_settings',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    stockItemId: uuid('stock_item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'cascade' }),
    reorderLevel: numeric('reorder_level', { precision: 16, scale: 3 }),
    minimumOrderQty: numeric('minimum_order_qty', { precision: 16, scale: 3 }),
    ...standardColumns(),
  },
  (t) => [uniqueIndex('item_settings_item_uq').on(t.stockItemId)],
);

/** Sequence rows for numbered platform/module records that are not sales documents (dispatches, POs, GRNs). */
export const documentSequences = pgTable(
  'document_sequences',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (t) => [uniqueIndex('document_sequences_uq').on(t.orgId, t.kind)],
);
