import {
  employeeDisplayName,
  type AttendanceDaySortField,
  type AttendanceDaySummary,
  type AttendanceFlag,
  type AttendanceStatus,
  type SortTerm,
} from '@vyuha/shared';
import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';

import type { Database } from '../../../platform/db/db.provider.js';
import { employees } from '../../../platform/db/schema/index.js';
import { ScopedRepository, type OrgContext } from '../../../platform/db/scoped-repository.js';
import { attendanceDays, punches, shifts } from '../schema/index.js';

/**
 * The read surface over `attendance_days` (REQ-E-01 … REQ-E-05).
 *
 * Read only, and that is the design rather than an omission: technical design
 * §5 says "nothing outside `DayEngine` writes it". A muster screen, a report
 * and the punch receipt all come through here; the row itself is only ever
 * produced by `computeDay`.
 *
 * `ScopedRepository` *is* the base class here -- unlike `punches`,
 * `attendance_days` carries the full soft-delete column set -- so `org_id` and
 * `deleted_at IS NULL` are on every statement before any filter is applied.
 */

/**
 * Created once at module scope: `alias()` mints a new object per call, and a
 * join built from one instance while the select reads another produces SQL
 * naming two different aliases, which Postgres answers with a cross join.
 */
const firstInPunch = alias(punches, 'first_in_punch');
const lastOutPunch = alias(punches, 'last_out_punch');

/** UTC ISO-8601 with a literal Z, which `new Date` reads without ambiguity. */
const INSTANT_FORMAT = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);

/**
 * The time this day actually started or ended: an approved correction if there
 * is one, otherwise the punch.
 *
 * REQ-F-03 says an approved regularization is written beside the punches and
 * the day is recomputed, and that the original punches "remain untouched and
 * visible". The engine honours both — it derives the day's minutes from the
 * adjustment while leaving `first_in_punch_id` and `last_out_punch_id` pointed
 * at the real punches, so the detail sheet can still show what was actually
 * recorded.
 *
 * That left this read saying something untrue. Reading the punch alone, a day
 * whose missing OUT had just been approved came back as "in 09:05, out —,
 * worked 8h 25m": three numbers that cannot all be right, on the first screen
 * the employee opens after their correction is approved. The adjustment is
 * folded in here, and only here — the punch list beside it is untouched, so
 * both halves of REQ-F-03 are now true at once.
 *
 * Last non-null wins, ordered by `created_at`, which is exactly how
 * `DayEngineRepository.findAdjustment` folds several adjustments for one day.
 * Two implementations of that rule would be two answers to "what time did this
 * person leave", and the muster and the minutes beside it would disagree.
 */
function effectiveInstant(
  orgId: string,
  column: 'adjusted_in' | 'adjusted_out',
  punchTime: PgColumn,
): SQL<string | null> {
  return sql<string | null>`to_char(
    coalesce(
      (SELECT ${sql.raw(`vy_adj.${column}`)}
         FROM attendance_adjustments AS vy_adj
        WHERE vy_adj.org_id = ${orgId}
          AND vy_adj.employee_id = ${attendanceDays.employeeId}
          AND vy_adj.attendance_date = ${attendanceDays.date}
          AND vy_adj.deleted_at IS NULL
          AND ${sql.raw(`vy_adj.${column}`)} IS NOT NULL
        ORDER BY vy_adj.created_at DESC, vy_adj.id DESC
        LIMIT 1),
      ${punchTime}
    ) AT TIME ZONE 'UTC', ${INSTANT_FORMAT})`;
}

const SORT_COLUMNS: Record<AttendanceDaySortField, PgColumn> = {
  date: attendanceDays.date,
  employeeCode: employees.employeeCode,
  status: attendanceDays.status,
  workedMinutes: attendanceDays.workedMinutes,
};

export interface AttendanceDayFilters {
  /** Resolved by `ScopeService`; never built here and never optional. */
  readonly scope: SQL;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly employeeId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly status?: AttendanceStatus | undefined;
  readonly flags: readonly AttendanceFlag[];
  readonly sort: readonly SortTerm[];
  readonly limit: number;
  readonly offset: number;
}

interface JoinedRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeFirstName: string;
  employeeLastName: string | null;
  date: string;
  status: AttendanceStatus;
  shiftId: string | null;
  shiftName: string | null;
  scheduledIn: Date | null;
  scheduledOut: Date | null;
  /** Already ISO-8601 UTC text: see `effectiveInstant`, which formats it. */
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  otMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  earlyArrivalMinutes: number;
  earlyArrival: boolean;
  earlyStreak: number;
  flags: AttendanceFlag[];
  isManualOverride: boolean;
  locked: boolean;
}

function toSummary(row: JoinedRow): AttendanceDaySummary {
  return {
    id: row.id,
    employee: {
      id: row.employeeId,
      name: employeeDisplayName(row.employeeFirstName, row.employeeLastName),
    },
    employeeCode: row.employeeCode,
    date: row.date,
    status: row.status,
    shift: row.shiftId === null || row.shiftName === null ? null : { id: row.shiftId, name: row.shiftName },
    scheduledIn: row.scheduledIn?.toISOString() ?? null,
    scheduledOut: row.scheduledOut?.toISOString() ?? null,
    firstInAt: row.firstInAt,
    lastOutAt: row.lastOutAt,
    workedMinutes: row.workedMinutes,
    breakMinutes: row.breakMinutes,
    otMinutes: row.otMinutes,
    lateMinutes: row.lateMinutes,
    earlyExitMinutes: row.earlyExitMinutes,
    earlyArrivalMinutes: row.earlyArrivalMinutes,
    earlyArrival: row.earlyArrival,
    earlyStreak: row.earlyStreak,
    flags: row.flags,
    isManualOverride: row.isManualOverride,
    locked: row.locked,
  };
}

export class AttendanceDayRepository extends ScopedRepository<typeof attendanceDays> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, attendanceDays, ctx);
  }

  async list(
    filters: AttendanceDayFilters,
  ): Promise<{ rows: AttendanceDaySummary[]; total: number }> {
    const where = this.scoped(filters.scope, this.filterPredicate(filters));

    const rows = await this.joinedSelect()
      .where(where)
      .orderBy(...this.orderBy(filters.sort))
      .limit(filters.limit)
      .offset(filters.offset);

    // A second statement rather than `count(*) OVER ()`, for the reason the
    // employee repository gives: a window function returns no row at all for
    // an empty page, and "no rows" and "total zero" are different answers.
    const totals = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(attendanceDays)
      .innerJoin(
        employees,
        and(
          eq(employees.id, attendanceDays.employeeId),
          eq(employees.orgId, this.ctx.orgId),
          isNull(employees.deletedAt),
        ),
      )
      .where(where);

    return { rows: rows.map(toSummary), total: totals[0]?.value ?? 0 };
  }

  /**
   * One day. `scope` is required for the same reason it is on the list: the
   * employee id comes from the URL, and an Operations user guessing one
   * outside their team must get the same answer as for an id that does not
   * exist.
   */
  async findDay(employeeId: string, date: string, scope: SQL): Promise<AttendanceDaySummary | null> {
    const rows = await this.joinedSelect()
      .where(
        this.scoped(scope, eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date)),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : toSummary(row);
  }

  // ------------------------------------------------------------- internals

  private joinedSelect() {
    const orgId = this.ctx.orgId;

    return this.db
      .select({
        id: attendanceDays.id,
        employeeId: attendanceDays.employeeId,
        employeeCode: employees.employeeCode,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        date: attendanceDays.date,
        status: attendanceDays.status,
        shiftId: shifts.id,
        shiftName: shifts.name,
        scheduledIn: attendanceDays.scheduledIn,
        scheduledOut: attendanceDays.scheduledOut,
        firstInAt: effectiveInstant(orgId, 'adjusted_in', firstInPunch.serverTime),
        lastOutAt: effectiveInstant(orgId, 'adjusted_out', lastOutPunch.serverTime),
        workedMinutes: attendanceDays.workedMinutes,
        breakMinutes: attendanceDays.breakMinutes,
        otMinutes: attendanceDays.otMinutes,
        lateMinutes: attendanceDays.lateMinutes,
        earlyExitMinutes: attendanceDays.earlyExitMinutes,
        earlyArrivalMinutes: attendanceDays.earlyArrivalMinutes,
        earlyArrival: attendanceDays.earlyArrival,
        earlyStreak: attendanceDays.earlyStreak,
        flags: attendanceDays.flags,
        isManualOverride: attendanceDays.isManualOverride,
        locked: attendanceDays.locked,
      })
      .from(attendanceDays)
      // Inner, not left: a day whose employee has been soft-deleted is not a
      // row any screen should render, and an outer join would produce one with
      // a nameless employee.
      .innerJoin(
        employees,
        and(
          eq(employees.id, attendanceDays.employeeId),
          eq(employees.orgId, orgId),
          isNull(employees.deletedAt),
        ),
      )
      .leftJoin(
        shifts,
        and(eq(shifts.id, attendanceDays.shiftId), eq(shifts.orgId, orgId), isNull(shifts.deletedAt)),
      )
      .leftJoin(
        firstInPunch,
        and(eq(firstInPunch.id, attendanceDays.firstInPunchId), eq(firstInPunch.orgId, orgId)),
      )
      .leftJoin(
        lastOutPunch,
        and(eq(lastOutPunch.id, attendanceDays.lastOutPunchId), eq(lastOutPunch.orgId, orgId)),
      );
  }

  private filterPredicate(filters: AttendanceDayFilters): SQL | undefined {
    const parts: SQL[] = [];

    if (filters.from !== undefined) parts.push(gte(attendanceDays.date, filters.from));
    if (filters.to !== undefined) parts.push(lte(attendanceDays.date, filters.to));
    if (filters.employeeId !== undefined) {
      parts.push(eq(attendanceDays.employeeId, filters.employeeId));
    }
    if (filters.departmentId !== undefined) {
      parts.push(eq(employees.departmentId, filters.departmentId));
    }
    if (filters.status !== undefined) parts.push(eq(attendanceDays.status, filters.status));

    if (filters.flags.length > 0) {
      // Overlap, not containment: REQ-E-04 flags are independent, and an HR
      // user filtering on "late, early_exit" wants either, not both at once.
      parts.push(sql`${attendanceDays.flags} && ${sql.param(filters.flags)}::text[]`);
    }

    return parts.length === 0 ? undefined : and(...parts);
  }

  /**
   * The id tiebreak is not decoration: without it two rows with the same date
   * and code can come back in a different order on two requests, so one
   * appears on page one and again on page two while another never appears.
   */
  private orderBy(sort: readonly SortTerm[]): (SQL | PgColumn)[] {
    const clauses: (SQL | PgColumn)[] = [];
    for (const term of sort) {
      const column = SORT_COLUMNS[term.field as AttendanceDaySortField];
      if (column === undefined) continue;
      clauses.push(term.direction === 'desc' ? desc(column) : asc(column));
    }
    if (clauses.length === 0) {
      clauses.push(desc(attendanceDays.date), asc(employees.employeeCode));
    }
    clauses.push(asc(attendanceDays.id));
    return clauses;
  }
}
