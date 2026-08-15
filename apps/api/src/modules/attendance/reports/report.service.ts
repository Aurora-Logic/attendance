import { Injectable } from '@nestjs/common';
import {
  ALL_REPORTS,
  ATTENDANCE_DAY_SORT_FIELDS,
  DEFAULT_LEAVE_YEAR_START_MONTH,
  REPORT_DEFINITIONS,
  absenteeismCell,
  attendanceExceptionCell,
  attendanceRegisterCell,
  headcountCell,
  leaveAvailedCell,
  leaveBalanceCell,
  leaveLedgerCell,
  leaveYearOf,
  missingPunchCell,
  musterGridCell,
  pageSlice,
  paginated,
  parseAttendanceFlags,
  parseSort,
  punchAuditCell,
  sortableFields,
  type AbsenteeismSource,
  type AttendanceDaySummary,
  type AttendanceExceptionSource,
  type HeadcountSource,
  type LeaveAvailedSource,
  type LeaveBalanceSource,
  type LeaveLedgerSource,
  type MissingPunchSource,
  type MusterGridSource,
  type Paginated,
  type PunchRecord,
  type ReportCellValue,
  type ReportColumnSpec,
  type ReportDefinition,
  type ReportFilters,
  type ReportKey,
  type ReportRowQuery,
  type SortTerm,
} from '@vyuha/shared';
import { and, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { EMPLOYEE_SCOPE_GRANTS } from '../../../platform/people/employee.service.js';
import { orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService, type ScopeGrants } from '../../../platform/rbac/scope.service.js';
import { AttendanceDayRepository } from '../days/attendance-day.repository.js';
import { LEAVE_SCOPE_GRANTS } from '../leave/leave.service.js';
import { ATTENDANCE_SCOPE_GRANTS } from '../punch/punch.service.js';
import { attendanceDays } from '../schema/index.js';
import { punches } from '../schema/index.js';
import {
  ReportAggregateRepository,
  type AggregateFilters,
  type ExceptionMeasure,
} from './report-aggregate.repository.js';
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
 *
 * Which family of keys resolves the scope depends on what the report is *of*,
 * not on where its code lives. Leave reports resolve against the leave grants
 * and headcount against the employee grants, because a manager permitted to see
 * their team's attendance is not thereby permitted to see the org's leave
 * ledger. A role holding `report.view` and no key for a report's subject is not
 * shown that report at all -- see `catalogue` -- rather than being shown one
 * that answers "nothing in this period" forever.
 */

/**
 * The discriminated page, keyed by row *shape* rather than by report.
 *
 * Late arrivals, early exits and overtime are one shape because they are one
 * query with the measured column swapped; the register and the daily muster are
 * one shape because there is one `attendance_days` row per employee per date
 * and a second query for it would be a second answer.
 */
export type ReportPage =
  | { readonly kind: 'day'; readonly rows: AttendanceDaySummary[]; readonly total: number }
  | { readonly kind: 'punch'; readonly rows: PunchRecord[]; readonly total: number }
  | { readonly kind: 'muster-grid'; readonly rows: MusterGridSource[]; readonly total: number }
  | { readonly kind: 'exception'; readonly rows: AttendanceExceptionSource[]; readonly total: number }
  | { readonly kind: 'absenteeism'; readonly rows: AbsenteeismSource[]; readonly total: number }
  | { readonly kind: 'missing-punch'; readonly rows: MissingPunchSource[]; readonly total: number }
  | { readonly kind: 'leave-balance'; readonly rows: LeaveBalanceSource[]; readonly total: number }
  | { readonly kind: 'leave-ledger'; readonly rows: LeaveLedgerSource[]; readonly total: number }
  | { readonly kind: 'leave-availed'; readonly rows: LeaveAvailedSource[]; readonly total: number }
  | { readonly kind: 'headcount'; readonly rows: HeadcountSource[]; readonly total: number };

/** Any row any report serves. The endpoint's element type. */
export type ReportRow = ReportPage['rows'][number];

/** How many rows one round trip pulls while an export is being written. */
export const EXPORT_BATCH_ROWS = 1_000;

/** The column of `attendance_days` each exception report measures. */
const EXCEPTION_MEASURES: Partial<Record<ReportKey, ExceptionMeasure>> = {
  'late-arrivals': 'late_minutes',
  'early-exits': 'early_exit_minutes',
  overtime: 'ot_minutes',
};

/**
 * Which family of keys decides how much of a report a caller sees.
 *
 * By subject, not by where the code lives: leave reports answer to the leave
 * keys and headcount to the employee keys, because a manager permitted to see
 * their team's attendance is not thereby permitted to read the organisation's
 * leave ledger.
 */
function grantsFor(reportKey: ReportKey): ScopeGrants {
  switch (reportKey) {
    case 'leave-balance':
    case 'leave-ledger':
    case 'leave-availed':
      return LEAVE_SCOPE_GRANTS;
    case 'headcount':
      return EMPLOYEE_SCOPE_GRANTS;
    default:
      return ATTENDANCE_SCOPE_GRANTS;
  }
}

/** The column naming the person each row is about, per report. */
function subjectColumn(reportKey: ReportKey): PgColumn | SQL {
  switch (reportKey) {
    case 'punch-audit':
      return punches.employeeId;
    case 'leave-balance':
      return sql.raw('"leave_balances"."employee_id"');
    case 'leave-ledger':
      return sql.raw('"leave_ledger"."employee_id"');
    case 'leave-availed':
      return sql.raw('"leave_requests"."employee_id"');
    case 'headcount':
      return sql.raw('"employees"."id"');
    default:
      return attendanceDays.employeeId;
  }
}

@Injectable()
export class ReportService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly scopes: ScopeService,
  ) {}

  /**
   * The reports this caller can actually get rows out of.
   *
   * `report.view` opens the door; the subject's own key family decides whether
   * there is anything behind it. Offering a leave report to somebody holding no
   * leave key would answer "Nothing in this period" forever -- which reads as a
   * quiet month rather than as a permission they do not have, and is exactly the
   * silent failure the empty state must not be used for.
   */
  catalogue(principal: Principal): readonly ReportDefinition[] {
    return ALL_REPORTS.filter(
      (report) => this.scopes.breadth(principal, grantsFor(report.key)) !== 'none',
    );
  }

  async list(
    principal: Principal,
    reportKey: ReportKey,
    query: ReportRowQuery,
  ): Promise<Paginated<ReportRow>> {
    const { limit, offset } = pageSlice(query);
    const page = await this.page(principal, reportKey, query, limit, offset);
    return paginated<ReportRow>([...page.rows], query, page.total);
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
    const narrowed = ReportService.assertFiltersUsable(reportKey, filters);
    const sort = parseSort(
      filters.sort ?? REPORT_DEFINITIONS[reportKey].defaultSort,
      sortableFields(reportKey),
    );

    switch (reportKey) {
      case 'attendance-register':
      case 'daily-muster':
        return this.attendanceDays(principal, reportKey, narrowed, sort, limit, offset);
      case 'punch-audit':
        return this.punchAudit(principal, narrowed, sort, limit, offset);
      default:
        return this.aggregate(principal, reportKey, narrowed, sort, limit, offset);
    }
  }

  /** The total on its own, so an export can refuse an oversized job before starting it. */
  async count(principal: Principal, reportKey: ReportKey, filters: ReportFilters): Promise<number> {
    if (reportKey === 'punch-audit') {
      return new ReportRepository(this.db, orgContextOf(principal)).countPunches({
        scope: this.scopeFor(principal, 'punch-audit'),
        ...this.commonFilters(filters),
      });
    }
    // Every other row source answers the count as part of a page; asking for a
    // single row is cheaper than a second code path that could filter
    // differently from the one that produces the rows.
    const page = await this.page(principal, reportKey, filters, 1, 0);
    return page.total;
  }

  // ------------------------------------------------------------ the filters

  /**
   * Refuses a period this report cannot answer for, and narrows the ones whose
   * shape depends on it.
   *
   * Public and static so `ExportService` can run it when the button is pressed
   * rather than discovering it inside a background job -- a job that throws is
   * retried five times with backoff, and "you asked for two months of a
   * one-month grid" is a sentence, not a fault.
   */
  static assertFiltersUsable(reportKey: ReportKey, filters: ReportFilters): ReportFilters {
    const definition = REPORT_DEFINITIONS[reportKey];

    if (definition.singleDate === true) {
      // The end of the period, so a reader who dragged a range across the
      // calendar gets the last day they pointed at rather than a refusal.
      const date = filters.to ?? filters.from;
      if (date === undefined) {
        throw AppError.validation(`${definition.label} is for one date. Pick a date.`);
      }
      return { ...filters, from: date, to: date };
    }

    if (definition.singleMonth === true) {
      const { from, to } = filters;
      if (from === undefined || to === undefined) {
        throw AppError.validation(`${definition.label} covers one month. Pick a period.`);
      }
      if (from.slice(0, 7) !== to.slice(0, 7)) {
        throw AppError.validation(
          `${definition.label} covers one calendar month, and ${from} to ${to} spans more than one. Narrow the period.`,
          { from, to },
        );
      }
      return filters;
    }

    if (reportKey === 'headcount' && (filters.from === undefined || filters.to === undefined)) {
      throw AppError.validation('Headcount is reported by month. Pick a period.');
    }

    if (reportKey === 'leave-balance' && filters.from === undefined && filters.to === undefined) {
      throw AppError.validation(
        'A leave balance belongs to a leave year. Pick a period inside the year you want.',
      );
    }

    return filters;
  }

  // ------------------------------------------------------------- row sources

  private async attendanceDays(
    principal: Principal,
    reportKey: 'attendance-register' | 'daily-muster',
    filters: ReportFilters,
    sort: readonly SortTerm[],
    limit: number,
    offset: number,
  ): Promise<ReportPage> {
    const repository = new AttendanceDayRepository(this.db, orgContextOf(principal));

    // The department filter is native to that repository; location is not, and
    // is folded into the scope fragment, which the repository ANDs into every
    // statement over the same joined `employees`.
    const scope = this.narrowedScope(principal, reportKey, { locationId: filters.locationId });

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

    return { kind: 'day', rows, total };
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
    return { kind: 'punch', rows, total };
  }

  /** The reports that group. One repository, one shape of filters, one scope. */
  private async aggregate(
    principal: Principal,
    reportKey: ReportKey,
    filters: ReportFilters,
    sort: readonly SortTerm[],
    limit: number,
    offset: number,
  ): Promise<ReportPage> {
    const context = orgContextOf(principal);
    const repository = new ReportAggregateRepository(this.db, context);
    const scoped: AggregateFilters = {
      scope: this.scopeFor(principal, reportKey),
      ...this.commonFilters(filters),
    };

    const measure = EXCEPTION_MEASURES[reportKey];
    if (measure !== undefined) {
      return { kind: 'exception', ...(await repository.exceptions(measure, scoped, sort, limit, offset)) };
    }

    switch (reportKey) {
      case 'monthly-muster':
        return { kind: 'muster-grid', ...(await repository.musterGrid(scoped, sort, limit, offset)) };

      case 'absenteeism':
        return { kind: 'absenteeism', ...(await repository.absenteeism(scoped, sort, limit, offset)) };

      case 'missing-punch':
        return {
          kind: 'missing-punch',
          ...(await repository.missingPunch(scoped, sort, limit, offset)),
        };

      case 'leave-balance': {
        const profile = await new ReportRepository(this.db, context).orgProfile();
        // The leave year the period opens in. A period straddling the year
        // boundary reports the year it began in rather than adding two
        // together, which would produce a balance nothing reconciles to.
        const anchor = filters.from ?? filters.to;
        const leaveYear = leaveYearOf(
          anchor ?? new Date().toISOString().slice(0, 10),
          profile.leaveYearStartMonth || DEFAULT_LEAVE_YEAR_START_MONTH,
        );
        return {
          kind: 'leave-balance',
          ...(await repository.leaveBalance(scoped, leaveYear, sort, limit, offset)),
        };
      }

      case 'leave-ledger': {
        const profile = await new ReportRepository(this.db, context).orgProfile();
        return {
          kind: 'leave-ledger',
          ...(await repository.leaveLedger(scoped, profile.timezone, sort, limit, offset)),
        };
      }

      case 'leave-availed':
        return {
          kind: 'leave-availed',
          ...(await repository.leaveAvailed(scoped, sort, limit, offset)),
        };

      case 'headcount': {
        const { from, to } = filters;
        if (from === undefined || to === undefined) {
          // Unreachable: `assertFiltersUsable` refused this already. Kept
          // because the repository's signature requires both, and a
          // non-null assertion on a value the type system cannot see is
          // exactly the thing CLAUDE.md forbids.
          throw AppError.validation('Headcount is reported by month. Pick a period.');
        }
        return {
          kind: 'headcount',
          ...(await repository.headcount({ ...scoped, from, to }, sort, limit, offset)),
        };
      }

      default:
        // A report key with no row source is a catalogue entry that was added
        // without one. A 404 would suggest the key is unknown, which it is not.
        throw AppError.validation(`This build has no rows for the report "${reportKey}".`);
    }
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
   * here. Written against the column naming the person each row is about, and
   * resolved against the key family that owns that subject -- which is the only
   * thing this method decides.
   */
  private scopeFor(principal: Principal, reportKey: ReportKey): SQL {
    return this.scopes.resolve(principal, grantsFor(reportKey), subjectColumn(reportKey)).where;
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
export function cellsFor(
  page: ReportPage,
  index: number,
  columns: readonly ReportColumnSpec[],
): ReportCellValue[] {
  const empty = (): ReportCellValue[] => columns.map(() => null);

  switch (page.kind) {
    case 'day': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => attendanceRegisterCell(row, c.key));
    }
    case 'punch': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => punchAuditCell(row, c.key));
    }
    case 'muster-grid': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => musterGridCell(row, c.key));
    }
    case 'exception': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => attendanceExceptionCell(row, c.key));
    }
    case 'absenteeism': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => absenteeismCell(row, c.key));
    }
    case 'missing-punch': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => missingPunchCell(row, c.key));
    }
    case 'leave-balance': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => leaveBalanceCell(row, c.key));
    }
    case 'leave-ledger': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => leaveLedgerCell(row, c.key));
    }
    case 'leave-availed': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => leaveAvailedCell(row, c.key));
    }
    case 'headcount': {
      const row = page.rows[index];
      return row === undefined ? empty() : columns.map((c) => headcountCell(row, c.key));
    }
  }
}
