import type { AgentCondition } from '@vyuha/shared';
import { and, asc, eq, sql } from 'drizzle-orm';

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
  readonly companyName: string | null;
  readonly lastCondition: AgentCondition | null;
  readonly tokenIssued: boolean;
}

/**
 * One selection for every read, so a field added for the screen cannot be
 * present in the list and silently absent from the single-row read — this
 * duplication existed briefly and cost exactly that edit, twice.
 */
const CONNECTION_COLUMNS = {
  id: integrationConnections.id,
  system: integrationConnections.system,
  name: integrationConnections.name,
  storedStatus: integrationConnections.status,
  lastHeartbeatAt: integrationConnections.lastHeartbeatAt,
  companyName: integrationConnections.companyName,
  lastCondition: integrationConnections.lastCondition,
  // A boolean derived in SQL, so the hash itself never crosses the process
  // boundary from the database at all. Written as raw SQL rather than
  // `isNotNull(...)` because drizzle types a bare condition in a select list
  // as `SQL<unknown>`, and an `unknown` here would either need a cast at the
  // call site or leak into the response shape.
  tokenIssued: sql<boolean>`${integrationConnections.agentTokenHash} IS NOT NULL`,
} as const;

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
    return this.db
      .select(CONNECTION_COLUMNS)
      .from(integrationConnections)
      .where(this.scoped())
      .orderBy(asc(integrationConnections.name));
  }

  async findRow(id: string): Promise<ConnectionRow | null> {
    const rows = await this.db
      .select(CONNECTION_COLUMNS)
      .from(integrationConnections)
      .where(and(this.scoped(), eq(integrationConnections.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Through the base class insert (ADR 0001: "the only sanctioned way to
   * reach a scoped table"), so the org and audit stamps come from the one
   * place that owns them. A fresh connection's view needs no read-back:
   * every derived field has exactly one possible value before an agent or a
   * token exists.
   */
  async insertConnection(input: {
    name: string;
    companyGuid: string | null;
    companyName: string | null;
  }): Promise<ConnectionRow> {
    const row = await this.insert({
      system: 'TALLY',
      name: input.name,
      companyGuid: input.companyGuid,
      companyName: input.companyName,
    });
    return {
      id: row.id,
      system: row.system,
      name: row.name,
      storedStatus: row.status,
      lastHeartbeatAt: row.lastHeartbeatAt,
      companyName: row.companyName,
      lastCondition: row.lastCondition,
      tokenIssued: false,
    };
  }

  /**
   * Rotation in one statement, reading "was there a previous token" from the
   * locked pre-image, so two administrators clicking together serialize on
   * the row and each response's audit label is true for the order the writes
   * actually happened in.
   *
   * Rotation is the revocation mechanism, and revocation includes the lease:
   * the deposed instance must not block its replacement for the takeover
   * window, so the holder, the heartbeat and the status reset to a fresh
   * credential epoch — the screen honestly says "never heard from" until the
   * new install reports in.
   */
  async rotateTokenHash(
    id: string,
    tokenHash: string,
  ): Promise<{ found: boolean; rotated: boolean }> {
    const rows = await this.db.execute<{ rotated: boolean }>(sql`
      WITH prev AS (
        SELECT id, agent_token_hash IS NOT NULL AS rotated
          FROM integration_connections
         WHERE id = ${id}
           AND org_id = ${this.ctx.orgId}
           AND deleted_at IS NULL
         FOR UPDATE
      )
      UPDATE integration_connections c
         SET agent_token_hash = ${tokenHash},
             lease_holder = NULL,
             last_heartbeat_at = NULL,
             status = 'DISCONNECTED',
             last_condition = NULL,
             updated_at = now(),
             updated_by = ${this.ctx.actorUserId}
        FROM prev
       WHERE c.id = prev.id
       RETURNING prev.rotated AS rotated
    `);
    const row = rows.rows[0];
    if (row === undefined) return { found: false, rotated: false };
    return { found: true, rotated: row.rotated };
  }
}
