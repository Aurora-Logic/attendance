import { Injectable } from '@nestjs/common';
import {
  DEFAULT_MASTER_SORT,
  ERROR_CODES,
  MASTER_SORT_FIELDS,
  pageSlice,
  paginated,
  parseSort,
  type CreateDepartmentInput,
  type DepartmentSummary,
  type MasterListQuery,
  type Paginated,
  type UpdateDepartmentInput,
} from '@vyuha/shared';

import { AuditContext } from '../audit/audit-context.js';
import { AppError } from '../common/errors.js';
import { InjectDatabase, type Database } from '../db/db.provider.js';
import { isUniqueViolation } from '../db/pg-error.js';
import { employees } from '../db/schema/index.js';
import { ScopedRepository } from '../db/scoped-repository.js';
import { orgContextOf, type Principal } from '../rbac/principal.js';
import { DepartmentRepository } from './department.repository.js';
import { codeTakenError, unknownReferenceError } from './master-errors.js';

/**
 * Departments (REQ-A-02).
 *
 * Not scoped by team. PRD §2's data scope is a statement about which *people*
 * a caller may see; the department list is the vocabulary of the filters on
 * that screen, and hiding half of it would leave an Operations user with a
 * filter that silently omits options. The organisation boundary still applies,
 * through `ScopedRepository`.
 */
@Injectable()
export class DepartmentService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
  ) {}

  async list(principal: Principal, query: MasterListQuery): Promise<Paginated<DepartmentSummary>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).list({
      q: query.q,
      sort: parseSort(query.sort ?? DEFAULT_MASTER_SORT, MASTER_SORT_FIELDS),
      limit,
      offset,
    });
    return paginated(rows, query, total);
  }

  async create(principal: Principal, input: CreateDepartmentInput): Promise<DepartmentSummary> {
    const repository = this.repository(principal);

    if ((await repository.findIdByCode(input.code)) !== null) {
      throw codeTakenError('department', input.code);
    }
    await this.assertReferencesExist(principal, input);

    const created = await this.insert(repository, input);
    const summary = await this.readBack(repository, created.id);

    this.auditContext.record({
      action: 'department.created',
      entityType: 'department',
      entityId: summary.id,
      before: null,
      after: summary,
    });

    return summary;
  }

  async update(
    principal: Principal,
    id: string,
    input: UpdateDepartmentInput,
  ): Promise<DepartmentSummary> {
    const repository = this.repository(principal);
    const existing = await repository.summary(id);
    if (existing === null) throw AppError.notFound('Department', id);

    if (input.code !== undefined && input.code !== existing.code) {
      const clash = await repository.findIdByCode(input.code);
      if (clash !== null && clash !== id) throw codeTakenError('department', input.code);
    }

    await this.assertReferencesExist(principal, input);
    await this.assertNoParentCycle(repository, existing, input);

    const updated = await repository.update(id, input);
    if (updated === null) throw AppError.notFound('Department', id);

    const summary = await this.readBack(repository, id);

    this.auditContext.record({
      action: 'department.updated',
      entityType: 'department',
      entityId: id,
      before: existing,
      after: summary,
    });

    return summary;
  }

  // ------------------------------------------------------------- internals

  private repository(principal: Principal): DepartmentRepository {
    return new DepartmentRepository(this.db, orgContextOf(principal));
  }

  private async insert(
    repository: DepartmentRepository,
    input: CreateDepartmentInput,
  ): Promise<{ id: string }> {
    try {
      return await repository.insert(input);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw codeTakenError('department', input.code, error);
      throw error;
    }
  }

  private async readBack(
    repository: DepartmentRepository,
    id: string,
  ): Promise<DepartmentSummary> {
    const summary = await repository.summary(id);
    if (summary === null) {
      throw new Error(`Department ${id} was written but could not be read back.`);
    }
    return summary;
  }

  /** The head must be a live employee of this organisation, and the parent a live department. */
  private async assertReferencesExist(
    principal: Principal,
    input: CreateDepartmentInput | UpdateDepartmentInput,
  ): Promise<void> {
    const ctx = orgContextOf(principal);

    if (typeof input.headEmployeeId === 'string') {
      const exists = await new ScopedRepository(this.db, employees, ctx).exists(
        input.headEmployeeId,
      );
      if (!exists) throw unknownReferenceError('headEmployeeId', input.headEmployeeId);
    }

    if (typeof input.parentId === 'string') {
      const exists = await new DepartmentRepository(this.db, ctx).exists(input.parentId);
      if (!exists) throw unknownReferenceError('parentId', input.parentId);
    }
  }

  private async assertNoParentCycle(
    repository: DepartmentRepository,
    existing: DepartmentSummary,
    input: UpdateDepartmentInput,
  ): Promise<void> {
    const proposed = input.parentId;
    if (proposed === undefined || proposed === null) return;
    if (proposed === existing.parent?.id) return;

    if (await repository.wouldCloseParentCycle(existing.id, proposed)) {
      // REPORTING_CYCLE rather than a code of its own: it is the same failure
      // -- a hierarchy pointed at itself -- and the client's message for it
      // reads correctly either way.
      throw new AppError(
        ERROR_CODES.REPORTING_CYCLE,
        proposed === existing.id
          ? 'A department cannot be its own parent.'
          : 'That department already sits below this one.',
        { details: { departmentId: existing.id, parentId: proposed } },
      );
    }
  }
}
