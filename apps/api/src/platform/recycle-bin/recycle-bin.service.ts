import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  pageSlice,
  paginated,
  type BlockingReference,
  type Paginated,
  type RecycleBinEntry,
  type RecycleBinQuery,
  type SoftDeletableEntity,
} from '@vyuha/shared';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { isUniqueViolation } from '../db/pg-error.js';
import { hasPermission, orgContextOf, type Principal } from '../rbac/principal.js';
import { RecycleBinRepository, type MasterRow } from './recycle-bin.repository.js';
import { SoftDeletableRegistry, type SoftDeletableSpec } from './soft-deletable.js';

/**
 * Soft delete, restore and the recycle bin (REQ-B-09a, REQ-M-04, P1-2).
 *
 * REQ-M-04 forbids a hard delete outright, so "delete" here means stamping
 * `deleted_at` and writing a `deletion_records` row saying who, when and why.
 * Three rules are enforced in this one place rather than six times over:
 *
 *   the reason         mandatory, and long enough to mean something
 *   the refusal        no delete while a live row still points at the record,
 *                      and the refusal names those rows
 *   the trail          before/after plus the reason, on both directions
 *
 * The permission is re-checked here even though the route is guarded. The guard
 * can only assert "holds one of the six manage keys" because the entity type
 * arrives in the path; deciding that *this* caller may delete *this* kind of
 * master is a narrower rule than route metadata can express, exactly as
 * `LeaveService` re-checks the approver.
 */
@Injectable()
export class RecycleBinService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly registry: SoftDeletableRegistry,
    private readonly auditContext: AuditContext,
  ) {}

  async softDelete(
    principal: Principal,
    entityType: SoftDeletableEntity,
    id: string,
    reason: string,
  ): Promise<{ entityType: SoftDeletableEntity; id: string; name: string; deleted: true }> {
    const spec = this.requireSpec(principal, entityType);
    const repository = this.repository(principal);

    const row = await repository.findLive(spec, id);
    if (row === null) {
      // Deleted already, another organisation's, or never existed: one answer
      // for all three, as everywhere else, so an id cannot be probed for.
      throw AppError.notFound(spec.label, id);
    }

    const declared = await repository.findBlockingReferences(spec, id);
    // The hook may throw instead of returning, which is how the seeded-role
    // protection refuses with its own code rather than as "in use".
    const extra =
      spec.extraBlockers === undefined
        ? []
        : await spec.extraBlockers(this.db, orgContextOf(principal), id);

    const blocking = [...declared, ...extra];
    if (blocking.length > 0) throw inUseError(spec, row, blocking);

    const now = new Date();
    // One transaction: a `deleted_at` with no record beside it would be a
    // deletion nobody can account for, and a record with no `deleted_at` would
    // put a living row in the recycle bin.
    await this.db.transaction(async () => {
      const marked = await repository.markDeleted(spec, id, now);
      if (!marked) throw AppError.notFound(spec.label, id);
      await repository.writeDeletionRecord({ spec, id, label: labelOf(row), reason, at: now });
    });

    this.auditContext.record({
      action: `${spec.entityType}.deleted`,
      entityType: spec.entityType,
      entityId: id,
      before: { ...auditView(row), deleted: false },
      after: { ...auditView(row), deleted: true, reason },
    });

    return { entityType, id, name: row.name, deleted: true };
  }

  async restore(
    principal: Principal,
    entityType: SoftDeletableEntity,
    id: string,
    reason: string,
  ): Promise<{ entityType: SoftDeletableEntity; id: string; name: string; deleted: false }> {
    const spec = this.requireSpec(principal, entityType);
    const repository = this.repository(principal);

    const row = await repository.findDeleted(spec, id);
    if (row === null) {
      const live = await repository.findLive(spec, id);
      if (live !== null) {
        throw new AppError(
          ERROR_CODES.RECORD_NOT_DELETED,
          `${spec.label} "${live.name}" is not deleted, so there is nothing to restore.`,
          { details: { entityType, id } },
        );
      }
      throw AppError.notFound(spec.label, id);
    }

    const clash = await repository.findUniqueClash(spec, row.uniqueValue);
    if (clash !== null) {
      throw AppError.conflict(
        `"${clash}" took ${describeUnique(row.uniqueValue)} while this ${spec.label.toLowerCase()} was in the recycle bin. ` +
          'Change that record first, then restore this one.',
        { entityType, id, taken: row.uniqueValue, takenBy: clash },
      );
    }

    const now = new Date();
    try {
      await this.db.transaction(async () => {
        const restored = await repository.markRestored(spec, id, now);
        if (!restored) throw AppError.notFound(spec.label, id);
        await repository.closeDeletionRecord(entityType, id, reason, now);
      });
    } catch (error: unknown) {
      // The check above covers a single-column constraint. A composite one --
      // `holiday_calendars (name, year)` -- can only be found by trying, and a
      // unique violation escaping as a 500 would read as a server fault for
      // what is a name somebody else has taken.
      if (isUniqueViolation(error)) {
        throw AppError.conflict(
          `Restoring "${row.name}" would collide with a record that already exists. ` +
            'Rename the live one, then restore this.',
          { entityType, id },
        );
      }
      throw error;
    }

    this.auditContext.record({
      action: `${spec.entityType}.restored`,
      entityType: spec.entityType,
      entityId: id,
      before: { ...auditView(row), deleted: true },
      after: { ...auditView(row), deleted: false, reason },
    });

    return { entityType, id, name: row.name, deleted: false };
  }

  /**
   * The bin, across every master the caller can manage.
   *
   * Filtered by permission rather than refused wholesale: an HR user who can
   * retire a department but not a location should see their own deletions
   * rather than a locked screen, and should not learn what was deleted on the
   * side of the system they cannot touch.
   *
   * Paginated in memory over a bounded fetch. Six small master tables cannot
   * produce a bin worth streaming, and merging six ordered lists in SQL would
   * be a union that has to be rewritten every time a master is registered.
   * `FETCH_CEILING` is what makes "in memory" a bound rather than a hope.
   */
  async list(principal: Principal, query: RecycleBinQuery): Promise<Paginated<RecycleBinEntry>> {
    const specs = this.registry
      .all()
      .filter((spec) => hasPermission(principal, spec.managePermission))
      .filter((spec) => query.entityType === undefined || spec.entityType === query.entityType);

    if (specs.length === 0) {
      return paginated([], query, 0);
    }

    const repository = this.repository(principal);
    const collected: RecycleBinEntry[] = [];
    let total = 0;

    for (const spec of specs) {
      const { entries, total: found } = await repository.listDeleted(spec, {
        q: query.q,
        limit: FETCH_CEILING,
      });
      collected.push(...entries);
      total += found;
    }

    collected.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));

    const { limit, offset } = pageSlice(query);
    return paginated(collected.slice(offset, offset + limit), query, total);
  }

  // ------------------------------------------------------------- internals

  private repository(principal: Principal): RecycleBinRepository {
    return new RecycleBinRepository(this.db, orgContextOf(principal));
  }

  private requireSpec(
    principal: Principal,
    entityType: SoftDeletableEntity,
  ): SoftDeletableSpec {
    const spec = this.registry.get(entityType);
    if (spec === null) {
      // Reachable only if a module failed to register, which is a wiring bug.
      // Refusing loudly beats a 404 that reads as "no such record".
      throw AppError.validation(`No deletable master is registered as "${entityType}".`, {
        entityType,
      });
    }

    if (!hasPermission(principal, spec.managePermission)) {
      throw new AppError(
        ERROR_CODES.FORBIDDEN,
        `Deleting or restoring a ${spec.label.toLowerCase()} needs the ${spec.managePermission} permission.`,
        { details: { requiredAnyOf: [spec.managePermission] } },
      );
    }

    return spec;
  }
}

/**
 * How many deleted rows of one kind the bin will read before paginating.
 *
 * Generous for master data — an organisation with 200 deleted departments has a
 * different problem — and finite, so a mistake cannot turn this into an
 * unbounded read.
 */
const FETCH_CEILING = 200;

function labelOf(row: MasterRow): string {
  return row.code === null ? row.name : `${row.name} (${row.code})`;
}

function auditView(row: MasterRow): Record<string, unknown> {
  return { id: row.id, name: row.name, code: row.code };
}

function describeUnique(value: string | null): string {
  return value === null ? 'its identifier' : `"${value}"`;
}

/**
 * REQ-B-09a's refusal, naming the rows in the way.
 *
 * "In use" is a dead end: the administrator has to go and find what is using it
 * with no idea where to look. Naming three employees and a count turns the
 * refusal into an instruction.
 */
function inUseError(
  spec: SoftDeletableSpec,
  row: MasterRow,
  blocking: readonly BlockingReference[],
): AppError {
  const summary = blocking
    .map((reference) => {
      const shown = reference.examples.join(', ');
      const rest = reference.count - reference.examples.length;
      const tail = rest > 0 ? `${shown} and ${String(rest)} more` : shown;
      return `${String(reference.count)} ${reference.label} (${tail})`;
    })
    .join('; ');

  return new AppError(
    ERROR_CODES.RECORD_IN_USE,
    `${spec.label} "${row.name}" is still referenced by ${summary}. Move them first, then delete it.`,
    { details: { entityType: spec.entityType, id: row.id, references: blocking } },
  );
}
