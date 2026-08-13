import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../db/db.provider.js';
import { auditLogs, employees, users } from '../db/schema/index.js';

/**
 * The read side of REQ-M-01's trail, for the audit viewer (REQ-M-02).
 *
 * Not a `ScopedRepository` subclass, and it cannot be one: `audit_logs` carries
 * no `deleted_at`, `updated_at` or `updated_by` on purpose -- the table is
 * append-only and those columns would imply a mutation path that must never
 * exist. So the organisation predicate is named explicitly in one place here,
 * and every query in this file starts from it.
 *
 * There is no write method. `AuditService` is the only writer.
 */

export interface AuditLogFilters {
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly actorUserId?: string | undefined;
  readonly action?: string | undefined;
  /** Inclusive instants, not dates: the trail is ordered by moment. */
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export interface AuditLogCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface AuditLogRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorUserId: string | null;
  readonly actorEmail: string | null;
  readonly actorFirstName: string | null;
  readonly actorLastName: string | null;
  readonly impersonatorUserId: string | null;
  readonly impersonatorEmail: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

export class AuditLogRepository {
  constructor(
    private readonly db: Database,
    private readonly orgId: string,
  ) {}

  /**
   * One page, newest first, plus whether another page exists.
   *
   * Keyset rather than OFFSET (technical design §6: "cursor for the audit
   * log"). The trail grows while it is being read, so an offset page two would
   * repeat rows that page one already showed every time a request was audited
   * in between.
   */
  async page(input: {
    filters: AuditLogFilters;
    cursor: AuditLogCursor | null;
    limit: number;
  }): Promise<{ rows: AuditLogRow[]; hasMore: boolean }> {
    const rows = await this.db
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        actorUserId: auditLogs.actorUserId,
        actorEmail: users.email,
        actorFirstName: employees.firstName,
        actorLastName: employees.lastName,
        impersonatorUserId: auditLogs.impersonatorUserId,
        // A second join to `users` would need an alias; the impersonator is
        // rare enough that a correlated subquery is cheaper to read than an
        // aliased join that is null on almost every row.
        impersonatorEmail: sql<string | null>`(
          SELECT u.email FROM ${users} u WHERE u.id = ${auditLogs.impersonatorUserId}
        )`,
        before: auditLogs.before,
        after: auditLogs.after,
        ip: auditLogs.ip,
        userAgent: auditLogs.userAgent,
        requestId: auditLogs.requestId,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .leftJoin(employees, eq(employees.id, users.employeeId))
      .where(this.where(input.filters, input.cursor))
      // Both columns, because two rows written in the same millisecond would
      // otherwise have no stable order and the cursor could skip one.
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      // One more than asked for: the extra row is how "is there another page"
      // is answered without a second COUNT over a table that only grows.
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    return { rows: hasMore ? rows.slice(0, input.limit) : rows, hasMore };
  }

  /** The distinct actions present, for the viewer's filter (REQ-M-02). */
  async actions(limit: number): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.orgId, this.orgId))
      .orderBy(auditLogs.action)
      .limit(limit);
    return rows.map((row) => row.action);
  }

  /** The distinct entity types present, for the viewer's filter. */
  async entityTypes(limit: number): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ entityType: auditLogs.entityType })
      .from(auditLogs)
      .where(eq(auditLogs.orgId, this.orgId))
      .orderBy(auditLogs.entityType)
      .limit(limit);
    return rows.map((row) => row.entityType);
  }

  private where(filters: AuditLogFilters, cursor: AuditLogCursor | null): SQL {
    const parts: (SQL | undefined)[] = [eq(auditLogs.orgId, this.orgId)];

    if (filters.entityType !== undefined) {
      parts.push(eq(auditLogs.entityType, filters.entityType));
    }
    if (filters.entityId !== undefined) parts.push(eq(auditLogs.entityId, filters.entityId));
    if (filters.actorUserId !== undefined) {
      parts.push(eq(auditLogs.actorUserId, filters.actorUserId));
    }
    if (filters.action !== undefined) parts.push(eq(auditLogs.action, filters.action));
    if (filters.from !== undefined) parts.push(gte(auditLogs.createdAt, filters.from));
    if (filters.to !== undefined) parts.push(lte(auditLogs.createdAt, filters.to));

    if (cursor !== null) {
      // Row comparison, so the pair is compared as one value rather than as
      // `created_at < x OR (created_at = x AND id < y)` written out by hand.
      parts.push(
        sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    const predicate = and(...parts);
    if (predicate === undefined) {
      throw new Error('Audit scope predicate collapsed; refusing to run an unscoped query.');
    }
    return predicate;
  }
}
