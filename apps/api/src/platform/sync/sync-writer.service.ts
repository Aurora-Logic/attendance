import { Injectable, Logger } from '@nestjs/common';
import type {
  AgentResultsAck,
  AgentResultsInput,
  PartyPullRow,
  PriceListPullRow,
  StockItemPullRow,
} from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { AppError } from '../common/errors.js';
import { isUniqueViolation } from '../db/pg-error.js';
import { InjectDatabase, type Database, type Transaction } from '../db/db.provider.js';
import { requireAgentCompany, type AgentPrincipal } from './agent-principal.js';

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

/**
 * What the mapping lookup decided about a GUID, once the ownership rules
 * have been applied. `internalId` is null when the GUID is unmapped and an
 * insert is the right move.
 */
interface MappingDecision {
  readonly internalId: string | null;
}

/**
 * The two facts every projection write is scoped by. `AgentPrincipal`
 * satisfies it structurally; so does a verified webhook delivery. Nothing
 * below reads more than these, which is what lets one writer serve both
 * doors without a second copy of the ownership rules.
 */
export interface WriterScope {
  readonly orgId: string;
  readonly connectionId: string;
}

@Injectable()
export class SyncWriterService {
  private readonly logger = new Logger(SyncWriterService.name);

  constructor(@InjectDatabase() private readonly db: Database) {}

  async ingest(agent: AgentPrincipal, input: AgentResultsInput): Promise<AgentResultsAck> {
    requireAgentCompany(agent, input.openCompanyGuid);

    const written = await this.db.transaction(async (tx) => {
      /*
       * The job row is the lock and the rulebook: it must be this
       * connection's, claimed by this instance, and about this entity.
       * FOR UPDATE serialises competing posts for one job, and the WHERE is
       * the enforcement — the checks re-state the rule the claim already
       * put in its own predicate, at results time, because a lease can have
       * moved between poll and post.
       */
      const jobs = await tx.execute<{ id: string; payload: unknown; created_at: Date }>(sql`
        SELECT id, payload, created_at FROM sync_jobs
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

      // The discriminant narrows `rows`; a chunk of stock items claiming to
      // be parties never got past validation.
      if (input.entityType === 'party') {
        for (const row of input.rows) await this.upsertParty(tx, agent, row);
      } else if (input.entityType === 'stock_item') {
        for (const row of input.rows) await this.upsertStockItem(tx, agent, row);
      } else {
        for (const row of input.rows) await this.upsertPriceEntry(tx, agent, row);
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
      let committedAlterId = 0;
      if (input.rows.length > 0) {
        const cursor = await tx.execute<{ last_alter_id: number }>(sql`
          INSERT INTO sync_cursors (org_id, connection_id, entity_type, last_alter_id, last_run_at)
          VALUES (${agent.orgId}, ${agent.connectionId}, ${input.entityType}, ${maxAlterId}, now())
          ON CONFLICT (connection_id, entity_type)
          DO UPDATE SET last_alter_id = GREATEST(sync_cursors.last_alter_id, EXCLUDED.last_alter_id),
                        last_run_at = now(),
                        updated_at = now()
          RETURNING last_alter_id
        `);
        committedAlterId = Number(cursor.rows[0]?.last_alter_id ?? maxAlterId);
      }

      if (input.final) {
        /*
         * REQ-R-06, licensed by the payload alone: only a full pull may say
         * what is absent, because only a full pull saw everything. The
         * watermark is the job's created_at, not claimed_at -- the liveness
         * refresh moves claimed_at on every chunk, and the one-open-job
         * invariant guarantees no rival same-entity pull touched mappings in
         * between. Every row this job carried has last_pulled_at after the
         * watermark; whatever does not is gone from Tally, and is marked,
         * never deleted -- anything pointing at it keeps resolving.
         */
        const job = jobs.rows[0];
        const isFull =
          typeof job.payload === 'object' &&
          job.payload !== null &&
          (job.payload as { full?: unknown }).full === true;
        if (isFull && (input.entityType === 'party' || input.entityType === 'stock_item')) {
          await this.markAbsentees(tx, agent, input.entityType, new Date(job.created_at));
        }

        await tx.execute(sql`
          UPDATE sync_jobs SET state = 'DONE', updated_at = now() WHERE id = ${input.jobId}
        `);
      } else {
        // claimed_at doubles as the liveness mark the unstick sweep reads.
        // Without this refresh, a first backfill slower than the takeover
        // threshold is requeued out from under an agent that is actively
        // posting — every chunk after the flip 409s, attempts climb to the
        // cap, and a perfectly healthy large pull is declared FAILED.
        await tx.execute(sql`
          UPDATE sync_jobs SET claimed_at = now(), updated_at = now() WHERE id = ${input.jobId}
        `);
      }

      return { written: input.rows.length, lastAlterId: committedAlterId };
    });

    this.logger.log({
      msg: 'Pull chunk ingested',
      connectionId: agent.connectionId,
      entityType: input.entityType,
      rows: written.written,
      final: input.final,
    });

    return {
      jobId: input.jobId,
      written: written.written,
      // The watermark THIS transaction committed, read inside it via
      // RETURNING — a post-commit read could report a rival chunk's later
      // cursor as if this chunk had established it.
      lastAlterId: written.lastAlterId,
      jobState: input.final ? 'DONE' : 'CLAIMED',
    };
  }

  /** REQ-R-06's marking half; see the final-chunk comment for the licence. */
  private async markAbsentees(
    tx: Transaction,
    agent: WriterScope,
    entityType: 'party' | 'stock_item',
    watermark: Date,
  ): Promise<void> {
    // Two branches rather than an interpolated table name: the projection
    // tables are code, not data, and a fixed statement per table keeps this
    // greppable next to the upserts it mirrors.
    const marked =
      entityType === 'party'
        ? await tx.execute<{ id: string }>(sql`
            UPDATE parties p
               SET absent_in_tally = true, updated_at = now()
              FROM external_refs x
             WHERE x.internal_type = 'party' AND x.internal_id = p.id
               AND x.org_id = ${agent.orgId}
               AND x.system = 'TALLY'
               AND x.entity_type = 'party'
               AND x.connection_id = ${agent.connectionId}
               AND x.deleted_at IS NULL
               AND x.last_pulled_at < ${watermark}
               AND p.connection_id = ${agent.connectionId}
               AND p.absent_in_tally = false
            RETURNING p.id
          `)
        : await tx.execute<{ id: string }>(sql`
            UPDATE stock_items i
               SET absent_in_tally = true, updated_at = now()
              FROM external_refs x
             WHERE x.internal_type = 'stock_item' AND x.internal_id = i.id
               AND x.org_id = ${agent.orgId}
               AND x.system = 'TALLY'
               AND x.entity_type = 'stock_item'
               AND x.connection_id = ${agent.connectionId}
               AND x.deleted_at IS NULL
               AND x.last_pulled_at < ${watermark}
               AND i.connection_id = ${agent.connectionId}
               AND i.absent_in_tally = false
            RETURNING i.id
          `);

    if (marked.rows.length > 0) {
      this.logger.warn({
        msg: 'Masters absent after full pull (REQ-R-06)',
        connectionId: agent.connectionId,
        entityType,
        marked: marked.rows.length,
      });
    }
  }

  /**
   * The projection writes alone, for a source that owns its own transaction,
   * journal row and idempotency (the OpsTally webhook receiver). Same rows,
   * same ownership rules, same "Tally wins": a master reaching Vyuha by push
   * lands exactly as one reaching it by pull would.
   */
  async applyRows(
    tx: Transaction,
    scope: WriterScope,
    rows:
      | { entityType: 'party'; rows: readonly PartyPullRow[] }
      | { entityType: 'stock_item'; rows: readonly StockItemPullRow[] },
  ): Promise<void> {
    if (rows.entityType === 'party') {
      for (const row of rows.rows) await this.upsertParty(tx, scope, row);
    } else {
      for (const row of rows.rows) await this.upsertStockItem(tx, scope, row);
    }
  }

  /*
   * One org-wide lookup, but the decision reads the mapping's OWNER.
   * GUIDs are per-company in Tally, so a mapping held by a *living* other
   * connection is a forgery (or two connections misconfigured onto one
   * company) and refuses — an org-blind upsert here would let connection
   * B's credential overwrite A's projection, the exact crossing the 6b
   * exit gate forbids. A mapping whose owning connection is soft-deleted
   * is different: it is the residue of a replaced connection for the same
   * books, and refusing it would mean a recreated connection could never
   * re-pull its own masters. Those are adopted — repointed to the caller
   * — because the GUID, not the connection row, is the identity of the
   * record (09 §4.1). Stated once, for every GUID-anchored entity type.
   */
  private async resolveMapping(
    tx: Transaction,
    agent: WriterScope,
    entityType: 'party' | 'stock_item',
    guid: string,
  ): Promise<MappingDecision> {
    const existing = await tx.execute<{
      internal_id: string;
      owner_alive: boolean;
      is_mine: boolean;
    }>(sql`
      SELECT x.internal_id,
             (c.id IS NOT NULL AND c.deleted_at IS NULL) AS owner_alive,
             (x.connection_id = ${agent.connectionId}) AS is_mine
        FROM external_refs x
        LEFT JOIN integration_connections c ON c.id = x.connection_id
       WHERE x.org_id = ${agent.orgId}
         AND x.system = 'TALLY'
         AND x.entity_type = ${entityType}
         AND x.external_guid = ${guid}
         AND x.deleted_at IS NULL
       LIMIT 1
    `);

    const mapped = existing.rows[0];
    if (mapped === undefined) return { internalId: null };
    if (!mapped.is_mine && mapped.owner_alive) {
      throw AppError.conflict(
        `GUID ${guid} is already mapped under a different connection. One company, ` +
          'one connection (REQ-Q-03); results cannot cross that line.',
      );
    }
    return { internalId: mapped.internal_id };
  }

  /** Advances the mapping row alongside whichever projection row it anchors. */
  private async touchMapping(
    tx: Transaction,
    agent: WriterScope,
    entityType: 'party' | 'stock_item',
    guid: string,
    alterId: number,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE external_refs
         SET external_alter_id = ${alterId},
             connection_id = ${agent.connectionId},
             last_pulled_at = now(),
             updated_at = now()
       WHERE org_id = ${agent.orgId}
         AND system = 'TALLY'
         AND entity_type = ${entityType}
         AND external_guid = ${guid}
         AND deleted_at IS NULL
    `);
  }

  private async insertMapping(
    tx: Transaction,
    agent: WriterScope,
    entityType: 'party' | 'stock_item',
    guid: string,
    alterId: number,
    internalId: string,
  ): Promise<void> {
    try {
      await tx.execute(sql`
        INSERT INTO external_refs
          (org_id, system, entity_type, external_guid, external_alter_id,
           internal_type, internal_id, connection_id, last_pulled_at)
        VALUES
          (${agent.orgId}, 'TALLY', ${entityType}, ${guid}, ${alterId},
           ${entityType}, ${internalId}, ${agent.connectionId}, now())
      `);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        // A racing chunk mapped the GUID between our lookup and insert. The
        // owner-liveness rule above still applies on the retry; refusing
        // here keeps the race loud instead of absorbing it.
        throw AppError.conflict(
          `GUID ${guid} was mapped concurrently. Retry the chunk; the upsert path will take it.`,
        );
      }
      throw error;
    }
  }

  /**
   * Upsert keyed on the GUID mapping in `external_refs`, the same anchoring
   * every synced entity uses. Two statements per row rather than a clever
   * single one, because the mapping and the projection are different tables
   * with different lifetimes — and at 500 rows per chunk, clarity wins.
   */
  private async upsertParty(
    tx: Transaction,
    agent: WriterScope,
    row: PartyPullRow,
  ): Promise<void> {
    const mapping = await this.resolveMapping(tx, agent, 'party', row.guid);
    if (mapping.internalId !== null) {
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
               connection_id = ${agent.connectionId},
               absent_in_tally = false,
               last_pulled_at = now(),
               updated_at = now()
         WHERE id = ${mapping.internalId}
      `);
      await this.touchMapping(tx, agent, 'party', row.guid, row.alterId);
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
    await this.insertMapping(tx, agent, 'party', row.guid, row.alterId, partyId);
  }

  /** REQ-R-02, the same shape as parties: GUID-anchored, Tally wins. */
  private async upsertStockItem(
    tx: Transaction,
    agent: WriterScope,
    row: StockItemPullRow,
  ): Promise<void> {
    const mapping = await this.resolveMapping(tx, agent, 'stock_item', row.guid);
    if (mapping.internalId !== null) {
      /*
       * Held figures: a source that carries none (undefined) leaves what is
       * stored; a source that carries "0" for a price is saying it could not
       * resolve one -- the OpsTally reference is explicit that zero is not
       * "free" and that a stored non-zero should survive it. Quantity has no
       * such reading: zero on hand is a fact, and lands.
       */
      await tx.execute(sql`
        UPDATE stock_items
           SET name = ${row.name},
               alias = ${row.alias ?? null},
               unit = ${row.unit},
               parent_group = ${row.parentGroup},
               gst_rate = COALESCE(${row.gstRate ?? null}, gst_rate),
               closing_qty = COALESCE(${row.closingQty ?? null}, closing_qty),
               sale_price = CASE
                 WHEN ${row.salePrice ?? null}::numeric IS NULL THEN sale_price
                 WHEN ${row.salePrice ?? null}::numeric = 0 AND sale_price IS NOT NULL AND sale_price <> 0 THEN sale_price
                 ELSE ${row.salePrice ?? null}::numeric END,
               cost_price = CASE
                 WHEN ${row.costPrice ?? null}::numeric IS NULL THEN cost_price
                 WHEN ${row.costPrice ?? null}::numeric = 0 AND cost_price IS NOT NULL AND cost_price <> 0 THEN cost_price
                 ELSE ${row.costPrice ?? null}::numeric END,
               connection_id = ${agent.connectionId},
               absent_in_tally = false,
               last_pulled_at = now(),
               updated_at = now()
         WHERE id = ${mapping.internalId}
      `);
      await this.touchMapping(tx, agent, 'stock_item', row.guid, row.alterId);
      return;
    }

    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO stock_items
        (org_id, connection_id, name, alias, unit, parent_group, gst_rate,
         closing_qty, sale_price, cost_price)
      VALUES
        (${agent.orgId}, ${agent.connectionId}, ${row.name}, ${row.alias ?? null},
         ${row.unit}, ${row.parentGroup}, ${row.gstRate ?? null},
         ${row.closingQty ?? null}, ${row.salePrice ?? null}, ${row.costPrice ?? null})
      RETURNING id
    `);
    const itemId = inserted.rows[0]?.id;
    if (itemId === undefined) throw new Error('Stock item insert returned no row.');
    await this.insertMapping(tx, agent, 'stock_item', row.guid, row.alterId, itemId);
  }

  /**
   * REQ-R-03. A rate has no GUID of its own; its identity is (connection,
   * item, level), and the unique index makes the upsert one statement. The
   * item is resolved through the same ownership rules as everything else —
   * a rate cannot smuggle a reference to another connection's item — and a
   * rate for an item this connection has not pulled yet refuses loudly:
   * the agent orders item chunks before price chunks, so this firing means
   * the ordering broke, not that the data did.
   */
  private async upsertPriceEntry(
    tx: Transaction,
    agent: WriterScope,
    row: PriceListPullRow,
  ): Promise<void> {
    const mapping = await this.resolveMapping(tx, agent, 'stock_item', row.stockItemGuid);
    if (mapping.internalId === null) {
      throw AppError.conflict(
        `Price for stock item GUID ${row.stockItemGuid} arrived before the item itself. ` +
          'Pull stock items before price lists.',
      );
    }

    await tx.execute(sql`
      INSERT INTO price_list_entries
        (org_id, connection_id, stock_item_id, price_level, rate, unit)
      VALUES
        (${agent.orgId}, ${agent.connectionId}, ${mapping.internalId}, ${row.priceLevel},
         ${row.rate}, ${row.unit ?? null})
      ON CONFLICT (connection_id, stock_item_id, price_level)
      DO UPDATE SET rate = EXCLUDED.rate,
                    unit = EXCLUDED.unit,
                    last_pulled_at = now(),
                    updated_at = now()
    `);
  }
}
