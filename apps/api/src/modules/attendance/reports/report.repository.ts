import { employeeDisplayName, type PunchRecord } from '@vyuha/shared';
import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import type { Database } from '../../../platform/db/db.provider.js';
import { employees, organizations, users } from '../../../platform/db/schema/index.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import { PUNCH_COLUMNS, toPunchRecord, type PunchRow } from '../punch/punch.repository.js';
import { punches } from '../schema/index.js';

/**
 * The rows behind the punch audit report, plus the few facts an exported file
 * needs about the organisation it belongs to.
 *
 * The attendance register is deliberately *not* here: `AttendanceDayRepository`
 * already produces exactly that row, and a second copy of those joins would be
 * a second place for the muster and the register to disagree about what a day
 * looks like. `ReportService` calls it directly and folds the report's extra
 * filters into the scope predicate it passes.
 *
 * The punch audit does need its own query. `PunchRepository.feed` is
 * cursor-paginated by design -- it serves a live feed that only grows -- and a
 * report shell pages by number and shows a total. Those are different
 * questions of the same table, not the same question twice.
 */

export interface ReportScopeFilters {
  /** Resolved by `ScopeService`; never built here and never optional. */
  readonly scope: SQL;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly employeeId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly locationId?: string | undefined;
  readonly punchType?: 'IN' | 'OUT' | undefined;
}

export interface PunchAuditPage {
  readonly rows: PunchRecord[];
  readonly total: number;
}

/** Sort fields the punch audit will honour, mapped to real columns. */
const PUNCH_SORT_COLUMNS: Record<string, PgColumn> = {
  serverTime: punches.serverTime,
  attendanceDate: punches.attendanceDate,
  employeeCode: employees.employeeCode,
};

export interface OrgProfile {
  readonly name: string;
  readonly timezone: string;
  readonly dateFormat: string;
  /** REQ-L-01. The leave balance report reads it to name the year (05-decisions: April). */
  readonly leaveYearStartMonth: number;
}

export interface ExportRequesterRow {
  readonly employeeId: string | null;
  readonly email: string;
  readonly status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
}

export class ReportRepository {
  constructor(
    private readonly db: Database,
    private readonly ctx: OrgContext,
  ) {}

  /** Mirrors `ScopedRepository.scoped()`; `punches` carries no soft-delete columns. */
  private orgScoped(...extra: (SQL | undefined)[]): SQL {
    const predicate = and(eq(punches.orgId, this.ctx.orgId), ...extra);
    if (predicate === undefined) {
      throw new Error('Scope predicate collapsed to undefined; refusing to run an unscoped query.');
    }
    return predicate;
  }

  /**
   * The report's own filters as one predicate over the joined employee.
   *
   * Public because the attendance register applies the same department and
   * location narrowing through `AttendanceDayRepository`, which joins the same
   * `employees` alias and accepts an arbitrary scope fragment. One function,
   * so "department" cannot mean the employee's department in one report and
   * something else in the other.
   */
  static employeePredicate(filters: {
    departmentId?: string | undefined;
    locationId?: string | undefined;
  }): SQL | undefined {
    const parts: SQL[] = [];
    if (filters.departmentId !== undefined) {
      parts.push(eq(employees.departmentId, filters.departmentId));
    }
    if (filters.locationId !== undefined) {
      parts.push(eq(employees.locationId, filters.locationId));
    }
    return parts.length === 0 ? undefined : and(...parts);
  }

  // ------------------------------------------------------------ punch audit

  async punchAudit(
    filters: ReportScopeFilters,
    sort: readonly { field: string; direction: 'asc' | 'desc' }[],
    limit: number,
    offset: number,
  ): Promise<PunchAuditPage> {
    const where = this.punchWhere(filters);

    const rows = await this.punchSelect()
      .where(where)
      .orderBy(...this.punchOrderBy(sort))
      .limit(limit)
      .offset(offset);

    return { rows: rows.map((row: PunchRow) => toPunchRecord(row)), total: await this.countPunches(filters) };
  }

  async countPunches(filters: ReportScopeFilters): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(punches)
      .innerJoin(
        employees,
        and(
          eq(employees.id, punches.employeeId),
          eq(employees.orgId, this.ctx.orgId),
          isNull(employees.deletedAt),
        ),
      )
      .where(this.punchWhere(filters));
    return rows[0]?.value ?? 0;
  }

  private punchSelect() {
    return this.db
      .select(PUNCH_COLUMNS)
      .from(punches)
      // Inner, matching the muster: a punch whose employee has been
      // soft-deleted is not a row any report should render, and an outer join
      // would produce one with a nameless employee.
      .innerJoin(
        employees,
        and(
          eq(employees.id, punches.employeeId),
          eq(employees.orgId, this.ctx.orgId),
          isNull(employees.deletedAt),
        ),
      );
  }

  private punchWhere(filters: ReportScopeFilters): SQL {
    return this.orgScoped(
      filters.scope,
      ReportRepository.employeePredicate(filters),
      filters.employeeId === undefined ? undefined : eq(punches.employeeId, filters.employeeId),
      filters.from === undefined ? undefined : gte(punches.attendanceDate, filters.from),
      filters.to === undefined ? undefined : lte(punches.attendanceDate, filters.to),
      filters.punchType === undefined ? undefined : eq(punches.punchType, filters.punchType),
    );
  }

  /**
   * The id tiebreak is not decoration: two punches can share a millisecond --
   * a double tap produces exactly that -- and without it one row appears on
   * two pages while another never appears at all.
   */
  private punchOrderBy(
    sort: readonly { field: string; direction: 'asc' | 'desc' }[],
  ): (SQL | PgColumn)[] {
    const clauses: (SQL | PgColumn)[] = [];
    for (const term of sort) {
      const column = PUNCH_SORT_COLUMNS[term.field];
      if (column === undefined) continue;
      clauses.push(term.direction === 'desc' ? desc(column) : asc(column));
    }
    if (clauses.length === 0) clauses.push(desc(punches.serverTime));
    clauses.push(desc(punches.id));
    return clauses;
  }

  // --------------------------------------------------------------- context

  /** REQ-J-03's header block needs the organisation's name and conventions. */
  async orgProfile(): Promise<OrgProfile> {
    const rows = await this.db
      .select({
        name: organizations.name,
        timezone: organizations.timezone,
        dateFormat: organizations.dateFormat,
        leaveYearStartMonth: organizations.leaveYearStartMonth,
      })
      .from(organizations)
      .where(and(eq(organizations.id, this.ctx.orgId), isNull(organizations.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      throw new Error(`Organisation ${this.ctx.orgId} was not found while preparing an export.`);
    }
    return row;
  }

  /**
   * Who asked for the export, re-read at the moment the job runs.
   *
   * The job re-resolves the requester rather than trusting a snapshot taken
   * when the button was pressed. A person suspended, or stripped of the
   * permission, between queueing and running must not have a file produced for
   * them -- that gap can be minutes, and an export is exactly the artefact
   * somebody would race a revocation for.
   */
  async findRequester(userId: string): Promise<ExportRequesterRow | null> {
    const rows = await this.db
      .select({
        employeeId: users.employeeId,
        email: users.email,
        status: users.status,
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, this.ctx.orgId), isNull(users.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Display names for the ids in a filter, so the header block reads
   * "Department: Production" rather than a UUID nobody can act on.
   *
   * Missing ids are simply absent from the map and `describeFilters` falls
   * back to the id. A filter naming a department that has since been deleted
   * is still a true statement about what was exported.
   */
  async filterLabels(ids: {
    employeeId?: string | undefined;
    departmentId?: string | undefined;
    locationId?: string | undefined;
  }): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};

    if (ids.employeeId !== undefined) {
      const rows = await this.db
        .select({
          id: employees.id,
          code: employees.employeeCode,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(employees)
        .where(and(eq(employees.id, ids.employeeId), eq(employees.orgId, this.ctx.orgId)))
        .limit(1);
      const row = rows[0];
      if (row !== undefined) {
        labels[row.id] = `${row.code} ${employeeDisplayName(row.firstName, row.lastName)}`;
      }
    }

    for (const [id, table] of [
      [ids.departmentId, 'departments'] as const,
      [ids.locationId, 'locations'] as const,
    ]) {
      if (id === undefined) continue;
      // Two tables with an identical shape and no shared drizzle type; a raw
      // statement is honest about that rather than pretending to a union.
      const rows = await this.db.execute<{ id: string; name: string }>(
        sql`SELECT id, name FROM ${sql.raw(`"${table}"`)}
             WHERE id = ${id} AND org_id = ${this.ctx.orgId} LIMIT 1`,
      );
      const row = rows.rows[0];
      if (row !== undefined) labels[row.id] = row.name;
    }

    return labels;
  }
}
