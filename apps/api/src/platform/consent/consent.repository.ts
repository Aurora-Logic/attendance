import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../db/db.provider.js';
import { consentAcceptances } from '../db/schema/index.js';
import { ScopedRepository, type OrgContext } from '../db/scoped-repository.js';

/**
 * REQ-M-03. One table, two questions: has this user accepted this notice, and
 * record that they just did.
 */

export interface AcceptanceRow {
  readonly id: string;
  readonly acceptedAt: Date;
}

export class ConsentRepository extends ScopedRepository<typeof consentAcceptances> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, consentAcceptances, ctx);
  }

  async findAcceptance(userId: string, consentKey: string): Promise<AcceptanceRow | null> {
    const rows = await this.db
      .select({ id: consentAcceptances.id, acceptedAt: consentAcceptances.acceptedAt })
      .from(consentAcceptances)
      .where(
        and(
          eq(consentAcceptances.orgId, this.ctx.orgId),
          eq(consentAcceptances.userId, userId),
          eq(consentAcceptances.consentKey, consentKey),
          isNull(consentAcceptances.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Inserts the acceptance, or returns null when the unique index refused it
   * because another request carrying the same acceptance committed first. The
   * caller re-reads and answers with the winner, exactly as the punch replay
   * path does -- the index is the authority, not a pre-check.
   */
  async insertAcceptance(userId: string, consentKey: string): Promise<AcceptanceRow | null> {
    const rows = await this.db
      .insert(consentAcceptances)
      .values({
        orgId: this.ctx.orgId,
        userId,
        consentKey,
        createdBy: this.ctx.actorUserId,
        updatedBy: this.ctx.actorUserId,
      })
      .onConflictDoNothing({
        target: [consentAcceptances.orgId, consentAcceptances.userId, consentAcceptances.consentKey],
        // The index is partial, so the conflict target must repeat its predicate.
        where: sql`deleted_at IS NULL`,
      })
      .returning({ id: consentAcceptances.id, acceptedAt: consentAcceptances.acceptedAt });
    return rows[0] ?? null;
  }
}
