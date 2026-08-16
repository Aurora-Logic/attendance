import { Injectable } from '@nestjs/common';
import {
  AGENT_LEASE_TAKEOVER_MINUTES,
  type CreateIntegrationConnectionInput,
  type IntegrationConnectionView,
  type IntegrationListResponse,
  type IntegrationStatus,
  type IssuedAgentToken,
} from '@vyuha/shared';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { isUniqueViolation } from '../db/pg-error.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import { AgentAuthService } from '../sync/agent-auth.service.js';
import { IntegrationRepository, type ConnectionRow } from './integration.repository.js';


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

  const silentMs = now.getTime() - row.lastHeartbeatAt.getTime();
  if (silentMs > STALE_AFTER_MINUTES * 60_000) return 'STALE';

  // A row that heartbeated a minute ago and still says DISCONNECTED is a
  // writer that forgot to clear the column; the heartbeat is the better
  // evidence, so it wins.
  return row.storedStatus === 'DISCONNECTED' ? 'CONNECTED' : row.storedStatus;
}
