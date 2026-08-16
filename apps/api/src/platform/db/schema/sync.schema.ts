import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditColumns, primaryId } from '../columns.js';
import { integrationConnections } from './integration.schema.js';
import { organizations } from './organizations.schema.js';

/**
 * The sync engine's own tables (technical design 09 §4.2, Phase 6b).
 *
 * Three tables, three different mutability rules, and the rules are the
 * design:
 *
 * - `sync_cursors` is mutable state — the AlterID high-water mark per
 *   company per entity type. Deleting a cursor *is* the administrative
 *   re-pull action (REQ-R-05), so it carries no soft delete.
 * - `sync_jobs` is a queue. Rows advance through states and are eventually
 *   swept; they prove nothing and guard nothing.
 * - `sync_journal` is evidence (REQ-Q-06, REQ-T-06). It joins `punches`,
 *   `leave_ledger` and `audit_logs` as trigger-enforced append-only, because
 *   a sync log that can be edited proves nothing in a dispute — and this log
 *   is exactly the artefact somebody will want when a figure is questioned.
 */

export const syncDirectionEnum = pgEnum('sync_direction', ['PULL', 'PUSH']);

export const syncJobStateEnum = pgEnum('sync_job_state', [
  'QUEUED',
  'CLAIMED',
  'DONE',
  'FAILED',
]);

export const syncExceptionStateEnum = pgEnum('sync_exception_state', ['OPEN', 'RESOLVED']);

/**
 * One row per company per entity type: the last AlterID durably committed.
 *
 * `company_created_at` is the cursor's validity anchor (09 §3.2): AlterID
 * resets when a company is restored from backup, and the agent reports the
 * company's own creation timestamp alongside every pull. A change there
 * invalidates the cursor and forces an explicit re-pull, rather than silently
 * skipping every voucher below the old high-water mark.
 */
export const syncCursors = pgTable(
  'sync_cursors',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'restrict' }),
    entityType: text('entity_type').notNull(),
    lastAlterId: bigint('last_alter_id', { mode: 'number' }).notNull().default(0),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    companyCreatedAt: timestamp('company_created_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('sync_cursors_uq').on(t.connectionId, t.entityType)],
);

/**
 * The work queue the agent polls (REQ-Q-02). Claimed under a lease, one
 * agent per company (09 §3.4): `claimed_by` names the lease holder, and a
 * second agent's claim on a claimed job is refused in the claim query, not
 * by convention.
 */
export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'restrict' }),
    direction: syncDirectionEnum('direction').notNull(),
    entityType: text('entity_type').notNull(),
    payload: jsonb('payload'),
    state: syncJobStateEnum('state').notNull().default('QUEUED'),
    attempts: integer('attempts').notNull().default(0),
    claimedBy: text('claimed_by'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    ...auditColumns(),
  },
  // `created_at` is in the index so the claim query walks the queue in order
  // and locks the first available head, instead of sorting every queued row
  // on every poll of a polled endpoint.
  (t) => [
    index('sync_jobs_claim_idx').on(t.connectionId, t.state, t.createdAt),
    /*
     * One open job per connection per entity type. The 15-minute sweep can
     * then enqueue with ON CONFLICT DO NOTHING: an agent that was away for a
     * day finds one waiting job, not ninety-six copies -- and the invariant
     * is the schema's, not the sweep's discipline.
     */
    uniqueIndex('sync_jobs_one_open_uq')
      .on(t.connectionId, t.entityType)
      .where(sql`state IN ('QUEUED', 'CLAIMED')`),
  ],
);

/**
 * Every request and response, with payload hashes (REQ-Q-06).
 *
 * Append-only with one narrow exception, enforced by its own trigger rather
 * than the shared `vyuha_forbid_mutation`: D-20 retains bodies for 30 days
 * and hashes forever, so the sweep must be able to null `request_body` and
 * `response_body` — and must be able to do nothing else. An UPDATE that
 * touches any other column, or that sets a body to anything but NULL, is
 * refused by `vyuha_sync_journal_guard`. The hash is what proves what was
 * sent; the body is bulk that expires.
 */
export const syncJournal = pgTable(
  'sync_journal',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'restrict' }),
    direction: syncDirectionEnum('direction').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    requestHash: text('request_hash').notNull(),
    responseHash: text('response_hash'),
    requestBody: text('request_body'),
    responseBody: text('response_body'),
    result: text('result'),
    errorCode: text('error_code'),
    errorText: text('error_text'),
    durationMs: integer('duration_ms'),
    // No updated_at, no updated_by, no soft delete: nothing here is ever
    // updated except the body sweep, and nothing is ever deleted at all.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    index('sync_journal_connection_idx').on(t.connectionId, t.createdAt),
    // The 30-day sweep selects by age where bodies are still present.
    index('sync_journal_sweep_idx').on(t.createdAt),
  ],
);

/**
 * What a person must look at (REQ-T-01): every unresolved conflict,
 * rejection or ambiguity, with Tally's own words attached.
 *
 * Mutable, unlike the journal, because resolution *is* its lifecycle — but
 * the evidence never lives here. `tally_error` is a copy for the screen; the
 * journal row is the proof, and resolving an exception rewrites nothing
 * about what happened. `kind` is text, not an enum: conflict (REQ-T-02) and
 * drift (REQ-T-08) arrive in later slices, and each producer names its own
 * kind the way `entity_type` already works.
 */
export const syncExceptions = pgTable(
  'sync_exceptions',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    /** Tally's verbatim words, because a paraphrase cannot be acted on. */
    tallyError: text('tally_error').notNull(),
    state: syncExceptionStateEnum('state').notNull().default('OPEN'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    ...auditColumns(),
  },
  // The screen reads "everything open, newest first" per org; the connection
  // detail reads the same per connection.
  (t) => [
    index('sync_exceptions_org_state_idx').on(t.orgId, t.state, t.createdAt),
    index('sync_exceptions_connection_idx').on(t.connectionId, t.state),
  ],
);
