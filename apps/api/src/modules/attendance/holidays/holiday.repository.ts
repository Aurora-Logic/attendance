import type { HolidayCalendarRecord, HolidayRecord, SortTerm } from '@vyuha/shared';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import type { Database } from '../../../platform/db/db.provider.js';
import { employees, locations } from '../../../platform/db/schema/index.js';
import { masterOrderBy, masterSearch } from '../../../platform/org/master-query.js';
import { ScopedRepository, type OrgContext } from '../../../platform/db/scoped-repository.js';
import { holidayCalendars, holidays, restrictedHolidayElections } from '../schema/index.js';
import type { ExistingHoliday } from './holiday-import.js';

/**
 * Holiday calendars, holidays and restricted elections (REQ-H-01 to REQ-H-04).
 *
 * A `ScopedRepository` over `holiday_calendars`, so every statement starts from
 * `this.scoped(...)` and carries `org_id` and `deleted_at IS NULL` before
 * anything else is added. The queries that read the other two tables build
 * their own predicate from `this.ctx.orgId` for the same reason, spelled out
 * rather than inherited, because those tables are not this repository's base.
 */

const SORT_COLUMNS = { name: holidayCalendars.name, year: holidayCalendars.year } as const;

export interface CalendarListFilters {
  readonly year?: number | undefined;
  readonly q?: string | undefined;
  readonly sort: readonly SortTerm[];
  readonly limit: number;
  readonly offset: number;
}

export interface CalendarRow {
  readonly id: string;
  readonly name: string;
  readonly year: number;
  readonly restrictedAllowance: number;
}

/** REQ-H-04's recompute target: who the change reaches, and when they were here. */
export interface AffectedEmployee {
  readonly id: string;
  readonly dateOfJoining: string;
  readonly dateOfLeaving: string | null;
}

export interface HolidayWithCalendar extends HolidayRecord {
  readonly calendarId: string;
  readonly calendarName: string;
  readonly calendarYear: number;
  readonly restrictedAllowance: number;
}

export class HolidayRepository extends ScopedRepository<typeof holidayCalendars> {
  constructor(db: Database, ctx: OrgContext) {
    super(db, holidayCalendars, ctx);
  }

  // ------------------------------------------------------------- calendars

  async listCalendars(
    filters: CalendarListFilters,
  ): Promise<{ rows: HolidayCalendarRecord[]; total: number }> {
    const where = this.scoped(
      filters.year === undefined ? undefined : eq(holidayCalendars.year, filters.year),
      filters.q === undefined ? undefined : masterSearch(filters.q, [holidayCalendars.name]),
    );

    const rows = await this.db
      .select({
        id: holidayCalendars.id,
        name: holidayCalendars.name,
        year: holidayCalendars.year,
        restrictedAllowance: holidayCalendars.restrictedAllowance,
      })
      .from(holidayCalendars)
      .where(where)
      .orderBy(...masterOrderBy(filters.sort, SORT_COLUMNS, holidayCalendars.name, holidayCalendars.id))
      .limit(filters.limit)
      .offset(filters.offset);

    const totals = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(holidayCalendars)
      .where(where);

    return {
      rows: await this.hydrate(rows),
      total: totals[0]?.value ?? 0,
    };
  }

  async calendar(id: string): Promise<HolidayCalendarRecord | null> {
    const rows = await this.db
      .select({
        id: holidayCalendars.id,
        name: holidayCalendars.name,
        year: holidayCalendars.year,
        restrictedAllowance: holidayCalendars.restrictedAllowance,
      })
      .from(holidayCalendars)
      .where(this.scoped(eq(holidayCalendars.id, id)))
      .limit(1);

    const hydrated = await this.hydrate(rows);
    return hydrated[0] ?? null;
  }

  async calendarRow(id: string): Promise<CalendarRow | null> {
    const rows = await this.db
      .select({
        id: holidayCalendars.id,
        name: holidayCalendars.name,
        year: holidayCalendars.year,
        restrictedAllowance: holidayCalendars.restrictedAllowance,
      })
      .from(holidayCalendars)
      .where(this.scoped(eq(holidayCalendars.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** The (org, name, year) unique index, asked before the insert so the answer is a 409. */
  async findCalendarIdByNameYear(
    name: string,
    year: number,
    excludeId?: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ id: holidayCalendars.id })
      .from(holidayCalendars)
      .where(
        this.scoped(
          eq(holidayCalendars.name, name),
          eq(holidayCalendars.year, year),
          excludeId === undefined ? undefined : ne(holidayCalendars.id, excludeId),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  // -------------------------------------------------------------- holidays

  async holidaysIn(calendarId: string): Promise<ExistingHoliday[]> {
    const rows = await this.db
      .select({
        id: holidays.id,
        date: holidays.date,
        name: holidays.name,
        restricted: holidays.isRestricted,
      })
      .from(holidays)
      .where(this.holidayScope(eq(holidays.calendarId, calendarId)))
      .orderBy(asc(holidays.date), asc(holidays.id));
    return rows;
  }

  async holiday(id: string): Promise<HolidayWithCalendar | null> {
    const rows = await this.db
      .select({
        id: holidays.id,
        date: holidays.date,
        name: holidays.name,
        restricted: holidays.isRestricted,
        calendarId: holidays.calendarId,
        calendarName: holidayCalendars.name,
        calendarYear: holidayCalendars.year,
        restrictedAllowance: holidayCalendars.restrictedAllowance,
      })
      .from(holidays)
      .innerJoin(
        holidayCalendars,
        and(
          eq(holidayCalendars.id, holidays.calendarId),
          eq(holidayCalendars.orgId, this.ctx.orgId),
          isNull(holidayCalendars.deletedAt),
        ),
      )
      .where(this.holidayScope(eq(holidays.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findHolidayIdByDate(
    calendarId: string,
    date: string,
    excludeId?: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ id: holidays.id })
      .from(holidays)
      .where(
        this.holidayScope(
          eq(holidays.calendarId, calendarId),
          eq(holidays.date, date),
          excludeId === undefined ? undefined : ne(holidays.id, excludeId),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async insertHoliday(input: {
    calendarId: string;
    date: string;
    name: string;
    restricted: boolean;
  }): Promise<string> {
    const now = new Date();
    const inserted = await this.db
      .insert(holidays)
      .values({
        orgId: this.ctx.orgId,
        calendarId: input.calendarId,
        date: input.date,
        name: input.name,
        isRestricted: input.restricted,
        createdAt: now,
        updatedAt: now,
        createdBy: this.ctx.actorUserId,
        updatedBy: this.ctx.actorUserId,
      })
      .returning({ id: holidays.id });

    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('The holidays insert returned no row.');
    return id;
  }

  async updateHoliday(
    id: string,
    values: { date?: string; name?: string; restricted?: boolean },
  ): Promise<boolean> {
    const payload: Record<string, unknown> = { updatedAt: new Date(), updatedBy: this.ctx.actorUserId };
    if (values.date !== undefined) payload.date = values.date;
    if (values.name !== undefined) payload.name = values.name;
    if (values.restricted !== undefined) payload.isRestricted = values.restricted;

    const rows = await this.db
      .update(holidays)
      .set(payload)
      .where(this.holidayScope(eq(holidays.id, id)))
      .returning({ id: holidays.id });
    return rows.length > 0;
  }

  /** REQ-M-04: soft, like everything else. The elections against it go with it. */
  async softDeleteHoliday(id: string): Promise<boolean> {
    const now = new Date();
    const rows = await this.db
      .update(holidays)
      .set({ deletedAt: now, updatedAt: now, updatedBy: this.ctx.actorUserId })
      .where(this.holidayScope(eq(holidays.id, id)))
      .returning({ id: holidays.id });

    if (rows.length === 0) return false;

    // An election pointing at a holiday nobody can see would keep consuming an
    // allowance the employee can never spend again, and the day engine's join
    // would still find it. Withdrawn with the holiday, in the same breath.
    await this.db
      .update(restrictedHolidayElections)
      .set({ deletedAt: now, updatedAt: now, updatedBy: this.ctx.actorUserId })
      .where(
        and(
          eq(restrictedHolidayElections.orgId, this.ctx.orgId),
          eq(restrictedHolidayElections.holidayId, id),
          isNull(restrictedHolidayElections.deletedAt),
        ),
      );

    return true;
  }

  // ------------------------------------------------------------- REQ-H-02

  /**
   * The calendar an employee follows: their own if set, the location's
   * otherwise. Exactly the expression `DayEngineRepository.findEmployee` uses,
   * because the pool an employee may pick from and the calendar the engine
   * reads on their behalf must be the same one or an elected day would not
   * become a holiday.
   */
  async employeeCalendarId(employeeId: string): Promise<string | null> {
    const rows = await this.db
      .select({
        calendarId: sql<
          string | null
        >`coalesce(${employees.holidayCalendarId}, ${locations.holidayCalendarId})`,
      })
      .from(employees)
      .leftJoin(locations, and(eq(locations.id, employees.locationId), isNull(locations.deletedAt)))
      .where(
        and(
          eq(employees.orgId, this.ctx.orgId),
          eq(employees.id, employeeId),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : row.calendarId;
  }

  async employeeExists(employeeId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.orgId, this.ctx.orgId),
          eq(employees.id, employeeId),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * REQ-H-04: everyone a change to this calendar reaches.
   *
   * Only ACTIVE and ON_NOTICE employees: an INACTIVE record has left, and
   * recomputing their past days on a holiday edit would rewrite history that
   * a locked period is meant to hold still. The joining and leaving dates come
   * with the row so the caller can drop the dates outside each person's
   * employment rather than asking the engine to fail on them.
   */
  async employeesOnCalendar(calendarId: string): Promise<AffectedEmployee[]> {
    const rows = await this.db
      .select({
        id: employees.id,
        dateOfJoining: employees.dateOfJoining,
        dateOfLeaving: employees.dateOfLeaving,
      })
      .from(employees)
      .leftJoin(locations, and(eq(locations.id, employees.locationId), isNull(locations.deletedAt)))
      .where(
        and(
          eq(employees.orgId, this.ctx.orgId),
          isNull(employees.deletedAt),
          inArray(employees.status, ['ACTIVE', 'ON_NOTICE']),
          sql`coalesce(${employees.holidayCalendarId}, ${locations.holidayCalendarId}) = ${calendarId}`,
        ),
      )
      .orderBy(asc(employees.id));
    return rows;
  }

  // ------------------------------------------------------------- REQ-H-03

  /** The holiday ids this employee has elected inside one calendar. */
  async electedHolidayIds(employeeId: string, calendarId: string): Promise<string[]> {
    const rows = await this.db
      .select({ holidayId: restrictedHolidayElections.holidayId })
      .from(restrictedHolidayElections)
      .innerJoin(holidays, eq(holidays.id, restrictedHolidayElections.holidayId))
      .where(
        and(
          eq(restrictedHolidayElections.orgId, this.ctx.orgId),
          eq(restrictedHolidayElections.employeeId, employeeId),
          isNull(restrictedHolidayElections.deletedAt),
          eq(holidays.calendarId, calendarId),
          isNull(holidays.deletedAt),
        ),
      );
    return rows.map((row) => row.holidayId);
  }

  async insertElection(input: {
    employeeId: string;
    holidayId: string;
    leaveYear: number;
  }): Promise<string> {
    const now = new Date();
    const inserted = await this.db
      .insert(restrictedHolidayElections)
      .values({
        orgId: this.ctx.orgId,
        employeeId: input.employeeId,
        holidayId: input.holidayId,
        leaveYear: input.leaveYear,
        createdAt: now,
        updatedAt: now,
        createdBy: this.ctx.actorUserId,
        updatedBy: this.ctx.actorUserId,
      })
      .returning({ id: restrictedHolidayElections.id });

    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('The restricted_holiday_elections insert returned no row.');
    return id;
  }

  async withdrawElection(employeeId: string, holidayId: string): Promise<boolean> {
    const now = new Date();
    const rows = await this.db
      .update(restrictedHolidayElections)
      .set({ deletedAt: now, updatedAt: now, updatedBy: this.ctx.actorUserId })
      .where(
        and(
          eq(restrictedHolidayElections.orgId, this.ctx.orgId),
          eq(restrictedHolidayElections.employeeId, employeeId),
          eq(restrictedHolidayElections.holidayId, holidayId),
          isNull(restrictedHolidayElections.deletedAt),
        ),
      )
      .returning({ id: restrictedHolidayElections.id });
    return rows.length > 0;
  }

  // ------------------------------------------------------------- internals

  /** The `scoped()` equivalent for the two tables this repository does not sit on. */
  private holidayScope(...extra: Parameters<typeof and>): ReturnType<typeof this.scoped> {
    const predicate = and(
      eq(holidays.orgId, this.ctx.orgId),
      isNull(holidays.deletedAt),
      ...extra,
    );
    if (predicate === undefined) {
      throw new Error('Scope predicate collapsed to undefined; refusing to run an unscoped query.');
    }
    return predicate;
  }

  /**
   * Fills in each calendar's holidays and the locations that inherit it, in two
   * queries for the whole page rather than two per row. A calendar list of
   * three with a per-row fetch is six round trips for a screen that opens on
   * every visit to the leave form.
   */
  private async hydrate(rows: readonly CalendarRow[]): Promise<HolidayCalendarRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const holidayRows = await this.db
      .select({
        calendarId: holidays.calendarId,
        id: holidays.id,
        date: holidays.date,
        name: holidays.name,
        restricted: holidays.isRestricted,
      })
      .from(holidays)
      .where(this.holidayScope(inArray(holidays.calendarId, ids)))
      .orderBy(asc(holidays.date), asc(holidays.id));

    const locationRows = await this.db
      .select({ calendarId: locations.holidayCalendarId, name: locations.name })
      .from(locations)
      .where(
        and(
          eq(locations.orgId, this.ctx.orgId),
          isNull(locations.deletedAt),
          inArray(locations.holidayCalendarId, ids),
        ),
      )
      .orderBy(asc(locations.name));

    const byCalendar = new Map<string, HolidayRecord[]>(ids.map((id) => [id, []]));
    for (const row of holidayRows) {
      byCalendar
        .get(row.calendarId)
        ?.push({ id: row.id, date: row.date, name: row.name, restricted: row.restricted });
    }

    const locationsByCalendar = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const row of locationRows) {
      if (row.calendarId === null) continue;
      locationsByCalendar.get(row.calendarId)?.push(row.name);
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      year: row.year,
      restrictedAllowance: row.restrictedAllowance,
      locations: locationsByCalendar.get(row.id) ?? [],
      holidays: byCalendar.get(row.id) ?? [],
    }));
  }
}
