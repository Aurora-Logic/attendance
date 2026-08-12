import {
  employeeDisplayName,
  type DepartmentSummary,
  type NamedRef,
  type SortTerm,
} from '@vyuha/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../db/db.provider.js';
import { departments, employees } from '../db/schema/index.js';
import { ScopedRepository, type OrgContext } from '../db/scoped-repository.js';
import { masterOrderBy, masterSearch } from './master-query.js';

/**
 * Departments (REQ-A-02), including the hierarchy.
 *
 * Same shape as `EmployeeRepository`: a `ScopedRepository` subclass, so the
 * joined read below still starts from `this.scoped(...)` and carries `org_id`
 * and `deleted_at IS NULL` before anything else is added to it.
 */

/** Created once; see the note on the same line in `employee.repository.ts`. */
const parents = alias(departments, 'parent_department');

const SORT_COLUMNS = { name: departments.name, code: departments.code } as const;

export interface DepartmentListFilters {
  readonly q?: string | undefined;
  readonly sort: readonly SortTerm[];
  readonly limit: number;
  readonly offset: number;
}

interface JoinedRow {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  parentName: string | null;
  headId: string | null;
  headFirstName: string | null;
  headLastName: string | null;
}

export class DepartmentRepository extends ScopedRepository<typeof departments> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, departments, ctx);
  }

  async list(
    filters: DepartmentListFilters,
  ): Promise<{ rows: DepartmentSummary[]; total: number }> {
    const search =
      filters.q === undefined
        ? undefined
        : masterSearch(filters.q, [departments.name, departments.code]);
    const where = this.scoped(search);

    const rows = await this.joinedSelect()
      .where(where)
      .orderBy(...masterOrderBy(filters.sort, SORT_COLUMNS, departments.name, departments.id))
      .limit(filters.limit)
      .offset(filters.offset);

    const totals = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(departments)
      .where(where);

    return { rows: rows.map(toSummary), total: totals[0]?.value ?? 0 };
  }

  async summary(id: string): Promise<DepartmentSummary | null> {
    const rows = await this.joinedSelect()
      .where(this.scoped(eq(departments.id, id)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toSummary(row);
  }

  async findIdByCode(code: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: departments.id })
      .from(departments)
      .where(this.scoped(eq(departments.code, code)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /**
   * The department equivalent of REQ-A-07's reporting check, and the same
   * shape of query for the same reasons: walks up from the proposed parent,
   * `UNION` so an existing loop terminates, self-reference falling out of the
   * anchor row rather than needing its own branch.
   */
  async wouldCloseParentCycle(departmentId: string, proposedParentId: string): Promise<boolean> {
    const orgId = this.ctx.orgId;

    const result = await this.db.execute<{ hit: number }>(sql`
      WITH RECURSIVE vy_parent_chain AS (
        SELECT ${departments.id} AS id, ${departments.parentId} AS parent_id
          FROM ${departments}
         WHERE ${departments.orgId} = ${orgId}
           AND ${departments.deletedAt} IS NULL
           AND ${departments.id} = ${proposedParentId}
        UNION
        SELECT ${departments.id}, ${departments.parentId}
          FROM ${departments}
          JOIN vy_parent_chain ON ${departments.id} = vy_parent_chain.parent_id
         WHERE ${departments.orgId} = ${orgId}
           AND ${departments.deletedAt} IS NULL
      )
      SELECT 1 AS hit FROM vy_parent_chain WHERE id = ${departmentId} LIMIT 1
    `);

    return result.rows.length > 0;
  }

  private joinedSelect() {
    const orgId = this.ctx.orgId;

    return this.db
      .select({
        id: departments.id,
        name: departments.name,
        code: departments.code,
        parentId: parents.id,
        parentName: parents.name,
        headId: employees.id,
        headFirstName: employees.firstName,
        headLastName: employees.lastName,
      })
      .from(departments)
      .leftJoin(
        parents,
        and(
          eq(parents.id, departments.parentId),
          eq(parents.orgId, orgId),
          isNull(parents.deletedAt),
        ),
      )
      .leftJoin(
        employees,
        and(
          eq(employees.id, departments.headEmployeeId),
          eq(employees.orgId, orgId),
          isNull(employees.deletedAt),
        ),
      );
  }
}

function namedRef(id: string | null, name: string | null): NamedRef | null {
  return id === null || name === null ? null : { id, name };
}

function toSummary(row: JoinedRow): DepartmentSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    parent: namedRef(row.parentId, row.parentName),
    head:
      row.headId === null || row.headFirstName === null
        ? null
        : { id: row.headId, name: employeeDisplayName(row.headFirstName, row.headLastName) },
  };
}
