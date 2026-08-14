import { asc, sql } from 'drizzle-orm';

import type { Database } from '../db/db.provider.js';
import { integrationConnections } from '../db/schema/index.js';
import { ScopedRepository, type OrgContext } from '../db/scoped-repository.js';

/** One row as the service reads it. `agentTokenHash` is never selected. */
export interface ConnectionRow {
  readonly id: string;
  readonly system: 'TALLY';
  readonly name: string;
  readonly storedStatus: 'DISCONNECTED' | 'CONNECTED' | 'STALE' | 'ERROR';
  readonly lastHeartbeatAt: Date | null;
  readonly tokenIssued: boolean;
}

/**
 * Reads for `integration_connections` (technical design §14).
 *
 * `agent_token_hash` is deliberately absent from the select list rather than
 * fetched and dropped later. It is a credential; the safest place for it is a
 * column no read path in this process ever names, and a `SELECT *` that later
 * grew a serializer is exactly how one leaks.
 */
export class IntegrationRepository extends ScopedRepository<typeof integrationConnections> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, integrationConnections, ctx);
  }

  async list(): Promise<ConnectionRow[]> {
    const rows = await this.db
      .select({
        id: integrationConnections.id,
        system: integrationConnections.system,
        name: integrationConnections.name,
        storedStatus: integrationConnections.status,
        lastHeartbeatAt: integrationConnections.lastHeartbeatAt,
        // A boolean derived in SQL, so the hash itself never crosses the
        // process boundary from the database at all. Written as raw SQL rather
        // than `isNotNull(...)` because drizzle types a bare condition in a
        // select list as `SQL<unknown>`, and an `unknown` here would either
        // need a cast at the call site or leak into the response shape.
        tokenIssued: sql<boolean>`${integrationConnections.agentTokenHash} IS NOT NULL`,
      })
      .from(integrationConnections)
      .where(this.scoped())
      .orderBy(asc(integrationConnections.name));

    return rows;
  }
}
