import { Injectable } from '@nestjs/common';
import { DATA_SCOPES, type DataScope, type PermissionKey } from '@vyuha/shared';
import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { InjectDatabase, type Database } from '../db/db.provider.js';
import { departments, employees } from '../db/schema/index.js';
import { hasPermission, type Principal } from './principal.js';

/**
 * Technical design §10: "Data scoping (`self` / `team` / `all`) is resolved
 * into a `where` fragment by a `ScopeService` and applied in the repository --
 * the controller never builds it."
 *
 * PRD §2 defines the middle one: "team = employees whose
 * `reporting_manager_id` chain reaches the user, plus employees in departments
 * the user owns." *Chain*, not direct reports -- a head of department sees the
 * people two and three levels below as well. That is a graph walk, and it is
 * done as a recursive CTE in one round trip rather than by looping in
 * JavaScript, which would be one query per level of the hierarchy.
 */

/**
 * The permission keys that grant each breadth for one resource. Passing the
 * whole family rather than a single key is what lets the service answer "the
 * broadest thing this caller may see", which is the only question worth asking.
 */
export interface ScopeGrants {
  readonly self?: PermissionKey;
  readonly team?: PermissionKey;
  readonly all?: PermissionKey;
}

export interface ResolvedScope {
  /** `none` means the caller holds no key in the family at all. */
  readonly scope: DataScope | 'none';
  /**
   * Always a usable predicate, never undefined.
   *
   * `all` yields `true` and `none` yields `false` rather than "no filter" and
   * "no filter", which is the mistake this shape exists to prevent: a caller
   * who treats a missing fragment as unrestricted turns a denial into a full
   * table read, and the bug looks like a permissions question rather than a
   * data leak.
   */
  readonly where: SQL;
}

/** `"alias"."column_name"`, tied to the schema so a column rename propagates. */
function at(alias: string, column: PgColumn): SQL {
  return sql.raw(`"${alias}"."${column.name}"`);
}

function from(table: PgTable, alias: string): SQL {
  return sql.raw(`"${getTableName(table)}" AS "${alias}"`);
}

@Injectable()
export class ScopeService {
  constructor(@InjectDatabase() private readonly db: Database) {}

  /** The breadth this principal holds for the family, widest first. */
  breadth(principal: Principal, grants: ScopeGrants): DataScope | 'none' {
    if (grants.all !== undefined && hasPermission(principal, grants.all)) return DATA_SCOPES.ALL;
    if (grants.team !== undefined && hasPermission(principal, grants.team)) return DATA_SCOPES.TEAM;
    if (grants.self !== undefined && hasPermission(principal, grants.self)) return DATA_SCOPES.SELF;
    return 'none';
  }

  /**
   * `employeeColumn` is the column on the table being queried that holds the
   * employee the row is *about* -- `attendance_days.employee_id`,
   * `leave_requests.employee_id`, or `employees.id` itself.
   *
   * Note what is not here: an org predicate. `ScopedRepository` already adds
   * `org_id` and `deleted_at IS NULL` to every statement, and duplicating them
   * would invite a caller to use this fragment on its own.
   */
  resolve(
    principal: Principal,
    grants: ScopeGrants,
    employeeColumn: PgColumn | SQL,
  ): ResolvedScope {
    const scope = this.breadth(principal, grants);

    if (scope === DATA_SCOPES.ALL) return { scope, where: sql`true` };
    if (scope === 'none') return { scope, where: sql`false` };

    // An account with no employee record (REQ-B-02) has no self and no team.
    // Returning `false` rather than throwing keeps this a data question: the
    // caller sees an empty list, which is exactly what such an account owns.
    const employeeId = principal.employeeId;
    if (employeeId === null) return { scope, where: sql`false` };

    if (scope === DATA_SCOPES.SELF) {
      return { scope, where: sql`${employeeColumn} = ${employeeId}` };
    }

    // A holder of `team` who also holds `self` sees their own row too. Read
    // literally, PRD §2's definition of team excludes the manager -- so the
    // self branch is added from the self grant rather than assumed.
    const branches: SQL[] = [
      sql`${employeeColumn} IN ${this.teamSubquery(principal.orgId, employeeId)}`,
    ];
    if (grants.self !== undefined && hasPermission(principal, grants.self)) {
      branches.push(sql`${employeeColumn} = ${employeeId}`);
    }

    return { scope, where: sql`(${sql.join(branches, sql` OR `)})` };
  }

  /**
   * The team set as a subquery, parenthesised and ready for `IN`.
   *
   * `UNION` rather than `UNION ALL` in the recursive term is load-bearing:
   * REQ-A-07 forbids a cycle in the reporting chain and validates on save, but
   * a cycle that got in through a repair script would make `UNION ALL` recurse
   * until Postgres ran out of memory. Deduplicating each round makes a cycle
   * terminate instead.
   */
  private teamSubquery(orgId: string, managerEmployeeId: string): SQL {
    const CHILD = 'vy_scope_child';
    const NEXT = 'vy_scope_next';
    const MEMBER = 'vy_scope_member';
    const DEPT = 'vy_scope_dept';

    return sql`(
      WITH RECURSIVE vy_scope_reports AS (
        SELECT ${at(CHILD, employees.id)} AS id
          FROM ${from(employees, CHILD)}
         WHERE ${at(CHILD, employees.orgId)} = ${orgId}
           AND ${at(CHILD, employees.deletedAt)} IS NULL
           AND ${at(CHILD, employees.reportingManagerId)} = ${managerEmployeeId}
        UNION
        SELECT ${at(NEXT, employees.id)} AS id
          FROM ${from(employees, NEXT)}
          JOIN vy_scope_reports
            ON ${at(NEXT, employees.reportingManagerId)} = vy_scope_reports.id
         WHERE ${at(NEXT, employees.orgId)} = ${orgId}
           AND ${at(NEXT, employees.deletedAt)} IS NULL
      )
      SELECT id FROM vy_scope_reports
      UNION
      SELECT ${at(MEMBER, employees.id)}
        FROM ${from(employees, MEMBER)}
        JOIN ${from(departments, DEPT)}
          ON ${at(DEPT, departments.id)} = ${at(MEMBER, employees.departmentId)}
       WHERE ${at(DEPT, departments.headEmployeeId)} = ${managerEmployeeId}
         AND ${at(DEPT, departments.orgId)} = ${orgId}
         AND ${at(DEPT, departments.deletedAt)} IS NULL
         AND ${at(MEMBER, employees.orgId)} = ${orgId}
         AND ${at(MEMBER, employees.deletedAt)} IS NULL
    )`;
  }

  /**
   * The team as a list of ids. The `resolve` fragment is what production code
   * should use -- it keeps the set inside Postgres -- but a caller that needs
   * the membership itself (an approver picker, a test asserting the recursion
   * really recurses) should not have to rebuild the query.
   */
  async teamEmployeeIds(orgId: string, managerEmployeeId: string): Promise<string[]> {
    const rows = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM ${this.teamSubquery(orgId, managerEmployeeId)} AS vy_scope_team`,
    );
    return rows.rows.map((row) => row.id);
  }
}
