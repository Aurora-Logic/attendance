import { Injectable } from '@nestjs/common';
import {
  ATTENDANCE_DAY_SORT_FIELDS,
  REPORT_DEFINITIONS,
  attendanceRegisterCell,
  pageSlice,
  paginated,
  parseAttendanceFlags,
  parseSort,
  punchAuditCell,
  sortableFields,
  type AttendanceDaySummary,
  type Paginated,
  type PunchRecord,
  type ReportCellValue,
  type ReportColumnSpec,
  type ReportFilters,
  type ReportKey,
  type ReportRowQuery,
  type SortTerm,
} from '@vyuha/shared';
import { and, type SQL } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService } from '../../../platform/rbac/scope.service.js';
import { AttendanceDayRepository } from '../days/attendance-day.repository.js';
import { ATTENDANCE_SCOPE_GRANTS } from '../punch/punch.service.js';
import { attendanceDays } from '../schema/index.js';
import { punches } from '../schema/index.js';
import { ReportRepository } from './report.repository.js';

/**
 * The rows behind every report (REQ-J-01).
 *
 * One entry point, `page`, and one row-to-cells function, so the screen and
 * the exported file cannot disagree. The export job calls the same method with
 * a larger page size rather than a query of its own -- that is the property
 * that makes "the spreadsheet matches what I was looking at" true by
 * construction instead of by review.
 *
 * `report.view` gets a caller through the door; `ScopeService` decides how much
 * they see. Those are different questions and the guard only answers the first
 * one: an Operations user holding `report.view` and `attendance.view.team`
 * sees their team, and the same user without any attendance key sees nothing
 * at all rather than everything.
 */

/** The discriminated page. A union of rows would need a cast to read a field. */
export type ReportPage =
  | { readonly kind: 'attendance-register'; readonly rows: AttendanceDaySummary[]; readonly total: number }
  | { readonly kind: 'punch-audit'; readonly rows: PunchRecord[]; readonly total: number };

/** How many rows one round trip pulls while an export is being written. */
export const EXPORT_BATCH_ROWS = 1_000;

@Injectable()
export class ReportService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly scopes: ScopeService,
  ) {}

  async list(
    principal: Principal,
    reportKey: ReportKey,
    query: ReportRowQuery,
  ): Promise<Paginated<AttendanceDaySummary> | Paginated<PunchRecord>> {
    const { limit, offset } = pageSlice(query);
    const page = await this.page(principal, reportKey, query, limit, offset);
    return page.kind === 'attendance-register'
      ? paginated(page.rows, query, page.total)
      : paginated(page.rows, query, page.total);
  }

  /**
   * One page of a report. `limit` and `offset` are explicit rather than read
   * from the query, because the export walks the whole result in batches that
   * have nothing to do with the reader's page size.
   */
  async page(
    principal: Principal,
    reportKey: ReportKey,
    filters: ReportFilters & { sort?: string | undefined },
    limit: number,
    offset: number,
  ): Promise<ReportPage> {
    const sort = parseSort(
      filters.sort ?? REPORT_DEFINITIONS[reportKey].defaultSort,
      sortableFields(reportKey),
    );

    if (reportKey === 'attendance-register') {
      return this.attendanceRegister(principal, filters, sort, limit, offset);
    }
    return this.punchAudit(principal, filters, sort, limit, offset);
  }

  /** The total on its own, so an export can refuse an oversized job before starting it. */
  async count(
    principal: Principal,
    reportKey: ReportKey,
    filters: ReportFilters,
  ): Promise<number> {
    if (reportKey === 'punch-audit') {
      return new ReportRepository(this.db, orgContextOf(principal)).countPunches({
        scope: this.scopeFor(principal, 'punch-audit'),
        ...this.commonFilters(filters),
      });
    }
    // `AttendanceDayRepository` answers the count as part of a page; asking for
    // a single row is cheaper than a second code path that could filter
    // differently from the one that produces the rows.
    const page = await this.attendanceRegister(principal, filters, [], 1, 0);
    return page.total;
  }

  // ------------------------------------------------------------- row sources

  private async attendanceRegister(
    principal: Principal,
    filters: ReportFilters,
    sort: readonly SortTerm[],
    limit: number,
    offset: number,
  ): Promise<ReportPage> {
    const repository = new AttendanceDayRepository(this.db, orgContextOf(principal));

    // The department filter is native to that repository; location is not, and
    // is folded into the scope fragment, which the repository ANDs into every
    // statement over the same joined `employees`.
    const scope = this.narrowedScope(principal, 'attendance-register', {
      locationId: filters.locationId,
    });

    const { rows, total } = await repository.list({
      scope,
      from: filters.from,
      to: filters.to,
      employeeId: filters.employeeId,
      departmentId: filters.departmentId,
      status: filters.status,
      flags: parseAttendanceFlags(filters.flags),
      // Re-parsed against that repository's own field list: it owns which of
      // its columns are orderable, and a field it does not know is dropped
      // rather than silently ordering by something else.
      sort: parseSort(termsToSpec(sort), ATTENDANCE_DAY_SORT_FIELDS),
      limit,
      offset,
    });

    return { kind: 'attendance-register', rows, total };
  }

  private async punchAudit(
    principal: Principal,
    filters: ReportFilters,
    sort: readonly SortTerm[],
    limit: number,
    offset: number,
  ): Promise<ReportPage> {
    const repository = new ReportRepository(this.db, orgContextOf(principal));
    const { rows, total } = await repository.punchAudit(
      { scope: this.scopeFor(principal, 'punch-audit'), ...this.commonFilters(filters) },
      sort,
      limit,
      offset,
    );
    return { kind: 'punch-audit', rows, total };
  }

  private commonFilters(filters: ReportFilters) {
    return {
      from: filters.from,
      to: filters.to,
      employeeId: filters.employeeId,
      departmentId: filters.departmentId,
      locationId: filters.locationId,
      punchType: filters.punchType,
    };
  }

  // ------------------------------------------------------------------ scope

  /**
   * Technical design §10: the fragment comes from `ScopeService`, never from
   * here. Written against the column naming the person each row is about,
   * which differs by report and is the only thing this method decides.
   */
  private scopeFor(principal: Principal, reportKey: ReportKey): SQL {
    const column =
      reportKey === 'punch-audit' ? punches.employeeId : attendanceDays.employeeId;
    return this.scopes.resolve(principal, ATTENDANCE_SCOPE_GRANTS, column).where;
  }

  private narrowedScope(
    principal: Principal,
    reportKey: ReportKey,
    extra: { locationId?: string | undefined },
  ): SQL {
    const scope = this.scopeFor(principal, reportKey);
    const employee = ReportRepository.employeePredicate(extra);
    if (employee === undefined) return scope;
    const combined = and(scope, employee);
    if (combined === undefined) {
      throw new Error('Scope predicate collapsed to undefined; refusing to run an unscoped query.');
    }
    return combined;
  }
}

/** `SortTerm[]` back to the `?sort=` spelling `parseSort` consumes. */
function termsToSpec(sort: readonly SortTerm[]): string {
  return sort.map((term) => (term.direction === 'desc' ? `-${term.field}` : term.field)).join(',');
}

/**
 * A row as the cells its chosen columns ask for.
 *
 * Exported rather than a method so the export job and any future renderer use
 * the same extraction, and so it is unit-testable without a database. The
 * extractors themselves are in `@vyuha/shared`, which is what lets the web
 * table read the identical value out of the identical row.
 */
export function cellsFor(page: ReportPage, index: number, columns: readonly ReportColumnSpec[]): ReportCellValue[] {
  if (page.kind === 'attendance-register') {
    const row = page.rows[index];
    if (row === undefined) return columns.map(() => null);
    return columns.map((column) => attendanceRegisterCell(row, column.key));
  }
  const row = page.rows[index];
  if (row === undefined) return columns.map(() => null);
  return columns.map((column) => punchAuditCell(row, column.key));
}
