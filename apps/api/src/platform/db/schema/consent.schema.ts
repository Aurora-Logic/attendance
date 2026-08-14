import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../columns.js';
import { users } from './identity.schema.js';
import { organizations } from './organizations.schema.js';

/**
 * REQ-M-03: acceptance of a consent notice, recorded once per user per notice.
 *
 * A platform table for the reason `settings` is one: consent is a generic
 * mechanism -- "this user accepted this named notice at this instant" -- and
 * the attendance module is merely its first consumer, writing
 * 'attendance.punch_capture'. The key strings live in `@vyuha/shared` so both
 * ends spell them identically.
 *
 * `accepted_at` is its own column rather than `created_at` doing double duty:
 * the acceptance instant is the legally meaningful fact, and bookkeeping
 * columns must stay free to mean only bookkeeping.
 *
 * The unique index is partial on the living rows: a withdrawn (soft-deleted)
 * acceptance frees the slot so the notice gates again, and the old row remains
 * as history.
 */
export const consentAcceptances = pgTable(
  'consent_acceptances',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    consentKey: text('consent_key').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('consent_acceptances_user_key_uq')
      .on(t.orgId, t.userId, t.consentKey)
      .where(ALIVE),
  ],
);
