import type { WeeklyOffPatternSummary } from '@vyuha/shared';
import { and, asc, eq, getTableName, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { Database } from '../../../platform/db/db.provider.js';
import { employees } from '../../../platform/db/schema/index.js';
import { ScopedRepository, type OrgContext } from '../../../platform/db/scoped-repository.js';
import { masterSearch } from '../../../platform/org/master-query.js';
import { parseWeeklyOffConfig } from '../day-engine/weekly-off.js';
import { weeklyOffPatterns } from '../schema/index.js';

/**
 * Weekly-off patterns (REQ-C-03).
 *
 * `config` is parsed on the way out with `parseWeeklyOffConfig` -- the day
 * engine's own validator, not a second copy of it. That matters more than the
 * duplication it avoids: if this endpoint could return a config the engine
 * refuses to read, the screen would show a pattern that silently marks nobody
 * off, and the only symptom would be a month of wrong musters. Using one
 * validator makes "readable here" and "readable by the engine" the same
 * question.
 */

/**
 * `"table"."column"`, tied to the schema so a column rename propagates. Same
 * helper, and the same reason, as the one in `platform/rbac/scope.service.ts`.
 */
function at(table: PgTable, column: PgColumn): SQL {
  return sql.raw(`"${getTableName(table)}"."${column.name}"`);
}

export interface WeeklyOffPatternListFilters {
  readonly q?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

interface PatternRow {
  id: string;
  name: string;
  config: unknown;
  employeeCount: number;
}

function toSummary(row: PatternRow): WeeklyOffPatternSummary {
  return {
    id: row.id,
    name: row.name,
    config: parseWeeklyOffConfig(row.config, row.id),
    employeeCount: row.employeeCount,
  };
}

export class WeeklyOffPatternRepository extends ScopedRepository<typeof weeklyOffPatterns> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, weeklyOffPatterns, ctx);
  }

  /**
   * The employee count is a correlated subquery rather than a join with a
   * GROUP BY: the outer query pages, and grouping after a join would make the
   * page size a count of employees rather than of patterns.
   *
   * Every column reference is written out with `at()` rather than interpolated
   * as a Drizzle column, and that is not style. Inside a *select projection*
   * Drizzle renders `${table.column}` as a bare `"column"` with no table
   * qualifier -- it qualifies in WHERE and ORDER BY, but not here. The first
   * version of this query therefore compiled to
   * `WHERE "weekly_off_pattern_id" = "id"`, both resolving inside the
   * subquery's own scope, which is `employees.weekly_off_pattern_id =
   * employees.id`: never true, no error, every pattern reported as used by
   * nobody. Caught by the test that asserts the count is 1.
   */
  private countingSelect() {
    const orgId = this.ctx.orgId;
    return this.db
      .select({
        id: weeklyOffPatterns.id,
        name: weeklyOffPatterns.name,
        config: weeklyOffPatterns.config,
        employeeCount: sql<number>`(
          SELECT count(*)::int FROM ${employees}
           WHERE ${at(employees, employees.weeklyOffPatternId)}
               = ${at(weeklyOffPatterns, weeklyOffPatterns.id)}
             AND ${at(employees, employees.orgId)} = ${orgId}
             AND ${at(employees, employees.deletedAt)} IS NULL
        )`,
      })
      .from(weeklyOffPatterns);
  }

  async list(
    filters: WeeklyOffPatternListFilters,
  ): Promise<{ rows: WeeklyOffPatternSummary[]; total: number }> {
    const search =
      filters.q === undefined ? undefined : masterSearch(filters.q, [weeklyOffPatterns.name]);
    const where = this.scoped(search);

    const rows = await this.countingSelect()
      .where(where)
      .orderBy(asc(weeklyOffPatterns.name), asc(weeklyOffPatterns.id))
      .limit(filters.limit)
      .offset(filters.offset);

    const totals = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(weeklyOffPatterns)
      .where(where);

    return { rows: rows.map(toSummary), total: totals[0]?.value ?? 0 };
  }

  async summary(id: string): Promise<WeeklyOffPatternSummary | null> {
    const rows = await this.countingSelect()
      .where(this.scoped(eq(weeklyOffPatterns.id, id)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toSummary(row);
  }

  async findIdByName(name: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: weeklyOffPatterns.id })
      .from(weeklyOffPatterns)
      .where(this.scoped(eq(weeklyOffPatterns.name, name)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /**
   * Employees whose weekly offs this pattern decides.
   *
   * Editing a pattern changes which days are off for every one of them, and
   * REQ-C-06's recompute rule is about a roster change -- but the effect on the
   * computed day is identical, so the service uses this to recompute them too
   * rather than leaving a month of days that disagree with the pattern that
   * produced them.
   */
  async employeeIdsUsing(patternId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.orgId, this.ctx.orgId),
          eq(employees.weeklyOffPatternId, patternId),
          isNull(employees.deletedAt),
        ),
      );
    return rows.map((row) => row.id);
  }
}
