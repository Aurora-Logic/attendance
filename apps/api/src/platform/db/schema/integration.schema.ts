import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { ALIVE, primaryId, standardColumns } from '../columns.js';
import { organizations } from './organizations.schema.js';

export const integrationSystemEnum = pgEnum('integration_system', ['TALLY']);
export const integrationStatusEnum = pgEnum('integration_status', [
  'DISCONNECTED',
  'CONNECTED',
  'STALE',
  'ERROR',
]);

/**
 * Technical design §14, Phase 0 scope: the tables and the interface exist now
 * so Phase 6 is additive. Nothing syncs yet, and the stubbed provider only
 * heartbeats.
 *
 * The agent authenticates with a per-connection token and calls outbound only,
 * so Tally's port 9000 never faces the internet (§14.1).
 */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    system: integrationSystemEnum('system').notNull(),
    name: text('name').notNull(),
    status: integrationStatusEnum('status').notNull().default('DISCONNECTED'),
    agentTokenHash: text('agent_token_hash'),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    config: jsonb('config'),
    ...standardColumns(),
  },
  (t) => [uniqueIndex('integration_connections_uq').on(t.orgId, t.system, t.name).where(ALIVE)],
);

/**
 * Technical design §14.2, and the reason Phase 6 is possible at all.
 *
 * Tally identifies masters by a stable GUID and tracks changes with a
 * monotonic ALTERID. Storing both lets an incremental sync ask only for
 * records newer than the last one seen, instead of re-importing everything.
 *
 * Mapping is explicit and never inferred: a name match between a Tally ledger
 * and an internal record is a suggestion for a human to confirm, never an
 * automatic link. Two employees called the same thing is not a hypothetical.
 */
export const externalRefs = pgTable(
  'external_refs',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    system: integrationSystemEnum('system').notNull(),

    entityType: text('entity_type').notNull(),
    externalGuid: text('external_guid').notNull(),
    externalAlterId: bigint('external_alter_id', { mode: 'number' }),

    /** `EMPLOYEE` is required in Phase 0 per §14.3 step 1. */
    internalType: text('internal_type').notNull(),
    internalId: uuid('internal_id').notNull(),

    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    ...standardColumns(),
  },
  (t) => [
    uniqueIndex('external_refs_external_uq')
      .on(t.orgId, t.system, t.entityType, t.externalGuid)
      .where(ALIVE),
    // One internal record maps to at most one external record per system, or
    // the conflict rule in §14.2 has no single answer about what Tally wins over.
    uniqueIndex('external_refs_internal_uq')
      .on(t.orgId, t.system, t.internalType, t.internalId)
      .where(ALIVE),
    index('external_refs_alter_idx').on(t.orgId, t.system, t.entityType, t.externalAlterId),
  ],
);
