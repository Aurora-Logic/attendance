import { Injectable, Logger } from '@nestjs/common';
import { SYNC_ENTITY_TYPES, type SyncEntityType } from '@vyuha/shared';
import { sql } from 'drizzle-orm';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';

/**
 * What may actually be pulled today: only the entity types a writer exists
 * for. `SYNC_ENTITY_TYPES` is the contract's full vocabulary; this list
 * grows a member per writer, because a job the agent can claim but whose
 * results the API refuses is a treadmill, not a queue.
 */
export const PULL_ENTITY_TYPES: readonly SyncEntityType[] = ['party'];

/**
 * Makes pull work exist (REQ-R-07): on the 15-minute sweep, and on demand.
 *
 * The interesting property is what this deliberately does not do — it never
 * checks whether a job is already open. The `sync_jobs_one_open_uq` index
 * holds "one open job per connection per entity type", and the enqueue is
 * `ON CONFLICT DO NOTHING` against it, so an agent that was away for a day
 * finds one waiting job rather than ninety-six copies, and two sweeps racing
 * cannot double-enqueue. The invariant lives in the schema; this service
 * only ever tries.
 */
@Injectable()
export class SyncSchedulerService {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
  ) {}

  /**
   * A pull job per eligible connection per writable entity type.
   *
   * Eligible means the job could actually be claimed: the connection is
   * alive, bound to a company (the claim refuses unbound ones), and holds an
   * issued credential (nothing could ever present otherwise). Enqueuing for
   * the ineligible would fill the queue with work whose refusal is already
   * known.
   */
  async enqueueDuePulls(): Promise<{ enqueued: number }> {
    let enqueued = 0;
    for (const entityType of PULL_ENTITY_TYPES) {
      const result = await this.db.execute<{ id: string }>(sql`
        INSERT INTO sync_jobs (org_id, connection_id, direction, entity_type)
        SELECT c.org_id, c.id, 'PULL', ${entityType}
          FROM integration_connections c
         WHERE c.deleted_at IS NULL
           AND c.company_guid IS NOT NULL
           AND c.agent_token_hash IS NOT NULL
        ON CONFLICT (connection_id, entity_type) WHERE state IN ('QUEUED', 'CLAIMED')
        DO NOTHING
        RETURNING id
      `);
      enqueued += result.rows.length;
    }

    if (enqueued > 0) {
      this.logger.log({ msg: 'Pull jobs enqueued by sweep', enqueued });
    }
    return { enqueued };
  }

  /**
   * REQ-R-07's "and on demand" (09 §5's manual pull), from the Integrations
   * screen. The refusals name their rule: an entity type without a writer is
   * a build limitation worth saying plainly, and an already-open job means
   * the ask is already answered — the existing job is returned rather than
   * an error page.
   */
  async enqueueManualPull(
    principal: Principal,
    connectionId: string,
    requested: string,
  ): Promise<{ jobId: string; entityType: SyncEntityType; alreadyQueued: boolean }> {
    const entityType = PULL_ENTITY_TYPES.find((candidate) => candidate === requested);
    if (entityType === undefined) {
      const known = (SYNC_ENTITY_TYPES as readonly string[]).includes(requested);
      throw AppError.validation(
        known
          ? `This build cannot pull "${requested}" yet; its writer lands later in Phase 6b.`
          : `"${requested}" is not a sync entity type.`,
        { fields: [{ path: 'entityType', message: 'not pullable' }] },
      );
    }

    const ctx = orgContextOf(principal);
    const eligible = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM integration_connections
       WHERE id = ${connectionId}
         AND org_id = ${ctx.orgId}
         AND deleted_at IS NULL
         AND company_guid IS NOT NULL
         AND agent_token_hash IS NOT NULL
    `);
    if (eligible.rows[0] === undefined) {
      throw AppError.conflict(
        'This connection cannot be pulled: it must exist, be bound to a Tally company, and ' +
          'have an agent token issued. Bind the company and issue the token first.',
      );
    }

    const inserted = await this.db.execute<{ id: string }>(sql`
      INSERT INTO sync_jobs (org_id, connection_id, direction, entity_type, created_by)
      VALUES (${ctx.orgId}, ${connectionId}, 'PULL', ${entityType}, ${ctx.actorUserId})
      ON CONFLICT (connection_id, entity_type) WHERE state IN ('QUEUED', 'CLAIMED')
      DO NOTHING
      RETURNING id
    `);

    const insertedId = inserted.rows[0]?.id;
    if (insertedId !== undefined) {
      this.auditContext.record({
        action: 'sync.pull_requested',
        entityType: 'integration_connection',
        entityId: connectionId,
        after: { syncEntityType: entityType, jobId: insertedId },
      });
      return { jobId: insertedId, entityType, alreadyQueued: false };
    }

    // The invariant answered: a job is already open. Saying which one keeps
    // the screen honest instead of making a second press look like a fault.
    const open = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM sync_jobs
       WHERE connection_id = ${connectionId}
         AND entity_type = ${entityType}
         AND state IN ('QUEUED', 'CLAIMED')
       LIMIT 1
    `);
    const openId = open.rows[0]?.id;
    if (openId === undefined) {
      // The conflict target vanished between statements — a claim completed
      // it in the gap. Trying once more would almost certainly succeed, but
      // the sweep is minutes away and a plain answer beats a loop here.
      throw AppError.conflict('The queue moved while enqueuing; try again.');
    }
    return { jobId: openId, entityType, alreadyQueued: true };
  }
}
