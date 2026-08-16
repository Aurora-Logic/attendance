import { Injectable, Logger } from '@nestjs/common';
import {
  AGENT_LEASE_TAKEOVER_MINUTES,
  type AgentClaimInput,
  type AgentClaimResponse,
  type AgentCondition,
  type AgentHeartbeatAck,
  type AgentHeartbeatInput,
  type ClaimedSyncJob,
} from '@vyuha/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { integrationConnections } from '../db/schema/index.js';
import type { AgentPrincipal } from './agent-principal.js';

/**
 * What the agent may do once its credential has resolved: say it is alive,
 * and ask for work (REQ-Q-02, REQ-Q-04, 09 §3.4).
 *
 * The lease is the invariant both methods defend — one agent per company,
 * because two agents pulling one cursor double-import and two pushing race
 * the idempotency check. Every decision that must hold under concurrency is
 * a predicate inside its own UPDATE, never an application-side check against
 * the principal's snapshot: the heartbeat's lease handover, and the claim's
 * lease-and-company requirement, are both enforced by the statement that
 * acts on them. The app-side checks exist only to turn a zero-row result
 * into a refusal that names its rule.
 *
 * Takeover timing: a rival may take a lease whose holder has been silent
 * past `AGENT_LEASE_TAKEOVER_MINUTES` — the same threshold the Integrations
 * screen uses for its STALE label, deliberately one number, so a connection
 * cannot change hands while the screen still calls it healthy.
 */
@Injectable()
export class SyncAgentService {
  private readonly logger = new Logger(SyncAgentService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
  ) {}

  async heartbeat(agent: AgentPrincipal, input: AgentHeartbeatInput): Promise<AgentHeartbeatAck> {
    const condition = this.effectiveCondition(agent, input);

    /*
     * The lease changes hands inside the UPDATE's own predicate, so two rival
     * instances heartbeating together cannot both win: whichever statement
     * runs second sees the row the first one wrote and matches nothing.
     *
     * `updated_by` is explicitly null: this is a machine writing, and leaving
     * the last human editor's id under a fresh timestamp would read as that
     * person editing the connection around the clock.
     */
    // Postgres's clock on both sides of the comparison. The written
    // last_heartbeat_at and the takeover cutoff must come from one clock —
    // with two API instances whose clocks disagree, a JS-computed cutoff
    // widens or narrows the window by the skew, and a rival could seize a
    // lease from a live agent.
    const updated = await this.db
      .update(integrationConnections)
      .set({
        leaseHolder: input.agentInstanceId,
        lastHeartbeatAt: sql`now()`,
        agentVersion: input.agentVersion,
        tallyVersion: input.tallyVersion ?? null,
        status: condition === 'OK' ? 'CONNECTED' : 'ERROR',
        lastCondition: condition,
        updatedAt: sql`now()`,
        updatedBy: null,
      })
      .where(
        and(
          eq(integrationConnections.id, agent.connectionId),
          isNull(integrationConnections.deletedAt),
          sql`(
            ${integrationConnections.leaseHolder} IS NULL
            OR ${integrationConnections.leaseHolder} = ${input.agentInstanceId}
            OR ${integrationConnections.lastHeartbeatAt} IS NULL
            OR ${integrationConnections.lastHeartbeatAt} < now() - make_interval(mins => ${AGENT_LEASE_TAKEOVER_MINUTES})
          )`,
        ),
      )
      .returning({ companyGuid: integrationConnections.companyGuid });

    const row = updated[0];
    if (row === undefined) {
      // 09 §3.4: two agents, one company — the second is refused, and the
      // refusal names the rule rather than reading as a credential problem.
      throw AppError.conflict(
        `Another agent instance holds this connection's lease. One agent per company; ` +
          `the lease frees ${String(AGENT_LEASE_TAKEOVER_MINUTES)} minutes after its holder's last heartbeat.`,
        { leaseTakeoverMinutes: AGENT_LEASE_TAKEOVER_MINUTES },
      );
    }

    if (agent.leaseHolder !== null && agent.leaseHolder !== input.agentInstanceId) {
      // A takeover is an operational event somebody may need to explain later
      // — two installs fighting is a misconfiguration this row is evidence
      // of. Recorded through the context so the interceptor attaches ip,
      // user agent and request id: for this event the caller's address IS
      // the evidence.
      this.auditContext.record({
        orgId: agent.orgId,
        actorUserId: null,
        action: 'sync.lease_taken_over',
        entityType: 'integration_connection',
        entityId: agent.connectionId,
        before: { leaseHolder: agent.leaseHolder },
        after: { leaseHolder: input.agentInstanceId },
      });
      this.logger.warn({
        msg: 'Sync lease taken over after silence',
        connectionId: agent.connectionId,
        previousHolder: agent.leaseHolder,
        newHolder: input.agentInstanceId,
      });
    } else {
      // Routine keepalive, the same reasoning as POST /auth/refresh: one row
      // per agent per minute would bury the entries that matter. The status
      // and condition it wrote are readable on the connection itself.
      this.auditContext.suppress();
    }

    return {
      connectionId: agent.connectionId,
      companyGuid: row.companyGuid,
      condition,
      leaseTakeoverMinutes: AGENT_LEASE_TAKEOVER_MINUTES,
    };
  }

  /**
   * The next queued job for this connection, claimed atomically.
   *
   * The inner SELECT joins the connection and restates the lease, the bound
   * company and liveness — not because the app-side checks below are
   * distrusted, but because they read a snapshot from credential resolution,
   * and between that read and this statement a rival can have taken the
   * lease (its holder went silent, its claim loop did not). With the rule in
   * the predicate, a stale claimant matches zero rows; the checks below only
   * exist to turn that into a refusal that names which rule refused.
   *
   * `FOR UPDATE SKIP LOCKED` makes a double poll harmless: two requests
   * racing on one queue each lock a different row or find none, and a job
   * can never be handed out twice.
   */
  async claim(agent: AgentPrincipal, input: AgentClaimInput): Promise<AgentClaimResponse> {
    this.requireLease(agent, input.agentInstanceId);
    this.requireRightCompany(agent, input.openCompanyGuid);

    const rows = await this.db.execute<{
      id: string;
      direction: 'PULL' | 'PUSH';
      entity_type: string;
      payload: unknown;
      attempts: number;
    }>(sql`
      UPDATE sync_jobs
         SET state = 'CLAIMED',
             claimed_by = ${input.agentInstanceId},
             claimed_at = now(),
             attempts = attempts + 1,
             updated_at = now()
       WHERE id = (
         SELECT j.id
           FROM sync_jobs j
           JOIN integration_connections c
             ON c.id = j.connection_id
            AND c.deleted_at IS NULL
            AND c.lease_holder = ${input.agentInstanceId}
            AND c.company_guid = ${input.openCompanyGuid ?? null}
          WHERE j.connection_id = ${agent.connectionId}
            AND j.state = 'QUEUED'
          ORDER BY j.created_at
          LIMIT 1
          FOR UPDATE OF j SKIP LOCKED
       )
       RETURNING id, direction, entity_type, payload, attempts
    `);

    // The claim is the audit trail here: sync_jobs carries claimed_by and
    // claimed_at, and an audit row per poll of an empty queue would be noise.
    this.auditContext.suppress();

    const row = rows.rows[0];
    if (row === undefined) return { job: null };

    const job: ClaimedSyncJob = {
      id: row.id,
      direction: row.direction,
      entityType: row.entity_type,
      payload: row.payload,
      attempts: row.attempts,
    };
    return { job };
  }

  // ------------------------------------------------------------- internals

  /**
   * REQ-Q-05, the server's half: whatever the agent self-reports, a reported
   * company GUID that disagrees with the bound one is `WRONG_COMPANY_OPEN` —
   * a confused agent cannot call the wrong books "OK". An unbound connection
   * cannot mismatch; an agent that omitted the GUID is reporting a condition
   * where no company is readable, which its own `condition` already names.
   */
  private effectiveCondition(agent: AgentPrincipal, input: AgentHeartbeatInput): AgentCondition {
    if (input.condition !== 'OK') return input.condition;
    if (
      agent.companyGuid !== null &&
      input.openCompanyGuid !== undefined &&
      input.openCompanyGuid !== agent.companyGuid
    ) {
      return 'WRONG_COMPANY_OPEN';
    }
    return 'OK';
  }

  /** Claims are lease-holder only; the heartbeat is where a lease is won. */
  private requireLease(agent: AgentPrincipal, instanceId: string): void {
    if (agent.leaseHolder === instanceId) return;
    throw AppError.conflict(
      'This instance does not hold the connection lease. Heartbeat first; if another ' +
        'instance is alive, only it may claim work.',
    );
  }

  /**
   * 09 §7: jobs for a company the agent does not have open are refused rather
   * than executed against the wrong books. Stated per claim rather than
   * remembered from the last heartbeat, so a company switch between polls
   * cannot slip a job through.
   */
  private requireRightCompany(agent: AgentPrincipal, openCompanyGuid: string | undefined): void {
    if (agent.companyGuid === null) {
      throw AppError.conflict(
        'This connection is not yet bound to a Tally company, so no work can be claimed. ' +
          'An administrator sets the company GUID on the connection first.',
      );
    }
    if (openCompanyGuid !== agent.companyGuid) {
      throw AppError.conflict(
        `Tally has ${openCompanyGuid === undefined ? 'no company' : 'a different company'} open, ` +
          'and a job executed against the wrong books is worse than one that waits. ' +
          'Open the bound company and poll again.',
        { expectedCompanyGuid: agent.companyGuid },
      );
    }
  }
}
