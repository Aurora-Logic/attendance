import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';

import type { Database } from '../../../platform/db/db.provider.js';
import { locations, users } from '../../../platform/db/schema/index.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import { attendanceDays, attendancePeriodLocks } from '../schema/index.js';

/**
 * REQ-E-09. Reads and writes for `attendance_period_locks`.
 *
 * Not a `ScopedRepository`: every read joins the two actors and the location,
 * and the list has to include *unlocked* rows, which a base class that filters
 * `deleted_at IS NULL` would happily give but which reads oddly through an API
 * built around living rows. The org predicate is stated on every statement.
 *
 * Unlocking sets `unlocked_at` rather than deleting the row. REQ-E-09 requires
 * both actions be audited, and a deleted row audits badly: "who locked March,
 * who reopened it, and why" is the whole question.
 */

const lockedByUser = alias(users, 'locked_by_user');
const unlockedByUser = alias(users, 'unlocked_by_user');

export interface PeriodLockRow {
  readonly id: string;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly year: number;
  readonly month: number;
  readonly lockedAt: string;
  readonly lockedBy: { id: string; name: string | null } | null;
  readonly lockReason: string | null;
  readonly unlockedAt: string | null;
  readonly unlockedBy: { id: string; name: string | null } | null;
  readonly unlockReason: string | null;
}

/**
 * UTC ISO-8601 with a literal Z.
 *
 * Formatted by Postgres rather than handed back as a Date and stringified here,
 * for the reason `day-engine.repository.ts` gives: drizzle maps timestamps per
 * *column*, and anything that is not a plain column arrives as Postgres's own
 * text rendering, which JavaScript parses only by a non-standard extension.
 */
const INSTANT_FORMAT = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);

function instant(column: PgColumn): SQL<string | null> {
  return sql<string | null>`to_char(${column} AT TIME ZONE 'UTC', ${INSTANT_FORMAT})`;
}

export class PeriodLockRepository {
  constructor(
    private readonly db: Database,
    private readonly ctx: OrgContext,
  ) {}

  async list(filters: { year?: number | undefined; liveOnly: boolean }): Promise<PeriodLockRow[]> {
    const rows = await this.db
      .select({
        id: attendancePeriodLocks.id,
        locationId: attendancePeriodLocks.locationId,
        locationName: locations.name,
        year: attendancePeriodLocks.year,
        month: attendancePeriodLocks.month,
        lockedAt: instant(attendancePeriodLocks.lockedAt),
        lockedById: lockedByUser.id,
        lockedByEmail: lockedByUser.email,
        lockReason: attendancePeriodLocks.lockReason,
        unlockedAt: instant(attendancePeriodLocks.unlockedAt),
        unlockedById: unlockedByUser.id,
        unlockedByEmail: unlockedByUser.email,
        unlockReason: attendancePeriodLocks.unlockReason,
      })
      .from(attendancePeriodLocks)
      .leftJoin(locations, eq(locations.id, attendancePeriodLocks.locationId))
      .leftJoin(lockedByUser, eq(lockedByUser.id, attendancePeriodLocks.lockedBy))
      .leftJoin(unlockedByUser, eq(unlockedByUser.id, attendancePeriodLocks.unlockedBy))
      .where(
        and(
          eq(attendancePeriodLocks.orgId, this.ctx.orgId),
          isNull(attendancePeriodLocks.deletedAt),
          filters.year === undefined ? undefined : eq(attendancePeriodLocks.year, filters.year),
          filters.liveOnly ? isNull(attendancePeriodLocks.unlockedAt) : undefined,
        ),
      )
      .orderBy(desc(attendancePeriodLocks.year), desc(attendancePeriodLocks.month));

    return rows.map((row) => ({
      id: row.id,
      locationId: row.locationId,
      locationName: row.locationName,
      year: row.year,
      month: row.month,
      // `locked_at` is NOT NULL, so the format expression cannot be null. The
      // fallback keeps the type honest rather than asserting past it.
      lockedAt: row.lockedAt ?? '',
      lockedBy: row.lockedById === null ? null : { id: row.lockedById, name: row.lockedByEmail },
      lockReason: row.lockReason,
      unlockedAt: row.unlockedAt,
      unlockedBy:
        row.unlockedById === null ? null : { id: row.unlockedById, name: row.unlockedByEmail },
      unlockReason: row.unlockReason,
    }));
  }

  async findById(id: string): Promise<PeriodLockRow | null> {
    const all = await this.list({ liveOnly: false });
    return all.find((row) => row.id === id) ?? null;
  }

  /** The live lock covering this scope and period, if there is one. */
  async findLive(
    locationId: string | null,
    year: number,
    month: number,
  ): Promise<PeriodLockRow | null> {
    const rows = await this.list({ year, liveOnly: true });
    return rows.find((row) => row.locationId === locationId && row.month === month) ?? null;
  }

  async insert(input: {
    locationId: string | null;
    year: number;
    month: number;
    reason: string;
    at: Date;
  }): Promise<string> {
    const rows = await this.db
      .insert(attendancePeriodLocks)
      .values({
        orgId: this.ctx.orgId,
        locationId: input.locationId,
        year: input.year,
        month: input.month,
        lockedBy: this.ctx.actorUserId,
        lockedAt: input.at,
        lockReason: input.reason,
        createdAt: input.at,
        updatedAt: input.at,
        createdBy: this.ctx.actorUserId,
        updatedBy: this.ctx.actorUserId,
      })
      .returning({ id: attendancePeriodLocks.id });

    const row = rows[0];
    if (row === undefined) throw new Error('Period lock insert returned no row.');
    return row.id;
  }

  /** False means somebody else unlocked it first, which is not an error. */
  async markUnlocked(id: string, reason: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(attendancePeriodLocks)
      .set({
        unlockedAt: at,
        unlockedBy: this.ctx.actorUserId,
        unlockReason: reason,
        updatedAt: at,
        updatedBy: this.ctx.actorUserId,
      })
      .where(
        and(
          eq(attendancePeriodLocks.orgId, this.ctx.orgId),
          eq(attendancePeriodLocks.id, id),
          isNull(attendancePeriodLocks.deletedAt),
          isNull(attendancePeriodLocks.unlockedAt),
        ),
      )
      .returning({ id: attendancePeriodLocks.id });
    return rows.length > 0;
  }

  /**
   * Brings `attendance_days.locked` back into agreement with the lock table for
   * one period, in both directions.
   *
   * The column does not enforce anything — the day engine refuses on
   * `attendance_period_locks` and always did (`isPeriodLocked`, step 2), and
   * that stays the authority. This is what a muster or a report reads to render
   * a row as frozen without joining the lock table on every page.
   *
   * Derived from the lock table rather than incrementally maintained, which is
   * the difference between a hint that can be wrong and one that cannot. Lifting
   * an organisation-wide lock while a location lock still stands is exactly the
   * case an incremental "set them all to false" gets wrong, and it would get it
   * wrong quietly.
   *
   * Only rows whose value actually changes are written, so relocking a month is
   * not a rewrite of every row's `updated_at` — the same reasoning the day
   * engine applies to its own writes.
   */
  async syncDaysLocked(year: number, month: number, at: Date): Promise<number> {
    const covered = sql`EXISTS (
      SELECT 1
        FROM attendance_period_locks l
        LEFT JOIN employees e ON e.id = ${attendanceDays.employeeId}
       WHERE l.org_id = ${this.ctx.orgId}
         AND l.deleted_at IS NULL
         AND l.unlocked_at IS NULL
         AND l.year = ${year}
         AND l.month = ${month}
         AND (l.location_id IS NULL OR l.location_id = e.location_id)
    )`;

    const rows = await this.db
      .update(attendanceDays)
      .set({
        locked: sql`${covered}`,
        updatedAt: at,
        updatedBy: this.ctx.actorUserId,
      })
      .where(
        and(
          eq(attendanceDays.orgId, this.ctx.orgId),
          isNull(attendanceDays.deletedAt),
          sql`date_part('year', ${attendanceDays.date}) = ${year}`,
          sql`date_part('month', ${attendanceDays.date}) = ${month}`,
          sql`${attendanceDays.locked} IS DISTINCT FROM ${covered}`,
        ),
      )
      .returning({ id: attendanceDays.id });

    return rows.length;
  }
}
