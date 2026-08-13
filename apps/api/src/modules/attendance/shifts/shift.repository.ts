import type { ShiftSummary, SortTerm } from '@vyuha/shared';
import { eq, sql } from 'drizzle-orm';

import type { Database } from '../../../platform/db/db.provider.js';
import { ScopedRepository, type OrgContext } from '../../../platform/db/scoped-repository.js';
import { masterOrderBy, masterSearch } from '../../../platform/org/master-query.js';
import { shifts } from '../schema/index.js';

/**
 * Shift masters (REQ-C-01).
 *
 * A `ScopedRepository` subclass like every other master, so `org_id` and
 * `deleted_at IS NULL` are on every statement before anything else is added.
 * The list and search helpers come from `platform/org/master-query.ts` rather
 * than being rewritten: a fourth copy of the ILIKE escaping is a fourth chance
 * to forget it, and a search for `%` that silently matches everything reads as
 * working software.
 */

const SORT_COLUMNS = {
  name: shifts.name,
  code: shifts.code,
  scheduledIn: shifts.startTime,
} as const;

export interface ShiftListFilters {
  readonly q?: string | undefined;
  readonly includeInactive: boolean;
  readonly sort: readonly SortTerm[];
  readonly limit: number;
  readonly offset: number;
}

interface ShiftRow {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  crossesMidnight: boolean;
  isActive: boolean;
  graceInBefore: number;
  graceInAfter: number;
  lateAfter: number;
  graceOutBefore: number;
  graceOutAfter: number;
  earlyExitBefore: number;
  minHalfDayMinutes: number;
  minFullDayMinutes: number;
  otAfterMinutes: number;
}

/**
 * `time` columns come back as `HH:mm:ss`; the contract is `HH:mm`.
 *
 * Truncating rather than rounding is safe because the write side rejects
 * seconds outright (`clockField` in `packages/shared/src/shifts.ts`), so the
 * only way a non-zero second reaches this column is a hand-written INSERT --
 * and printing `09:00` for `09:00:30` is the same lie in either direction. The
 * slice, not the display, is where that is prevented.
 */
export function toClock(value: string): string {
  return value.slice(0, 5);
}

/** The inverse: `HH:mm` to the `HH:mm:ss` the column stores. */
export function toSqlTime(value: string): string {
  return `${value}:00`;
}

export function toShiftSummary(row: ShiftRow): ShiftSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    scheduledIn: toClock(row.startTime),
    scheduledOut: toClock(row.endTime),
    breakMinutes: row.breakMinutes,
    crossesMidnight: row.crossesMidnight,
    isActive: row.isActive,
    policy: {
      graceInBefore: row.graceInBefore,
      graceInAfter: row.graceInAfter,
      lateAfter: row.lateAfter,
      graceOutBefore: row.graceOutBefore,
      graceOutAfter: row.graceOutAfter,
      earlyExitBefore: row.earlyExitBefore,
      minHalfDayMinutes: row.minHalfDayMinutes,
      minFullDayMinutes: row.minFullDayMinutes,
      otAfterMinutes: row.otAfterMinutes,
    },
  };
}

const COLUMNS = {
  id: shifts.id,
  name: shifts.name,
  code: shifts.code,
  startTime: shifts.startTime,
  endTime: shifts.endTime,
  breakMinutes: shifts.breakMinutes,
  crossesMidnight: shifts.crossesMidnight,
  isActive: shifts.isActive,
  graceInBefore: shifts.graceInBefore,
  graceInAfter: shifts.graceInAfter,
  lateAfter: shifts.lateAfter,
  graceOutBefore: shifts.graceOutBefore,
  graceOutAfter: shifts.graceOutAfter,
  earlyExitBefore: shifts.earlyExitBefore,
  minHalfDayMinutes: shifts.minHalfDayMinutes,
  minFullDayMinutes: shifts.minFullDayMinutes,
  otAfterMinutes: shifts.otAfterMinutes,
} as const;

export class ShiftRepository extends ScopedRepository<typeof shifts> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, shifts, ctx);
  }

  async list(filters: ShiftListFilters): Promise<{ rows: ShiftSummary[]; total: number }> {
    const search =
      filters.q === undefined ? undefined : masterSearch(filters.q, [shifts.name, shifts.code]);
    const active = filters.includeInactive ? undefined : eq(shifts.isActive, true);
    const where = this.scoped(search, active);

    const rows = await this.db
      .select(COLUMNS)
      .from(shifts)
      .where(where)
      .orderBy(...masterOrderBy(filters.sort, SORT_COLUMNS, shifts.name, shifts.id))
      .limit(filters.limit)
      .offset(filters.offset);

    const totals = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(shifts)
      .where(where);

    return { rows: rows.map(toShiftSummary), total: totals[0]?.value ?? 0 };
  }

  /** Reads inactive shifts too: a deactivated shift is still editable (REQ-B-09a). */
  async summary(id: string): Promise<ShiftSummary | null> {
    const rows = await this.db
      .select(COLUMNS)
      .from(shifts)
      .where(this.scoped(eq(shifts.id, id)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toShiftSummary(row);
  }

  async findIdByCode(code: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: shifts.id })
      .from(shifts)
      .where(this.scoped(eq(shifts.code, code)))
      .limit(1);
    return rows[0]?.id ?? null;
  }
}
