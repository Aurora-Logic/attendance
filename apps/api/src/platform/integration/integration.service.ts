import { Injectable } from '@nestjs/common';
import {
  AGENT_LEASE_TAKEOVER_MINUTES,
  type CreateIntegrationConnectionInput,
  type IntegrationConnectionView,
  type IntegrationListResponse,
  type IntegrationStatus,
  type IssuedAgentToken,
  type SyncExceptionKind,
  type SyncExceptionState,
  type SyncExceptionView,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { isUniqueViolation } from '../db/pg-error.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import { sealSecret } from '../auth/secret-box.js';
import { API_PREFIX } from '../common/constants.js';
import { env } from '../common/env.js';
import { AgentAuthService } from '../sync/agent-auth.service.js';
import { IntegrationRepository, type ConnectionRow } from './integration.repository.js';

/** The HKDF info for webhook secrets; changing it orphans every stored one. */
export const WEBHOOK_SECRET_PURPOSE = 'opstally-webhook';

/**
 * Where OpsTally must POST for this connection. The API's own public origin,
 * because the person configuring the Agent is on a Tally machine, not in a
 * terminal with the deployment topology in their head.
 */
export function webhookUrlFor(connectionId: string): string {
  return `${env.API_BASE_URL}/${API_PREFIX}/sync/webhooks/opstally/${connectionId}`;
}


/**
 * Technical design §14, the read half.
 *
 * The Integrations screen has been calling `GET /integrations` since it was
 * built and no controller answered it, so it showed sample data in development
 * and an error in production. This is that endpoint, and it is deliberately
 * only what is true: which connections exist and what state each is in. There
 * is no Tally sync here — that is Phase 6 — and no create, token-issue or
 * rotate, because those are credential operations and a route that appeared to
 * mint a token without one would be worse than no route.
 *
 * **Status is derived, not echoed.** The `status` column is written by whatever
 * last talked to the connection, and a row can outlive the truth of it: a
 * database restored from a backup, or a `CONNECTED` written before an agent was
 * ever installed, would have the screen report a healthy Tally link that does
 * not exist. The heartbeat is the fact; the column is a claim about it.
 */

/**
 * How long a silence lasts before a connection is called stale.
 *
 * Phase 0 defaulted this to fifteen minutes and recorded it as a question
 * (OPEN-QUESTIONS I-1); Phase 6 has the answer. REQ-Q-04 names five minutes
 * as when a missing heartbeat alerts, and the lease takeover threshold is
 * the same number for the same reason — "when do we stop believing the
 * agent is alive" must have one answer, or a connection can change hands
 * while this screen still calls it healthy.
 */
export const STALE_AFTER_MINUTES = AGENT_LEASE_TAKEOVER_MINUTES;

@Injectable()
export class IntegrationService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly agentAuth: AgentAuthService,
    private readonly auditContext: AuditContext,
  ) {}

  async list(principal: Principal, now: Date = new Date()): Promise<IntegrationListResponse> {
    const rows = await new IntegrationRepository(this.db, orgContextOf(principal)).list();

    return {
      data: rows.map((row) => toView(row, now)),
      staleAfterMinutes: STALE_AFTER_MINUTES,
    };
  }

  /** One connection per Tally company (REQ-Q-03). The token is issued separately. */
  async create(
    principal: Principal,
    input: CreateIntegrationConnectionInput,
  ): Promise<IntegrationConnectionView> {
    const repository = new IntegrationRepository(this.db, orgContextOf(principal));

    let row: ConnectionRow;
    try {
      row = await repository.insertConnection({
        name: input.name,
        companyGuid: input.companyGuid ?? null,
        companyName: input.companyName ?? null,
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        // Two live connections can collide on the name, or — REQ-Q-03 held
        // by the schema — on the company GUID. Both mean "this already
        // exists"; the details say which.
        throw AppError.conflict(
          `A connection with this name or Tally company already exists.`,
          { name: input.name, companyGuid: input.companyGuid ?? null },
        );
      }
      throw error;
    }

    this.auditContext.record({
      action: 'integration.connection_created',
      entityType: 'integration_connection',
      entityId: row.id,
      after: { name: input.name, companyGuid: input.companyGuid ?? null },
    });

    return toView(row, new Date());
  }

  /**
   * Issues — or rotates — the agent credential. The token crosses this
   * process exactly once, in this response; only its hash is stored, so
   * there is no path that can show it again. Rotation is the revocation
   * mechanism: the previous token stops resolving the moment the new hash
   * lands, which is also why this is audited with a reason-free shape — the
   * act itself is the fact an auditor wants.
   */
  async issueToken(principal: Principal, connectionId: string): Promise<IssuedAgentToken> {
    const repository = new IntegrationRepository(this.db, orgContextOf(principal));

    // One connection, one door: a webhook connection has no agent token.
    const rows = await repository.list();
    const current = rows.find((row) => row.id === connectionId);
    if (current === undefined) throw AppError.notFound('Connection', connectionId);
    if (current.transport === 'webhook') {
      throw AppError.conflict(
        'This connection receives OpsTally webhooks; it has no agent token. Create a separate ' +
          'connection for a Vyuha agent.',
      );
    }

    const { token, tokenHash } = this.agentAuth.mint();
    const { found, rotated } = await repository.rotateTokenHash(connectionId, tokenHash);
    if (!found) throw AppError.notFound('Connection', connectionId);

    this.auditContext.record({
      action: rotated ? 'integration.token_rotated' : 'integration.token_issued',
      entityType: 'integration_connection',
      entityId: connectionId,
      after: { rotated },
    });

    return { connectionId, token };
  }

  /**
   * Stores the OpsTally signing secret an administrator pasted from the
   * Agent's settings (the reference: "copy it into your own environment").
   * Sealed before it touches the row; the response is the URL to paste back
   * into OpsTally, because the two halves of the handshake are done in two
   * screens by one person and the second half should not have to be looked
   * up. Audited without the secret, as every credential event is.
   */
  async setWebhookSecret(
    principal: Principal,
    connectionId: string,
    secret: string,
  ): Promise<{ connectionId: string; webhookUrl: string }> {
    const repository = new IntegrationRepository(this.db, orgContextOf(principal));
    const sealed = sealSecret(secret, env.JWT_REFRESH_SECRET, WEBHOOK_SECRET_PURPOSE);
    const outcome = await repository.setWebhookSecret(connectionId, sealed);
    if (outcome === 'not-found') throw AppError.notFound('Connection', connectionId);
    if (outcome === 'agent-connection') {
      throw AppError.conflict(
        'This connection has an agent token issued; it cannot also receive webhooks. Create a ' +
          'separate connection for OpsTally.',
      );
    }

    this.auditContext.record({
      action: 'integration.webhook_secret_set',
      entityType: 'integration_connection',
      entityId: connectionId,
      after: { transport: 'webhook' },
    });

    return { connectionId, webhookUrl: webhookUrlFor(connectionId) };
  }

  /**
   * REQ-T-01's list: everything a person still owes a look, newest first.
   * Capped rather than paginated — an exceptions screen holding more than two
   * hundred open rows is not a paging problem, it is an integration on fire,
   * and the cap keeps the endpoint honest while saying so out loud.
   */
  async listExceptions(
    principal: Principal,
    state: SyncExceptionState,
  ): Promise<{ data: SyncExceptionView[] }> {
    const rows = await this.db.execute<{
      id: string;
      connection_id: string;
      connection_name: string;
      kind: SyncExceptionKind;
      entity_type: string | null;
      tally_error: string;
      state: SyncExceptionState;
      created_at: Date;
      resolved_at: Date | null;
      resolution_note: string | null;
    }>(sql`
      SELECT e.id, e.connection_id, c.name AS connection_name, e.kind, e.entity_type,
             e.tally_error, e.state, e.created_at, e.resolved_at, e.resolution_note
        FROM sync_exceptions e
        JOIN integration_connections c ON c.id = e.connection_id
       WHERE e.org_id = ${principal.orgId}
         AND e.state = ${state}
       ORDER BY e.created_at DESC
       LIMIT 200
    `);

    return {
      data: rows.rows.map((row) => ({
        id: row.id,
        connectionId: row.connection_id,
        connectionName: row.connection_name,
        kind: row.kind,
        entityType: row.entity_type,
        tallyError: row.tally_error,
        state: row.state,
        createdAt: new Date(row.created_at).toISOString(),
        resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
        resolutionNote: row.resolution_note,
      })),
    };
  }

  /**
   * Marks an exception handled, with the note that says what "handled" meant.
   * The predicate requires OPEN, so two people resolving the same row cannot
   * both win — the loser is told it was already done, which is information,
   * not an error in their process.
   */
  async resolveException(
    principal: Principal,
    exceptionId: string,
    note: string,
  ): Promise<SyncExceptionView> {
    const updated = await this.db.execute<{ id: string }>(sql`
      UPDATE sync_exceptions
         SET state = 'RESOLVED', resolved_by = ${principal.userId}, resolved_at = now(),
             resolution_note = ${note}, updated_at = now(), updated_by = ${principal.userId}
       WHERE id = ${exceptionId}
         AND org_id = ${principal.orgId}
         AND state = 'OPEN'
       RETURNING id
    `);

    if (updated.rows.length === 0) {
      const existing = await this.db.execute<{ state: SyncExceptionState }>(sql`
        SELECT state FROM sync_exceptions
         WHERE id = ${exceptionId} AND org_id = ${principal.orgId}
      `);
      if (existing.rows[0] === undefined) throw AppError.notFound('Sync exception', exceptionId);
      throw AppError.conflict('This exception was already resolved.');
    }

    this.auditContext.record({
      action: 'sync.exception_resolved',
      entityType: 'sync_exception',
      entityId: exceptionId,
      after: { note },
    });

    const fresh = await this.db.execute<{
      id: string;
      connection_id: string;
      connection_name: string;
      kind: SyncExceptionKind;
      entity_type: string | null;
      tally_error: string;
      state: SyncExceptionState;
      created_at: Date;
      resolved_at: Date | null;
      resolution_note: string | null;
    }>(sql`
      SELECT e.id, e.connection_id, c.name AS connection_name, e.kind, e.entity_type,
             e.tally_error, e.state, e.created_at, e.resolved_at, e.resolution_note
        FROM sync_exceptions e
        JOIN integration_connections c ON c.id = e.connection_id
       WHERE e.id = ${exceptionId} AND e.org_id = ${principal.orgId}
    `);
    const row = fresh.rows[0];
    if (row === undefined) throw new Error('Resolved exception vanished between two statements.');
    return {
      id: row.id,
      connectionId: row.connection_id,
      connectionName: row.connection_name,
      kind: row.kind,
      entityType: row.entity_type,
      tallyError: row.tally_error,
      state: row.state,
      createdAt: new Date(row.created_at).toISOString(),
      resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
      resolutionNote: row.resolution_note,
    };
  }
}

function toView(row: ConnectionRow, now: Date): IntegrationConnectionView {
  return {
    id: row.id,
    system: row.system,
    name: row.name,
    status: statusOf(row, now),
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    tokenIssued: row.tokenIssued,
    companyName: row.companyName,
    lastCondition: row.lastCondition,
    transport: row.transport,
    webhookInstallId: row.webhookInstallId,
  };
}

/**
 * What the screen should say, in the order the facts outrank each other.
 *
 * 1. **Never heard from.** A connection with no heartbeat has never connected,
 *    whatever its column says, and that is what the reader needs to know. This
 *    is the state every connection is in today, because nothing writes a
 *    heartbeat yet.
 * 2. **Reported an error.** An error the agent reported is a fact about the
 *    last exchange, and going quiet afterwards does not undo it — showing
 *    "heartbeat overdue" would replace a diagnosis with a symptom.
 * 3. **Gone quiet.** Heard from once, not lately.
 * 4. Otherwise the stored status, which by now is corroborated by a recent
 *    heartbeat.
 */
function statusOf(row: ConnectionRow, now: Date): IntegrationStatus {
  if (row.lastHeartbeatAt === null) return 'DISCONNECTED';
  if (row.storedStatus === 'ERROR') return 'ERROR';

  // A webhook connection is heard from only when something changed in Tally
  // (OpsTally polls, diffs, and emits on change), so a quiet afternoon is not
  // a silence to alarm about. It is CONNECTED once it has ever delivered; the
  // screen shows the last event's age beside it and lets the reader judge.
  const silentMs = now.getTime() - row.lastHeartbeatAt.getTime();
  if (row.transport !== 'webhook' && silentMs > STALE_AFTER_MINUTES * 60_000) return 'STALE';

  // A row that heartbeated a minute ago and still says DISCONNECTED is a
  // writer that forgot to clear the column; the heartbeat is the better
  // evidence, so it wins.
  return row.storedStatus === 'DISCONNECTED' ? 'CONNECTED' : row.storedStatus;
}
