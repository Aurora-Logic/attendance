import { employeeDisplayName, type RosterAssignment, type SortTerm } from '@vyuha/shared';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../../../platform/db/db.provider.js';
import { departments, employees } from '../../../platform/db/schema/index.js';
import { ScopedRepository, type OrgContext } from '../../../platform/db/scoped-repository.js';
import { masterSearch } from '../../../platform/org/master-query.js';
import { attendanceDays, attendancePeriodLocks, shiftAssignments, shifts } from '../schema/index.js';

/**
 * The roster (REQ-C-04, REQ-C-05).
 *
 * `shift_assignments` is the table; "roster" is what the screen calls it, and
 * the endpoint follows technical design section 6 in using the screen's word.
 * One row is one employee on one shift for one inclusive date range, and
 * Postgres -- not this class -- is what makes two of them impossible for the
 * same employee on the same day.
 */

const SORT_COLUMNS = {
  employeeCode: employees.employeeCode,
  name: employees.firstName,
  from: shiftAssignments.effectiveFrom,
} as const;

export interface RosterListFilters {
  readonly from: string;
  readonly to: string;
  readonly employeeId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly locationId?: string | undefined;
  readonly shiftId?: string | undefined;
  readonly q?: string | undefined;
  /** Resolved by `ScopeService`; never built here and never optional. */
  readonly scope: SQL;
  readonly sort: readonly SortTerm[];
  readonly limit: number;
  readonly offset: number;
}

interface JoinedRow {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string | null;
  employeeCode: string;
  shiftId: string;
  shiftName: string;
  shiftCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  departmentName: string | null;
}

function toAssignment(row: JoinedRow): RosterAssignment {
  return {
    id: row.id,
    employee: {
      id: row.employeeId,
      name: employeeDisplayName(row.firstName, row.lastName),
      employeeCode: row.employeeCode,
    },
    shift: { id: row.shiftId, name: row.shiftName, code: row.shiftCode },
    from: row.effectiveFrom,
    to: row.effectiveTo,
    department: row.departmentName,
  };
}

export interface EmployeeSelection {
  readonly id: string;
  readonly name: string;
  readonly employeeCode: string;
  readonly department: string | null;
}

export class RosterRepository extends ScopedRepository<typeof shiftAssignments> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, shiftAssignments, ctx);
  }

  /**
   * The three joins every roster read needs.
   *
   * `innerJoin` on employees and shifts, not left: an assignment whose
   * employee or shift has been soft-deleted describes nothing a reader can
   * act on, and rendering it with a blank name would look like a data bug
   * rather than a deleted record. Both foreign keys are RESTRICT, so this can
   * only happen through a soft delete, and a soft-deleted employee has no
   * roster worth showing.
   */
  private joinedSelect() {
    const orgId = this.ctx.orgId;

    return this.db
      .select({
        id: shiftAssignments.id,
        employeeId: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeCode: employees.employeeCode,
        shiftId: shifts.id,
        shiftName: shifts.name,
        shiftCode: shifts.code,
        effectiveFrom: shiftAssignments.effectiveFrom,
        effectiveTo: shiftAssignments.effectiveTo,
        departmentName: departments.name,
      })
      .from(shiftAssignments)
      .innerJoin(
        employees,
        and(
          eq(employees.id, shiftAssignments.employeeId),
          eq(employees.orgId, orgId),
          isNull(employees.deletedAt),
        ),
      )
      .innerJoin(
        shifts,
        and(
          eq(shifts.id, shiftAssignments.shiftId),
          eq(shifts.orgId, orgId),
          isNull(shifts.deletedAt),
        ),
      )
      .leftJoin(
        departments,
        and(
          eq(departments.id, employees.departmentId),
          eq(departments.orgId, orgId),
          isNull(departments.deletedAt),
        ),
      );
  }

  /**
   * Assignments overlapping `[from, to]`.
   *
   * Overlap, not containment. A standing assignment that began last year and a
   * one-week cover that ends next month both decide who works when inside the
   * chosen period, and a containment test would show neither.
   */
  private overlapsPeriod(from: string, to: string): SQL {
    const predicate = and(
      lte(shiftAssignments.effectiveFrom, to),
      or(isNull(shiftAssignments.effectiveTo), gte(shiftAssignments.effectiveTo, from)),
    );
    if (predicate === undefined) {
      throw new Error('Roster period predicate collapsed to undefined.');
    }
    return predicate;
  }

  private filterPredicate(filters: RosterListFilters): SQL[] {
    const parts: SQL[] = [this.overlapsPeriod(filters.from, filters.to), filters.scope];
    if (filters.employeeId !== undefined) {
      parts.push(eq(shiftAssignments.employeeId, filters.employeeId));
    }
    if (filters.shiftId !== undefined) parts.push(eq(shiftAssignments.shiftId, filters.shiftId));
    if (filters.departmentId !== undefined) {
      parts.push(eq(employees.departmentId, filters.departmentId));
    }
    if (filters.locationId !== undefined) parts.push(eq(employees.locationId, filters.locationId));
    if (filters.q !== undefined) {
      parts.push(
        masterSearch(filters.q, [employees.employeeCode, employees.firstName, employees.lastName]),
      );
    }
    return parts;
  }

  async list(filters: RosterListFilters): Promise<{ rows: RosterAssignment[]; total: number }> {
    const where = this.scoped(...this.filterPredicate(filters));

    const rows = await this.joinedSelect()
      .where(where)
      .orderBy(...this.orderBy(filters.sort))
      .limit(filters.limit)
      .offset(filters.offset);

    // Counted through the same joins: the department and search filters live
    // on `employees`, so counting `shift_assignments` alone would report a
    // total the page can never reach.
    const totals = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(shiftAssignments)
      .innerJoin(
        employees,
        and(
          eq(employees.id, shiftAssignments.employeeId),
          eq(employees.orgId, this.ctx.orgId),
          isNull(employees.deletedAt),
        ),
      )
      .innerJoin(
        shifts,
        and(
          eq(shifts.id, shiftAssignments.shiftId),
          eq(shifts.orgId, this.ctx.orgId),
          isNull(shifts.deletedAt),
        ),
      )
      .where(where);

    return { rows: rows.map(toAssignment), total: totals[0]?.value ?? 0 };
  }

  private orderBy(sort: readonly SortTerm[]): (SQL | typeof employees.id)[] {
    const clauses: (SQL | typeof employees.id)[] = [];
    for (const term of sort) {
      const column = SORT_COLUMNS[term.field as keyof typeof SORT_COLUMNS] as
        | (typeof SORT_COLUMNS)[keyof typeof SORT_COLUMNS]
        | undefined;
      if (column === undefined) continue;
      clauses.push(term.direction === 'desc' ? sql`${column} DESC` : sql`${column} ASC`);
    }
    if (clauses.length === 0) clauses.push(sql`${employees.employeeCode} ASC`);
    // The id tiebreak makes paging deterministic; without it two rows sharing
    // a code can swap places between requests, so one appears on two pages and
    // another on none.
    clauses.push(sql`${shiftAssignments.id} ASC`);
    return clauses;
  }

  async assignment(id: string, scope: SQL): Promise<RosterAssignment | null> {
    const rows = await this.joinedSelect()
      .where(this.scoped(eq(shiftAssignments.id, id), scope))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toAssignment(row);
  }

  /**
   * The clash the exclusion constraint would raise, found before the write so
   * the message can name the assignment that is in the way.
   *
   * `excludeId` is the row being edited: an update whose range still covers its
   * own old dates must not be told it conflicts with itself.
   */
  async findOverlapping(
    employeeIds: readonly string[],
    from: string,
    to: string | null,
    excludeId?: string,
  ): Promise<Map<string, { id: string; shiftId: string; shiftName: string; shiftCode: string; from: string; to: string | null }>> {
    if (employeeIds.length === 0) return new Map();

    // Mirrors `daterange(effective_from, effective_to, '[]') && ...`, the
    // expression the exclusion constraint evaluates: both ends inclusive, a
    // null end meaning unbounded. `rangesOverlap` in `roster-range.ts` is the
    // same rule in TypeScript and is where the truth table is tested; the two
    // are kept together deliberately, because a pre-flight check that
    // disagreed with the constraint would either report a clash Postgres would
    // have accepted or promise a write Postgres then refuses.
    //
    // The existing row is [a1, a2], the candidate [b1, b2]. They overlap
    // unless one ends strictly before the other starts, and an unbounded end
    // can never be the one that ends first.
    const existingEndsFirst = sql`(${shiftAssignments.effectiveTo} IS NOT NULL AND ${shiftAssignments.effectiveTo} < ${from})`;
    const candidateEndsFirst =
      to === null ? sql`false` : sql`(${shiftAssignments.effectiveFrom} > ${to})`;
    const overlaps = sql`NOT (${existingEndsFirst} OR ${candidateEndsFirst})`;

    const rows = await this.db
      .select({
        id: shiftAssignments.id,
        employeeId: shiftAssignments.employeeId,
        shiftId: shifts.id,
        shiftName: shifts.name,
        shiftCode: shifts.code,
        from: shiftAssignments.effectiveFrom,
        to: shiftAssignments.effectiveTo,
      })
      .from(shiftAssignments)
      .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .where(
        this.scoped(
          inArray(shiftAssignments.employeeId, [...employeeIds]),
          overlaps,
          excludeId === undefined ? undefined : sql`${shiftAssignments.id} <> ${excludeId}`,
        ),
      )
      .orderBy(asc(shiftAssignments.effectiveFrom));

    const clashes = new Map<
      string,
      { id: string; shiftId: string; shiftName: string; shiftCode: string; from: string; to: string | null }
    >();
    for (const row of rows) {
      // First by start date wins: the earliest clash is the one a reader can
      // most easily reason about, and reporting all of them would turn one
      // refusal into a list nobody reads.
      if (!clashes.has(row.employeeId)) {
        clashes.set(row.employeeId, {
          id: row.id,
          shiftId: row.shiftId,
          shiftName: row.shiftName,
          shiftCode: row.shiftCode,
          from: row.from,
          to: row.to,
        });
      }
    }
    return clashes;
  }

  /** REQ-C-05's selection: everybody in a department, a location, or a named list. */
  async selectEmployees(selection: {
    departmentId?: string | undefined;
    locationId?: string | undefined;
    employeeIds?: readonly string[] | undefined;
    scope: SQL;
  }): Promise<EmployeeSelection[]> {
    const parts: SQL[] = [selection.scope];
    if (selection.departmentId !== undefined) {
      parts.push(eq(employees.departmentId, selection.departmentId));
    }
    if (selection.locationId !== undefined) {
      parts.push(eq(employees.locationId, selection.locationId));
    }
    if (selection.employeeIds !== undefined && selection.employeeIds.length > 0) {
      parts.push(inArray(employees.id, [...selection.employeeIds]));
    }
    // Somebody who has left cannot be rostered; REQ-E-01 stops producing days
    // for them, so an assignment would decide nothing and still block a real
    // one through the exclusion constraint.
    parts.push(sql`${employees.status} <> 'INACTIVE'`);

    const predicate = and(
      eq(employees.orgId, this.ctx.orgId),
      isNull(employees.deletedAt),
      ...parts,
    );
    if (predicate === undefined) {
      throw new Error('Employee selection predicate collapsed to undefined.');
    }

    const rows = await this.db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeCode: employees.employeeCode,
        department: departments.name,
      })
      .from(employees)
      .leftJoin(
        departments,
        and(
          eq(departments.id, employees.departmentId),
          eq(departments.orgId, this.ctx.orgId),
          isNull(departments.deletedAt),
        ),
      )
      .where(predicate)
      .orderBy(asc(employees.employeeCode));

    return rows.map((row) => ({
      id: row.id,
      name: employeeDisplayName(row.firstName, row.lastName),
      employeeCode: row.employeeCode,
      department: row.department,
    }));
  }

  /** True when this employee is one the caller may act on at all. */
  async employeeInScope(employeeId: string, scope: SQL): Promise<EmployeeSelection | null> {
    const found = await this.selectEmployees({ employeeIds: [employeeId], scope });
    return found[0] ?? null;
  }

  /**
   * REQ-C-06, first half: the employee-days in this window that already carry a
   * computed attendance row and would therefore have to be recomputed.
   *
   * Only rows that exist. A date with no row has nothing to recompute -- the
   * nightly sweep will produce it from the new roster when it gets there -- and
   * walking every date in an open-ended range looking for one would be a query
   * per day for a range that has no end.
   */
  async computedDaysIn(
    employeeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<{ employeeId: string; date: string }[]> {
    if (employeeIds.length === 0) return [];

    const rows = await this.db
      .select({ employeeId: attendanceDays.employeeId, date: attendanceDays.date })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.orgId, this.ctx.orgId),
          inArray(attendanceDays.employeeId, [...employeeIds]),
          gte(attendanceDays.date, from),
          lte(attendanceDays.date, to),
          isNull(attendanceDays.deletedAt),
        ),
      )
      .orderBy(asc(attendanceDays.employeeId), asc(attendanceDays.date));

    return rows;
  }

  /**
   * REQ-C-06, second half: the months in this window that are locked for any
   * of these employees.
   *
   * A lock with a null `location_id` is organisation-wide and covers everybody,
   * including an employee with no location of their own -- the same rule the
   * day engine applies in `isPeriodLocked`, restated here because this check
   * runs *before* the write and the engine's runs after.
   */
  async lockedMonthsFor(
    employeeIds: readonly string[],
    months: readonly { year: number; month: number }[],
  ): Promise<string[]> {
    if (employeeIds.length === 0 || months.length === 0) return [];

    const monthPairs = sql.join(
      months.map((m) => sql`(${m.year}, ${m.month})`),
      sql`, `,
    );
    const idList = sql.join(
      employeeIds.map((id) => sql`${id}`),
      sql`, `,
    );

    const rows = await this.db.execute<{ label: string }>(sql`
      SELECT DISTINCT to_char(make_date(l.year, l.month, 1), 'YYYY-MM') AS label
        FROM ${attendancePeriodLocks} l
       WHERE l.org_id = ${this.ctx.orgId}
         AND l.deleted_at IS NULL
         AND l.unlocked_at IS NULL
         AND (l.year, l.month) IN (${monthPairs})
         AND (
           l.location_id IS NULL
           OR EXISTS (
             SELECT 1 FROM ${employees} e
              WHERE e.id IN (${idList})
                AND e.org_id = ${this.ctx.orgId}
                AND e.deleted_at IS NULL
                AND e.location_id = l.location_id
           )
         )
       ORDER BY label
    `);

    return rows.rows.map((row) => row.label);
  }
}
