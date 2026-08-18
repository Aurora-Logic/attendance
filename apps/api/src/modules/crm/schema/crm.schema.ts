import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../../../platform/db/columns.js';
import { employees, organizations, parties } from '../../../platform/db/schema/index.js';

/**
 * CRM tables (09 §4.4). Vyuha's own records: nothing here is written by the
 * sync engine and nothing here is pushed to Tally (REQ-U-03).
 *
 * `owner_id` is an employee, not a user. 08 §2.1 says a salesperson is also an
 * employee, and §2.2 scopes `crm.*.view.self` "where the user is the owner" —
 * spelling the owner as an employee is what lets `ScopeService` resolve that
 * with the same reporting-chain walk it uses for attendance, rather than a
 * second scoping mechanism keyed on user ids. Nullable: an Admin account with
 * no employee record may still create a company nobody yet owns.
 */

export const crmCompanies = pgTable(
  'crm_companies',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    city: text('city'),
    notes: text('notes'),
    ownerId: uuid('owner_id').references(() => employees.id, { onDelete: 'restrict' }),
    /**
     * REQ-U-03: set on conversion, never at creation. 09 §4.4 sketches this
     * link "via external_refs"; a direct reference to the projection row is
     * used instead because `external_refs` already pins `parties.id` to the
     * Tally GUID (owner-aware adoption keeps that id stable across pulls), so
     * a second GUID-keyed hop would only restate what that table proves.
     * `SET NULL` rather than `RESTRICT`: a rebuilt projection may drop the
     * row, and a company should outlive its link, not block the rebuild.
     */
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    ...standardColumns(),
  },
  (t) => [
    index('crm_companies_org_name_idx').on(t.orgId, t.name).where(ALIVE),
    index('crm_companies_org_owner_idx').on(t.orgId, t.ownerId).where(ALIVE),
  ],
);

export const crmContacts = pgTable(
  'crm_contacts',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    phone: text('phone'),
    /**
     * REQ-U-08's comparison key, kept alongside the typed text so the
     * duplicate check is an index lookup and not a per-row normalisation.
     * Digits only, national significant number (see `normalizePhone`).
     */
    phoneKey: text('phone_key'),
    email: text('email'),
    designation: text('designation'),
    companyId: uuid('company_id').references(() => crmCompanies.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => employees.id, { onDelete: 'restrict' }),
    source: text('source'),
    notes: text('notes'),
    ...standardColumns(),
  },
  (t) => [
    index('crm_contacts_org_name_idx').on(t.orgId, t.name).where(ALIVE),
    index('crm_contacts_org_owner_idx').on(t.orgId, t.ownerId).where(ALIVE),
    index('crm_contacts_org_company_idx').on(t.orgId, t.companyId).where(ALIVE),
    index('crm_contacts_org_phone_key_idx').on(t.orgId, t.phoneKey).where(ALIVE),
    index('crm_contacts_org_email_idx').on(t.orgId, t.email).where(ALIVE),
  ],
);
