import { Injectable } from '@nestjs/common';
import {
  DEFAULT_MASTER_SORT,
  MASTER_SORT_FIELDS,
  pageSlice,
  paginated,
  parseSort,
  type CreateDesignationInput,
  type DesignationSummary,
  type MasterListQuery,
  type Paginated,
  type UpdateDesignationInput,
} from '@vyuha/shared';
import { eq } from 'drizzle-orm';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { isUniqueViolation } from '../db/pg-error.js';
import { designations } from '../db/schema/index.js';
import { ScopedRepository, type Row } from '../db/scoped-repository.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import { codeTakenError } from './master-errors.js';
import { masterOrderBy, masterSearch } from './master-query.js';

/**
 * Designations (REQ-A-02). A flat list with no references to anything, so it
 * needs no repository subclass: `ScopedRepository` already provides every
 * statement used here, and a subclass that added nothing would only be another
 * file to keep in step.
 */

const SORT_COLUMNS = { name: designations.name, code: designations.code } as const;

@Injectable()
export class DesignationService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
  ) {}

  async list(principal: Principal, query: MasterListQuery): Promise<Paginated<DesignationSummary>> {
    const repository = this.repository(principal);
    const { limit, offset } = pageSlice(query);
    const where =
      query.q === undefined
        ? undefined
        : masterSearch(query.q, [designations.name, designations.code]);

    const rows = await repository.findMany({
      ...(where === undefined ? {} : { where }),
      orderBy: masterOrderBy(
        parseSort(query.sort ?? DEFAULT_MASTER_SORT, MASTER_SORT_FIELDS),
        SORT_COLUMNS,
        designations.name,
        designations.id,
      ),
      limit,
      offset,
    });

    return paginated(rows.map(toSummary), query, await repository.count(where));
  }

  async create(principal: Principal, input: CreateDesignationInput): Promise<DesignationSummary> {
    const repository = this.repository(principal);
    if ((await this.findIdByCode(repository, input.code)) !== null) {
      throw codeTakenError('designation', input.code);
    }

    let created: Row<typeof designations>;
    try {
      created = await repository.insert(input);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw codeTakenError('designation', input.code, error);
      throw error;
    }

    const summary = toSummary(created);
    this.auditContext.record({
      action: 'designation.created',
      entityType: 'designation',
      entityId: summary.id,
      before: null,
      after: summary,
    });

    return summary;
  }

  async update(
    principal: Principal,
    id: string,
    input: UpdateDesignationInput,
  ): Promise<DesignationSummary> {
    const repository = this.repository(principal);
    const existing = await repository.findById(id);
    if (existing === null) throw AppError.notFound('Designation', id);

    if (input.code !== undefined && input.code !== existing.code) {
      const clash = await this.findIdByCode(repository, input.code);
      if (clash !== null && clash !== id) throw codeTakenError('designation', input.code);
    }

    const updated = await repository.update(id, input);
    if (updated === null) throw AppError.notFound('Designation', id);

    this.auditContext.record({
      action: 'designation.updated',
      entityType: 'designation',
      entityId: id,
      before: toSummary(existing),
      after: toSummary(updated),
    });

    return toSummary(updated);
  }

  private repository(principal: Principal): ScopedRepository<typeof designations> {
    return new ScopedRepository(this.db, designations, orgContextOf(principal));
  }

  private async findIdByCode(
    repository: ScopedRepository<typeof designations>,
    code: string,
  ): Promise<string | null> {
    const row = await repository.findOne(eq(designations.code, code));
    return row?.id ?? null;
  }
}

function toSummary(row: Row<typeof designations>): DesignationSummary {
  return { id: row.id, name: row.name, code: row.code, grade: row.grade };
}
