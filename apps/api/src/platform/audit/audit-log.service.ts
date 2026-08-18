import { Injectable } from '@nestjs/common';
import { employeeDisplayName, type CursorPaginated } from '@vyuha/shared';

import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import type { Principal } from '../rbac/principal.js';
import { AuditLogRepository, type AuditLogCursor, type AuditLogRow } from './audit-log.repository.js';
import type { AuditLogQuery } from './audit.dto.js';

/**
 * The audit viewer's read model (REQ-M-02).
 *
 * Deliberately separate from `AuditService`, which writes. Keeping one class
 * per direction means the writer has no query method that a future refactor
 * could turn into a read-modify-write against an append-only table.
 */

export interface AuditActorView {
  readonly id: string;
  readonly email: string | null;
  /** The employee name behind the account, when the account has one. */
  readonly name: string | null;
}

export interface AuditLogEntryView {
  readonly id: string;
  readonly createdAt: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actor: AuditActorView | null;
  readonly impersonator: AuditActorView | null;
  /** Already narrowed to the changed fields and redacted at write time. */
  readonly before: unknown;
  readonly after: unknown;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

export interface AuditFacets {
  readonly actions: readonly string[];
  readonly entityTypes: readonly string[];
}

/** Enough for a filter dropdown; a trail with more distinct actions than this
 *  has a naming problem rather than a paging one. */
const FACET_LIMIT = 200;

@Injectable()
export class AuditLogService {
  constructor(@InjectDatabase() private readonly db: Database) {}

  async list(
    principal: Principal,
    query: AuditLogQuery,
  ): Promise<CursorPaginated<AuditLogEntryView>> {
    const repository = new AuditLogRepository(this.db, principal.orgId);

    const { rows, hasMore } = await repository.page({
      filters: {
        entityType: query.entityType,
        entityId: query.entityId,
        actorUserId: query.actorUserId,
        action: query.action,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: query.to === undefined ? undefined : new Date(query.to),
      },
      cursor: query.cursor === undefined ? null : decodeCursor(query.cursor),
      limit: query.limit,
    });

    const data = rows.map(toView);
    const last = rows.at(-1);

    return {
      data,
      meta: {
        nextCursor: hasMore && last !== undefined ? encodeCursor(last) : null,
        hasMore,
      },
    };
  }

  async facets(principal: Principal): Promise<AuditFacets> {
    const repository = new AuditLogRepository(this.db, principal.orgId);
    const [actions, entityTypes] = await Promise.all([
      repository.actions(FACET_LIMIT),
      repository.entityTypes(FACET_LIMIT),
    ]);
    return { actions, entityTypes };
  }
}

function toView(row: AuditLogRow): AuditLogEntryView {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actor:
      row.actorUserId === null
        ? null
        : {
            id: row.actorUserId,
            email: row.actorEmail,
            name:
              row.actorFirstName === null
                ? null
                : employeeDisplayName(row.actorFirstName, row.actorLastName),
          },
    impersonator:
      row.impersonatorUserId === null
        ? null
        : { id: row.impersonatorUserId, email: row.impersonatorEmail, name: null },
    before: row.before,
    after: row.after,
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
  };
}

const CURSOR_SEPARATOR = '|';

/** Exported for the CRM activity timeline, which pages the same rows for one record. */
export function encodeCursor(row: AuditLogRow): string {
  return Buffer.from(
    `${row.createdAt.toISOString()}${CURSOR_SEPARATOR}${row.id}`,
    'utf8',
  ).toString('base64url');
}

/**
 * A cursor that does not decode is a client bug or a hand-edited URL, not a
 * reason to silently start from the top -- that would look like the list
 * looping forever.
 */
export function decodeCursor(raw: string): AuditLogCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf(CURSOR_SEPARATOR);
  if (separator < 0) throw invalidCursor();

  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) throw invalidCursor();

  return { createdAt, id };
}

function invalidCursor(): AppError {
  return AppError.validation('That page cursor is not one this endpoint issued.');
}
