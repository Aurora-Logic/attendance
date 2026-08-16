import { Injectable, Logger } from '@nestjs/common';
import type { AgentResultsAck, AgentResultsInput, PartyPullRow } from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import type { AgentPrincipal } from './agent-principal.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The only code that writes a projection table (09 §1.1, §3.2, REQ-T-03).
 *
 * One chunk, one transaction, and the ordering inside it is the design:
 * rows upsert on GUID, the journal records the exchange, the cursor
 * advances, and — on the final chunk — the job completes, all together or
 * not at all. A crash mid-chunk therefore re-reads a chunk and never skips
 * one: the cursor cannot be ahead of data that committed, and a re-posted
 * chunk upserts the same GUIDs to the same values (idempotent by
 * construction, which is what makes the agent's retry safe).
 *
 * Tally wins, silently (REQ-T-03). A projection row that differs from what
 * the pull carries is normal operation, not a conflict; it is overwritten
 * without ceremony because that is what "system of record" means
 * operationally.
 */
@Injectable()
export class SyncWriterService {
  private readonly logger = new Logger(SyncWriterService.name);

  constructor(@InjectDatabase() private readonly db: Database) {}

  async ingestParties(agent: AgentPrincipal, input: AgentResultsInput): Promise<AgentResultsAck> {
    this.requireRightCompany(agent, input.openCompanyGuid);

    const written = await this.db.transaction(async (tx) => {
      /*
       * The job row is the lock and the rulebook: it must be this
       * connection's, claimed by this instance, and about this entity.
       * FOR UPDATE serialises competing posts for one job, and the WHERE is
       * the enforcement — the checks re-state the rule the claim already
       * put in its own predicate, at results time, because a lease can have
       * moved between poll and post.
       */
      const jobs = await tx.execute<{ id: string }>(sql`
        SELECT id FROM sync_jobs
         WHERE id = ${input.jobId}
           AND connection_id = ${agent.connectionId}
           AND state = 'CLAIMED'
           AND claimed_by = ${input.agentInstanceId}
           AND entity_type = ${input.entityType}
           FOR UPDATE
      `);
      if (jobs.rows[0] === undefined) {
        throw AppError.conflict(
          'These results match no claimed job for this connection and instance. The job may ' +
            'have been completed, failed, or claimed over; poll again rather than re-posting.',
        );
      }

      for (const row of input.rows) {
        await this.upsertParty(tx, agent, row);
      }

      // REQ-Q-06: the exchange, hashed. `result` is the writer's outcome —
      // the agent's own errors arrive on the errors endpoint, never here.
      await tx.execute(sql`
        INSERT INTO sync_journal
          (org_id, connection_id, direction, entity_type, request_hash, response_hash,
           request_body, response_body, result, duration_ms)
        VALUES
          (${agent.orgId}, ${agent.connectionId}, 'PULL', ${input.entityType},
           ${input.requestHash}, ${input.responseHash},
           ${input.requestBody ?? null}, ${input.responseBody ?? null},
           ${`ok: ${String(input.rows.length)} rows`}, ${input.durationMs ?? null})
      `);

      /*
       * GREATEST, not assignment: chunks can arrive with interleaved AlterID
       * ranges after a retry, and a cursor that moved backwards would
       * re-request everything above the lower mark forever. Advancing only
       * inside the transaction that committed the rows is the property 09
       * §3.2 names: a crash re-reads a chunk, it never skips one.
       */
      const maxAlterId = input.rows.reduce((max, row) => Math.max(max, row.alterId), 0);
      if (input.rows.length > 0) {
        await tx.execute(sql`
          INSERT INTO sync_cursors (org_id, connection_id, entity_type, last_alter_id, last_run_at)
          VALUES (${agent.orgId}, ${agent.connectionId}, ${input.entityType}, ${maxAlterId}, now())
          ON CONFLICT (connection_id, entity_type)
          DO UPDATE SET last_alter_id = GREATEST(sync_cursors.last_alter_id, EXCLUDED.last_alter_id),
                        last_run_at = now(),
                        updated_at = now()
        `);
      }

      if (input.final) {
        await tx.execute(sql`
          UPDATE sync_jobs SET state = 'DONE', updated_at = now() WHERE id = ${input.jobId}
        `);
      }

      return input.rows.length;
    });

    const cursor = await this.db.execute<{ last_alter_id: number }>(sql`
      SELECT last_alter_id FROM sync_cursors
       WHERE connection_id = ${agent.connectionId} AND entity_type = ${input.entityType}
    `);

    this.logger.log({
      msg: 'Pull chunk ingested',
      connectionId: agent.connectionId,
      entityType: input.entityType,
      rows: written,
      final: input.final,
    });

    return {
      jobId: input.jobId,
      written,
      lastAlterId: Number(cursor.rows[0]?.last_alter_id ?? 0),
      jobState: input.final ? 'DONE' : 'CLAIMED',
    };
  }

  /**
   * Upsert keyed on the GUID mapping in `external_refs`, the same anchoring
   * every synced entity uses. Two statements per row rather than a clever
   * single one, because the mapping and the projection are different tables
   * with different lifetimes — and at 500 rows per chunk, clarity wins.
   */
  private async upsertParty(
    tx: Transaction,
    agent: AgentPrincipal,
    row: PartyPullRow,
  ): Promise<void> {
    const existing = await tx.execute<{ internal_id: string }>(sql`
      SELECT internal_id FROM external_refs
       WHERE org_id = ${agent.orgId}
         AND system = 'TALLY'
         AND entity_type = 'party'
         AND external_guid = ${row.guid}
         AND deleted_at IS NULL
       LIMIT 1
    `);

    const mapped = existing.rows[0];
    if (mapped !== undefined) {
      await tx.execute(sql`
        UPDATE parties
           SET name = ${row.name},
               alias = ${row.alias ?? null},
               parent_group = ${row.parentGroup},
               gstin = ${row.gstin ?? null},
               address = ${row.address ?? null},
               credit_limit = ${row.creditLimit ?? null},
               credit_days = ${row.creditDays ?? null},
               opening_balance = ${row.openingBalance ?? null},
               absent_in_tally = false,
               last_pulled_at = now(),
               updated_at = now()
         WHERE id = ${mapped.internal_id}
      `);
      await tx.execute(sql`
        UPDATE external_refs
           SET external_alter_id = ${row.alterId},
               connection_id = ${agent.connectionId},
               last_pulled_at = now(),
               updated_at = now()
         WHERE org_id = ${agent.orgId}
           AND system = 'TALLY'
           AND entity_type = 'party'
           AND external_guid = ${row.guid}
           AND deleted_at IS NULL
      `);
      return;
    }

    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO parties
        (org_id, connection_id, name, alias, parent_group, gstin, address,
         credit_limit, credit_days, opening_balance)
      VALUES
        (${agent.orgId}, ${agent.connectionId}, ${row.name}, ${row.alias ?? null},
         ${row.parentGroup}, ${row.gstin ?? null}, ${row.address ?? null},
         ${row.creditLimit ?? null}, ${row.creditDays ?? null}, ${row.openingBalance ?? null})
      RETURNING id
    `);
    const partyId = inserted.rows[0]?.id;
    if (partyId === undefined) throw new Error('Party insert returned no row.');

    await tx.execute(sql`
      INSERT INTO external_refs
        (org_id, system, entity_type, external_guid, external_alter_id,
         internal_type, internal_id, connection_id, last_pulled_at)
      VALUES
        (${agent.orgId}, 'TALLY', 'party', ${row.guid}, ${row.alterId},
         'party', ${partyId}, ${agent.connectionId}, now())
    `);
  }

  /** The same refusal the claim makes, for the same reason (09 §7). */
  private requireRightCompany(agent: AgentPrincipal, openCompanyGuid: string): void {
    if (agent.companyGuid === null || openCompanyGuid !== agent.companyGuid) {
      throw AppError.conflict(
        'These results claim to come from a company this connection is not bound to. ' +
          'Results for the wrong books are refused, never quarantined into the projection.',
        { expectedCompanyGuid: agent.companyGuid },
      );
    }
  }
}
