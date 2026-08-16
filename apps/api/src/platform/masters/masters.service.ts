import { Injectable } from '@nestjs/common';
import {
  pageSlice,
  paginated,
  type Paginated,
  type PartyListQuery,
  type PartyView,
} from '@vyuha/shared';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';

import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { parties } from '../db/schema/index.js';
import { masterSearch } from '../org/master-query.js';
import { type Principal } from '../rbac/principal.js';

/**
 * Reads over the parties projection (REQ-R-01). Reads only — the projection
 * has exactly one writer, `SyncWriterService`, and this service exists so
 * screens never touch the table directly.
 *
 * No `ScopeService` here, deliberately: 08 §2.2 gives `masters.tally.view`
 * as a single organisation-wide key with no self/team breadths. A party is
 * the organisation's customer, not somebody's record; holders see the list.
 */
@Injectable()
export class MastersService {
  constructor(@InjectDatabase() private readonly db: Database) {}

  async listParties(principal: Principal, query: PartyListQuery): Promise<Paginated<PartyView>> {
    const { limit, offset } = pageSlice(query);
    const where = this.partyPredicate(principal, query);

    // Independent statements; paying two round trips in sequence would
    // double the endpoint's latency for nothing.
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(parties)
        .where(where)
        .orderBy(asc(parties.name), asc(parties.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ value: sql<number>`count(*)::int` }).from(parties).where(where),
    ]);

    return paginated(rows.map(toView), query, total[0]?.value ?? 0);
  }

  async findParty(principal: Principal, id: string): Promise<PartyView> {
    const rows = await this.db
      .select()
      .from(parties)
      .where(and(eq(parties.orgId, principal.orgId), eq(parties.id, id)))
      .limit(1);
    const row = rows[0];
    // Cross-org and non-existent are one answer, as everywhere else.
    if (row === undefined) throw AppError.notFound('Party', id);
    return toView(row);
  }

  private partyPredicate(principal: Principal, query: PartyListQuery): SQL {
    const parts: (SQL | undefined)[] = [eq(parties.orgId, principal.orgId)];

    if (query.parentGroup !== undefined) {
      parts.push(eq(parties.parentGroup, query.parentGroup));
    }
    if (query.q !== undefined) {
      // The one master-search helper, so the escaping rule cannot fork:
      // NULL columns are simply not-ILIKE-matched, which is the same answer
      // the coalesce dance gave at more length.
      parts.push(masterSearch(query.q, [parties.name, parties.alias, parties.gstin]));
    }

    const predicate = and(...parts);
    if (predicate === undefined) {
      throw new Error('Party predicate collapsed to undefined; refusing an unscoped query.');
    }
    return predicate;
  }
}

function toView(row: typeof parties.$inferSelect): PartyView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    name: row.name,
    alias: row.alias,
    parentGroup: row.parentGroup,
    gstin: row.gstin,
    address: row.address,
    creditLimit: row.creditLimit,
    creditDays: row.creditDays,
    openingBalance: row.openingBalance,
    absentInTally: row.absentInTally,
    lastPulledAt: row.lastPulledAt.toISOString(),
  };
}
