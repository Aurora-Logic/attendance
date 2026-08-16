import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryId } from '../columns.js';
import { integrationConnections } from './integration.schema.js';
import { organizations } from './organizations.schema.js';

/**
 * Projections of Tally masters (09 §1.1 and §4.3, REQ-R-01).
 *
 * Derived, disposable, rebuildable: if these tables were truncated and
 * refilled from a backfill, nothing financial would be lost — that property
 * is a design constraint, not a happy accident, and it is why the rules here
 * differ from every other table in the product:
 *
 * - **No application write path.** Only the sync writer touches these rows.
 *   There is no create endpoint, no edit endpoint, and no repair script that
 *   would make Vyuha's copy disagree with Tally's original (REQ-R-04); a
 *   divergence is fixed by pulling again, never by editing the projection.
 * - **No soft delete.** A master that disappears from Tally is marked
 *   `absent_in_tally` and retained (REQ-R-06), so anything pointing at it
 *   keeps resolving. Deleting a projection row is what a re-pull is for.
 * - **Money is `numeric`, held not computed.** Credit limit and opening
 *   balance are Tally's figures (D-01); they are stored to the paisa and no
 *   code in this application does arithmetic on them.
 *
 * The GUID anchoring lives in `external_refs` — entity type 'party', the
 * projection row as the internal id — so the join key discipline is the same
 * one every synced entity uses.
 */
export const parties = pgTable(
  'parties',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    alias: text('alias'),
    /** Sundry Debtors / Sundry Creditors, verbatim (08 §3: what a party is). */
    parentGroup: text('parent_group').notNull(),
    gstin: text('gstin'),
    address: text('address'),
    creditLimit: numeric('credit_limit'),
    creditDays: integer('credit_days'),
    openingBalance: numeric('opening_balance'),
    /** REQ-R-06: gone from Tally is a fact worth keeping, not a row worth losing. */
    absentInTally: boolean('absent_in_tally').notNull().default(false),
    lastPulledAt: timestamp('last_pulled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('parties_connection_idx').on(t.connectionId, t.name),
    // The Go To source and the parties screen both search by name.
    index('parties_org_name_idx').on(t.orgId, t.name),
  ],
);
