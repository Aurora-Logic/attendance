import type { AgentCondition } from '@vyuha/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

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
  readonly transport: 'unset' | 'agent' | 'webhook';
  readonly webhookInstallId: string | null;
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
  // Same discipline for the sealed webhook secret: presence crosses, bytes
  // never do. The transport is derived here so the two credentials cannot be
  // read as anything but the exclusive pair they are.
  transport: sql<'unset' | 'agent' | 'webhook'>`CASE
    WHEN ${integrationConnections.webhookSecretEnc} IS NOT NULL THEN 'webhook'
    WHEN ${integrationConnections.agentTokenHash} IS NOT NULL THEN 'agent'
    ELSE 'unset' END`,
  webhookInstallId: integrationConnections.webhookInstallId,
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
      transport: 'unset',
      webhookInstallId: null,
    };
  }

  /**
   * Stores (or replaces) the sealed OpsTally signing secret. Refused while an
   * agent token stands: one company, one connection, one door — a row that
   * could be written to by both would be two idempotency scopes over one set
   * of books. Replacing a webhook secret also unbinds the install, because a
   * regenerated secret is how OpsTally rotates, and the next verified
   * delivery re-binds whichever install now holds it.
   */
  async setWebhookSecret(
    id: string,
    sealed: string,
  ): Promise<'stored' | 'not-found' | 'agent-connection'> {
    const rows = await this.db.execute<{ agent: boolean }>(sql`
      WITH cur AS (
        SELECT id, agent_token_hash IS NOT NULL AS agent
          FROM integration_connections
         WHERE id = ${id} AND org_id = ${this.ctx.orgId} AND deleted_at IS NULL
         FOR UPDATE
      )
      UPDATE integration_connections c
         SET webhook_secret_enc = CASE WHEN cur.agent THEN c.webhook_secret_enc ELSE ${sealed} END,
             webhook_install_id = CASE WHEN cur.agent THEN c.webhook_install_id ELSE NULL END,
             updated_at = now(),
             updated_by = ${this.ctx.actorUserId}
        FROM cur
       WHERE c.id = cur.id
       RETURNING cur.agent AS agent
    `);
    const row = rows.rows[0];
    if (row === undefined) return 'not-found';
    return row.agent ? 'agent-connection' : 'stored';
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

/**
 * What the webhook receiver needs to verify and bind a delivery. Not org
 * scoped through `ScopedRepository`, on purpose: the connection id in the URL
 * is the only claim an unauthenticated delivery makes, and the org is read
 * *from* the row, then trusted only after the HMAC has verified.
 */
export interface WebhookConnectionRow {
  readonly id: string;
  readonly orgId: string;
  readonly companyName: string | null;
  readonly webhookSecretEnc: string | null;
  readonly webhookInstallId: string | null;
  readonly agentTokenIssued: boolean;
}

export async function findWebhookConnection(
  db: Database,
  connectionId: string,
): Promise<WebhookConnectionRow | null> {
  const rows = await db
    .select({
      id: integrationConnections.id,
      orgId: integrationConnections.orgId,
      companyName: integrationConnections.companyName,
      webhookSecretEnc: integrationConnections.webhookSecretEnc,
      webhookInstallId: integrationConnections.webhookInstallId,
      agentTokenIssued: sql<boolean>`${integrationConnections.agentTokenHash} IS NOT NULL`,
    })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, connectionId), isNull(integrationConnections.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

