import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryId } from '../columns.js';
import { organizations } from './organizations.schema.js';

/**
 * REQ-M-01. Append-only: no updates, no deletes, and therefore deliberately no
 * `updated_at`, `updated_by`, or `deleted_at` — carrying those columns would
 * imply a mutation path that must never exist.
 *
 * The migration additionally revokes UPDATE and DELETE on this table from the
 * application role. A convention that only lives in a code review is not a
 * control; REQ-B-09a makes this one of the two tables Admin cannot edit.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),

    actorUserId: uuid('actor_user_id'),
    /** Set when an admin is acting as another user, so both identities survive. */
    impersonatorUserId: uuid('impersonator_user_id'),

    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),

    before: jsonb('before'),
    after: jsonb('after'),

    ip: text('ip'),
    userAgent: text('user_agent'),
    /** Ties an audit row back to the request that produced it in the logs. */
    requestId: text('request_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Technical design §4.3. This is the per-record history panel query
    // (REQ-M-02), so descending created_at is part of the index, not a sort.
    index('audit_logs_entity_idx').on(t.orgId, t.entityType, t.entityId, t.createdAt.desc()),
    index('audit_logs_actor_idx').on(t.orgId, t.actorUserId, t.createdAt.desc()),
    index('audit_logs_created_idx').on(t.orgId, t.createdAt.desc()),
  ],
);
