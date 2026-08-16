import { Injectable } from '@nestjs/common';
import {
  savedViewConfigSchema,
  type SavedView,
  type SavedViewConfig,
  type SavedViewInput,
  type ReportKey,
} from '@vyuha/shared';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { savedViews } from '../db/schema/index.js';
import { ScopedRepository } from '../db/scoped-repository.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';

/**
 * REQ-J-01's saved views.
 *
 * A view is a filter, a column selection and a sort under a name -- nothing
 * about permissions. It is stored per user and shared only when its owner says
 * so, and reading a shared view grants nothing: the rows it produces are still
 * resolved through `ScopeService` for whoever opened it, so a view saved by
 * someone who can see the whole organisation shows a manager their team.
 *
 * Saving over an existing name replaces it. That is the behaviour a unique
 * index makes safe, and the alternative -- refusing with a conflict -- makes
 * "update my saved view" a delete-then-create the reader has to perform by
 * hand.
 */
@Injectable()
export class SavedViewService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
  ) {}

  async list(principal: Principal, reportKey: ReportKey): Promise<SavedView[]> {
    const rows = await this.db
      .select({
        id: savedViews.id,
        userId: savedViews.userId,
        reportKey: savedViews.reportKey,
        name: savedViews.name,
        config: savedViews.config,
        isShared: savedViews.isShared,
        createdAt: savedViews.createdAt,
      })
      .from(savedViews)
      .where(
        and(
          eq(savedViews.orgId, principal.orgId),
          isNull(savedViews.deletedAt),
          eq(savedViews.reportKey, reportKey),
          or(eq(savedViews.userId, principal.userId), eq(savedViews.isShared, true)),
        ),
      )
      // Own views first, then shared ones, each alphabetically. A reader's own
      // list is the one they are looking for; the shared ones are a library.
      .orderBy(
        sql`(${savedViews.userId} = ${principal.userId}) DESC`,
        asc(savedViews.name),
      );

    return rows.map((row) => ({
      id: row.id,
      reportKey: row.reportKey,
      name: row.name,
      config: parseConfig(row.config),
      isShared: row.isShared,
      isOwn: row.userId === principal.userId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Creates, or replaces the caller's view of the same name on the same report. */
  async save(principal: Principal, input: SavedViewInput): Promise<SavedView> {
    const existing = await this.db
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(
        and(
          eq(savedViews.orgId, principal.orgId),
          isNull(savedViews.deletedAt),
          eq(savedViews.userId, principal.userId),
          eq(savedViews.reportKey, input.reportKey),
          sql`lower(${savedViews.name}) = lower(${input.name})`,
        ),
      )
      .limit(1);

    const repository = new ScopedRepository(this.db, savedViews, orgContextOf(principal));
    const values = {
      userId: principal.userId,
      reportKey: input.reportKey,
      name: input.name,
      config: input.config,
      isShared: input.isShared,
    };

    const previousId = existing[0]?.id;
    const row =
      previousId === undefined
        ? await repository.insert(values)
        : await repository.update(previousId, values);

    if (row === null) {
      throw new Error(`Saved view ${previousId ?? 'new'} could not be written.`);
    }

    this.auditContext.record({
      orgId: principal.orgId,
      actorUserId: principal.userId,
      action: previousId === undefined ? 'report.view.created' : 'report.view.updated',
      entityType: 'saved_view',
      entityId: row.id,
      after: { reportKey: input.reportKey, name: input.name, isShared: input.isShared },
    });

    return {
      id: row.id,
      reportKey: row.reportKey,
      name: row.name,
      config: parseConfig(row.config),
      isShared: row.isShared,
      isOwn: true,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * REQ-M-04's soft delete. Only the owner may remove a view; a shared view
   * another person is using is not theirs to take away.
   */
  async remove(principal: Principal, id: string): Promise<void> {
    const rows = await this.db
      .select({ id: savedViews.id, name: savedViews.name, reportKey: savedViews.reportKey })
      .from(savedViews)
      .where(
        and(
          eq(savedViews.orgId, principal.orgId),
          isNull(savedViews.deletedAt),
          eq(savedViews.id, id),
          eq(savedViews.userId, principal.userId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) throw AppError.notFound('Saved view', id);

    await new ScopedRepository(this.db, savedViews, orgContextOf(principal)).softDelete(id);

    this.auditContext.record({
      orgId: principal.orgId,
      actorUserId: principal.userId,
      action: 'report.view.deleted',
      entityType: 'saved_view',
      entityId: id,
      before: { reportKey: row.reportKey, name: row.name },
      after: null,
    });
  }
}

/**
 * A config read back out of jsonb is untrusted input even though this code
 * wrote it: an older release may have stored a shape this one no longer
 * understands, and a saved view is not worth breaking a screen over. Anything
 * unreadable falls back to the report's defaults.
 */
function parseConfig(value: unknown): SavedViewConfig {
  const parsed = savedViewConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : { filters: {}, columns: [] };
}
