import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_MASTER_SORT,
  ERROR_CODES,
  MASTER_SORT_FIELDS,
  PERMISSIONS,
  pageSlice,
  paginated,
  parseSort,
  type CreateHolidayCalendarInput,
  type CreateHolidayInput,
  type ElectRestrictedHolidayInput,
  type HolidayCalendarListQuery,
  type HolidayCalendarRecord,
  type HolidayImportInput,
  type HolidayImportReport,
  type HolidayRecord,
  type Paginated,
  type RecomputeSummary,
  type RestrictedHolidayPool,
  type RestrictedHolidayResult,
  type UpdateHolidayCalendarInput,
  type UpdateHolidayInput,
} from '@vyuha/shared';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError, describeError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { isUniqueViolation } from '../../../platform/db/pg-error.js';
import { hasPermission, orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { DayEngineService } from '../day-engine/day-engine.service.js';
import { refusalMessage, refuseElection, remainingAllowance } from './election-policy.js';
import { affectedDates, countActions, planHolidayImport } from './holiday-import.js';
import { HolidayRepository, type AffectedEmployee } from './holiday.repository.js';

/**
 * Holiday calendars, holidays and restricted elections (REQ-H-01 to REQ-H-04).
 *
 * Two things in here are worth reading before changing anything.
 *
 * **The recompute is the requirement, not a nicety.** REQ-H-04 says "Changing a
 * holiday recomputes the affected days unless locked", and an attendance day
 * that still reads ABSENT after a holiday was added is the bug that reaches
 * payroll. `recomputeDates` is therefore called from every path that moves a
 * date -- create, update, delete, import commit, and both sides of an election.
 *
 * **It runs inline.** Technical design §5 wants these on a `recompute-day` job
 * and §11 lists the queue, but neither `recompute-day` nor `recompute-range`
 * exists in `queue.registry.ts` yet. Enqueueing a job name the registry does
 * not declare is not possible without editing it, so the work happens in the
 * request and reports what it did. Moving it to the queue later is a change to
 * this one method.
 */

/** Nest resolves this once; see the note on `HolidayModule` about the instance. */
@Injectable()
export class HolidayService {
  private readonly logger = new Logger(HolidayService.name);

  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
    private readonly dayEngine: DayEngineService,
  ) {}

  // ------------------------------------------------------------- REQ-H-01

  async listCalendars(
    principal: Principal,
    query: HolidayCalendarListQuery,
  ): Promise<Paginated<HolidayCalendarRecord>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).listCalendars({
      year: query.year,
      q: query.q,
      sort: parseSort(DEFAULT_MASTER_SORT, MASTER_SORT_FIELDS),
      limit,
      offset,
    });
    return paginated(rows, query, total);
  }

  async createCalendar(
    principal: Principal,
    input: CreateHolidayCalendarInput,
  ): Promise<HolidayCalendarRecord> {
    const repository = this.repository(principal);

    if ((await repository.findCalendarIdByNameYear(input.name, input.year)) !== null) {
      throw nameTakenError(input.name, input.year);
    }

    const created = await this.insertCalendar(repository, input);
    const calendar = await readBackCalendar(repository, created.id);

    this.auditContext.record({
      action: 'holiday.calendar.created',
      entityType: 'holiday_calendar',
      entityId: calendar.id,
      before: null,
      after: calendarAuditView(calendar),
    });

    return calendar;
  }

  async updateCalendar(
    principal: Principal,
    id: string,
    input: UpdateHolidayCalendarInput,
  ): Promise<HolidayCalendarRecord> {
    const repository = this.repository(principal);
    const existing = await repository.calendar(id);
    if (existing === null) throw AppError.notFound('Holiday calendar', id);

    if (input.name !== undefined && input.name !== existing.name) {
      const clash = await repository.findCalendarIdByNameYear(input.name, existing.year, id);
      if (clash !== null) throw nameTakenError(input.name, existing.year);
    }

    const updated = await repository.update(id, input);
    if (updated === null) throw AppError.notFound('Holiday calendar', id);

    const calendar = await readBackCalendar(repository, id);

    this.auditContext.record({
      action: 'holiday.calendar.updated',
      entityType: 'holiday_calendar',
      entityId: id,
      before: calendarAuditView(existing),
      after: calendarAuditView(calendar),
    });

    return calendar;
  }

  // ------------------------------------------------------------- REQ-H-04

  async addHoliday(
    principal: Principal,
    calendarId: string,
    input: CreateHolidayInput,
  ): Promise<HolidayRecord> {
    const repository = this.repository(principal);
    const calendar = await repository.calendarRow(calendarId);
    if (calendar === null) throw AppError.notFound('Holiday calendar', calendarId);
    assertInYear(input.date, calendar.year);

    if ((await repository.findHolidayIdByDate(calendarId, input.date)) !== null) {
      throw dateTakenError(input.date);
    }

    const id = await this.insertHoliday(repository, {
      calendarId,
      date: input.date,
      name: input.name,
      restricted: input.restricted,
    });
    const holiday: HolidayRecord = {
      id,
      date: input.date,
      name: input.name,
      restricted: input.restricted,
    };

    const recompute = await this.recomputeDates(principal, calendarId, [input.date]);

    this.auditContext.record({
      action: 'holiday.created',
      entityType: 'holiday',
      entityId: id,
      before: null,
      after: { ...holiday, calendarId, recompute },
    });

    return holiday;
  }

  async updateHoliday(
    principal: Principal,
    id: string,
    input: UpdateHolidayInput,
  ): Promise<HolidayRecord> {
    const repository = this.repository(principal);
    const existing = await repository.holiday(id);
    if (existing === null) throw AppError.notFound('Holiday', id);

    const date = input.date ?? existing.date;
    if (input.date !== undefined && input.date !== existing.date) {
      assertInYear(input.date, existing.calendarYear);
      if ((await repository.findHolidayIdByDate(existing.calendarId, input.date, id)) !== null) {
        throw dateTakenError(input.date);
      }
    }

    const written = await this.applyHolidayUpdate(repository, id, input);
    if (!written) throw AppError.notFound('Holiday', id);

    const holiday: HolidayRecord = {
      id,
      date,
      name: input.name ?? existing.name,
      restricted: input.restricted ?? existing.restricted,
    };

    // Both dates. Moving Diwali from the 8th to the 9th leaves the 8th a
    // working day again, and recomputing only the new date would leave the old
    // one standing as a holiday nobody can find in any calendar.
    const dates = existing.date === date ? [date] : [existing.date, date];
    const recompute = await this.recomputeDates(principal, existing.calendarId, dates);

    this.auditContext.record({
      action: 'holiday.updated',
      entityType: 'holiday',
      entityId: id,
      before: { id, date: existing.date, name: existing.name, restricted: existing.restricted },
      after: { ...holiday, recompute },
    });

    return holiday;
  }

  async removeHoliday(principal: Principal, id: string): Promise<void> {
    const repository = this.repository(principal);
    const existing = await repository.holiday(id);
    if (existing === null) throw AppError.notFound('Holiday', id);

    const removed = await repository.softDeleteHoliday(id);
    if (!removed) throw AppError.notFound('Holiday', id);

    const recompute = await this.recomputeDates(principal, existing.calendarId, [existing.date]);

    this.auditContext.record({
      action: 'holiday.deleted',
      entityType: 'holiday',
      entityId: id,
      before: { id, date: existing.date, name: existing.name, restricted: existing.restricted },
      after: { deleted: true, recompute },
    });
  }

  /** REQ-H-04, the preview half. Reads only; writes nothing, ever. */
  async validateImport(
    principal: Principal,
    calendarId: string,
    input: HolidayImportInput,
  ): Promise<HolidayImportReport> {
    const repository = this.repository(principal);
    const calendar = await repository.calendarRow(calendarId);
    if (calendar === null) throw AppError.notFound('Holiday calendar', calendarId);

    const plan = planHolidayImport({
      rows: input.rows,
      existing: await repository.holidaysIn(calendarId),
      year: calendar.year,
      overwriteExisting: input.overwriteExisting,
    });

    return {
      calendarId,
      year: calendar.year,
      dryRun: true,
      rows: plan.rows.map(stripPlanInternals),
      counts: plan.counts,
    };
  }

  async commitImport(
    principal: Principal,
    calendarId: string,
    input: HolidayImportInput,
  ): Promise<HolidayImportReport> {
    const repository = this.repository(principal);
    const calendar = await repository.calendarRow(calendarId);
    if (calendar === null) throw AppError.notFound('Holiday calendar', calendarId);

    const plan = planHolidayImport({
      rows: input.rows,
      existing: await repository.holidaysIn(calendarId),
      year: calendar.year,
      overwriteExisting: input.overwriteExisting,
    });

    // A sheet with a bad row is refused whole. Half-importing a year's holidays
    // and reporting which half is a state nobody can act on: the reader cannot
    // tell a corrected re-run from a duplicate, and the calendar in between is
    // wrong in a way the screen shows as complete.
    if (plan.counts.ERROR > 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `${String(plan.counts.ERROR)} of ${String(plan.rows.length)} rows cannot be imported. Nothing was written.`,
        { details: { rows: plan.rows.filter((row) => row.action === 'ERROR') } },
      );
    }

    for (const row of plan.rows) {
      if (row.action === 'CREATE') {
        await this.insertHoliday(repository, {
          calendarId,
          date: row.date,
          name: row.name,
          restricted: row.restricted,
        });
      } else if (row.action === 'UPDATE' && row.existingId !== undefined) {
        await this.applyHolidayUpdate(repository, row.existingId, {
          name: row.name,
          restricted: row.restricted,
        });
      }
    }

    const recompute = await this.recomputeDates(principal, calendarId, affectedDates(plan));
    const rows = plan.rows.map(stripPlanInternals);

    this.auditContext.record({
      action: 'holiday.imported',
      entityType: 'holiday_calendar',
      entityId: calendarId,
      before: null,
      after: { counts: countActions(rows), overwriteExisting: input.overwriteExisting, recompute },
    });

    return { calendarId, year: calendar.year, dryRun: false, rows, counts: plan.counts, recompute };
  }

  // ------------------------------------------------------------- REQ-H-03

  async restrictedPool(
    principal: Principal,
    query: { year?: number | undefined; employeeId?: string | undefined },
  ): Promise<RestrictedHolidayPool> {
    const repository = this.repository(principal);
    const employeeId = this.resolveEmployee(principal, query.employeeId);
    if (!(await repository.employeeExists(employeeId))) {
      throw AppError.notFound('Employee', employeeId);
    }
    return this.readPool(repository, employeeId, query.year);
  }

  async elect(
    principal: Principal,
    input: ElectRestrictedHolidayInput,
  ): Promise<RestrictedHolidayResult> {
    const repository = this.repository(principal);
    const employeeId = this.resolveEmployee(principal, input.employeeId);

    const holiday = await repository.holiday(input.holidayId);
    if (holiday === null) throw AppError.notFound('Holiday', input.holidayId);

    const calendarId = await repository.employeeCalendarId(employeeId);
    const elected = await repository.electedHolidayIds(employeeId, holiday.calendarId);

    const context = {
      restricted: holiday.restricted,
      employeeCalendarId: calendarId,
      holidayCalendarId: holiday.calendarId,
      allowance: holiday.restrictedAllowance,
      used: elected.length,
      alreadyElected: elected.includes(holiday.id),
    };
    const refusal = refuseElection(context);
    if (refusal !== null) {
      throw new AppError(
        // A refusal here is always a statement about the state the request met
        // -- the day is not restricted, the allowance is spent -- rather than
        // about the shape of the request, which is why none of them is a 400.
        ERROR_CODES.CONFLICT,
        refusalMessage(refusal, context),
        { details: { reason: refusal, holidayId: holiday.id, employeeId } },
      );
    }

    const electionId = await this.insertElection(repository, {
      employeeId,
      holidayId: holiday.id,
      // The calendar's own year. A calendar covers one year and the pool is one
      // calendar, so the year the allowance is counted over is already decided
      // by the row; deriving a leave year from a start-month setting would make
      // the same pool count differently for two employees.
      leaveYear: holiday.calendarYear,
    });

    const recompute = await this.recomputeDates(principal, holiday.calendarId, [holiday.date], {
      only: employeeId,
    });

    this.auditContext.record({
      action: 'holiday.election.created',
      entityType: 'restricted_holiday_election',
      entityId: electionId,
      before: null,
      after: { employeeId, holidayId: holiday.id, date: holiday.date, recompute },
    });

    return { pool: await this.readPool(repository, employeeId, holiday.calendarYear), recompute };
  }

  async withdraw(
    principal: Principal,
    holidayId: string,
    requestedEmployeeId?: string,
  ): Promise<RestrictedHolidayResult> {
    const repository = this.repository(principal);
    const employeeId = this.resolveEmployee(principal, requestedEmployeeId);

    const holiday = await repository.holiday(holidayId);
    if (holiday === null) throw AppError.notFound('Holiday', holidayId);

    const withdrawn = await repository.withdrawElection(employeeId, holidayId);
    if (!withdrawn) {
      throw AppError.notFound('Restricted holiday election', holidayId);
    }

    const recompute = await this.recomputeDates(principal, holiday.calendarId, [holiday.date], {
      only: employeeId,
    });

    this.auditContext.record({
      action: 'holiday.election.withdrawn',
      entityType: 'restricted_holiday_election',
      entityId: holidayId,
      before: { employeeId, holidayId, date: holiday.date },
      after: { withdrawn: true, recompute },
    });

    return { pool: await this.readPool(repository, employeeId, holiday.calendarYear), recompute };
  }

  // ------------------------------------------------------------- internals

  private repository(principal: Principal): HolidayRepository {
    return new HolidayRepository(this.db, orgContextOf(principal));
  }

  /**
   * Whose record this call acts on.
   *
   * REQ-H-03 says the *employee* chooses, and a plain Employee holds none of
   * the management keys, so acting on your own record needs no permission
   * beyond being signed in. Naming somebody else is the privileged act, and it
   * is checked here rather than at the route: the guard cannot see which
   * employee the body asked for.
   */
  private resolveEmployee(principal: Principal, requested?: string): string {
    const own = principal.employeeId;
    if (requested === undefined || requested === own) {
      if (own === null) {
        throw AppError.validation(
          'This account has no employee record, so it has no restricted holidays of its own. Name an employee.',
          { fields: [{ path: 'employeeId', message: 'required for this account' }] },
        );
      }
      return own;
    }
    if (!hasPermission(principal, PERMISSIONS.HOLIDAY_MANAGE)) {
      throw AppError.forbidden("You may only change your own restricted holidays.");
    }
    return requested;
  }

  private async readPool(
    repository: HolidayRepository,
    employeeId: string,
    year: number | undefined,
  ): Promise<RestrictedHolidayPool> {
    const calendarId = await repository.employeeCalendarId(employeeId);
    const calendar = calendarId === null ? null : await repository.calendarRow(calendarId);

    // No calendar, or one filed under a different year than the caller asked
    // about: an empty pool rather than a guess. REQ-H-02 attaches an employee
    // to one calendar and nothing says how that maps onto another year.
    if (calendar === null || (year !== undefined && calendar.year !== year)) {
      return {
        employeeId,
        calendarId: null,
        year: year ?? calendar?.year ?? new Date().getUTCFullYear(),
        allowance: 0,
        used: 0,
        remaining: 0,
        options: [],
      };
    }

    const [all, elected] = await Promise.all([
      repository.holidaysIn(calendar.id),
      repository.electedHolidayIds(employeeId, calendar.id),
    ]);
    const electedIds = new Set(elected);
    const options = all
      .filter((holiday) => holiday.restricted)
      .map((holiday) => ({
        id: holiday.id,
        date: holiday.date,
        name: holiday.name,
        restricted: true,
        elected: electedIds.has(holiday.id),
      }));

    return {
      employeeId,
      calendarId: calendar.id,
      year: calendar.year,
      allowance: calendar.restrictedAllowance,
      used: electedIds.size,
      remaining: remainingAllowance(calendar.restrictedAllowance, electedIds.size),
      options,
    };
  }

  /**
   * REQ-H-04: "Changing a holiday recomputes the affected days unless locked."
   *
   * The engine itself decides the lock (REQ-E-09) and answers `locked` without
   * writing, so this method never has to know about periods. What it does have
   * to do is survive one employee's misconfiguration: `computeDay` refuses a
   * date the employee has no shift for, and a holiday must not fail to save
   * because somebody's roster has a gap. Those are counted and logged with the
   * cause -- handled, not swallowed -- and reported back in the summary.
   */
  private async recomputeDates(
    principal: Principal,
    calendarId: string,
    dates: readonly string[],
    options: { only?: string } = {},
  ): Promise<RecomputeSummary> {
    if (dates.length === 0) return { considered: 0, recomputed: 0, locked: 0, failed: 0 };

    const ctx = orgContextOf(principal);
    const repository = new HolidayRepository(this.db, ctx);
    const all = await repository.employeesOnCalendar(calendarId);
    const affected =
      options.only === undefined ? all : all.filter((employee) => employee.id === options.only);

    const engine = this.dayEngine.forOrg(ctx);
    const summary = { considered: 0, recomputed: 0, locked: 0, failed: 0 };

    for (const employee of affected) {
      for (const date of dates) {
        if (!employedOn(employee, date)) continue;
        summary.considered += 1;
        try {
          const outcome = await engine.computeDay(employee.id, date);
          if (outcome.outcome === 'locked') summary.locked += 1;
          else summary.recomputed += 1;
        } catch (error: unknown) {
          summary.failed += 1;
          this.logger.warn(
            `Holiday change on ${date} could not recompute employee ${employee.id}: ${describeError(error)}`,
          );
        }
      }
    }

    return summary;
  }

  private async insertCalendar(
    repository: HolidayRepository,
    input: CreateHolidayCalendarInput,
  ): Promise<{ id: string }> {
    try {
      const row = await repository.insert({
        name: input.name,
        year: input.year,
        restrictedAllowance: input.restrictedAllowance,
      });
      return { id: row.id };
    } catch (error: unknown) {
      // The unique index is the authority; the pre-check above only makes the
      // usual case a clean 409 rather than a driver error.
      if (isUniqueViolation(error)) throw nameTakenError(input.name, input.year, error);
      throw error;
    }
  }

  private async insertHoliday(
    repository: HolidayRepository,
    input: { calendarId: string; date: string; name: string; restricted: boolean },
  ): Promise<string> {
    try {
      return await repository.insertHoliday(input);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw dateTakenError(input.date, error);
      throw error;
    }
  }

  private async applyHolidayUpdate(
    repository: HolidayRepository,
    id: string,
    values: { date?: string; name?: string; restricted?: boolean },
  ): Promise<boolean> {
    try {
      return await repository.updateHoliday(id, values);
    } catch (error: unknown) {
      if (isUniqueViolation(error) && values.date !== undefined) {
        throw dateTakenError(values.date, error);
      }
      throw error;
    }
  }

  private async insertElection(
    repository: HolidayRepository,
    input: { employeeId: string; holidayId: string; leaveYear: number },
  ): Promise<string> {
    try {
      return await repository.insertElection(input);
    } catch (error: unknown) {
      // Two clicks racing each other land here rather than on the read above.
      if (isUniqueViolation(error)) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'This employee has already taken that restricted holiday.',
          { details: { reason: 'ALREADY_ELECTED', holidayId: input.holidayId }, cause: error },
        );
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------- helpers

function employedOn(employee: AffectedEmployee, date: string): boolean {
  if (date < employee.dateOfJoining) return false;
  return employee.dateOfLeaving === null || date <= employee.dateOfLeaving;
}

function assertInYear(date: string, year: number): void {
  if (Number(date.slice(0, 4)) === year) return;
  throw AppError.validation(`This calendar is for ${String(year)}; ${date} is not.`, {
    fields: [{ path: 'date', message: `must fall in ${String(year)}`, value: date }],
  });
}

function nameTakenError(name: string, year: number, cause?: unknown): AppError {
  return new AppError(
    ERROR_CODES.CONFLICT,
    `Another holiday calendar for ${String(year)} already uses that name.`,
    { details: { name, year }, ...(cause === undefined ? {} : { cause }) },
  );
}

function dateTakenError(date: string, cause?: unknown): AppError {
  return new AppError(ERROR_CODES.CONFLICT, 'That date is already in this calendar.', {
    details: { date },
    ...(cause === undefined ? {} : { cause }),
  });
}

async function readBackCalendar(
  repository: HolidayRepository,
  id: string,
): Promise<HolidayCalendarRecord> {
  const calendar = await repository.calendar(id);
  if (calendar === null) {
    throw new Error(`Holiday calendar ${id} was written but could not be read back.`);
  }
  return calendar;
}

/** The audit trail wants the row, not the list of dates hanging off it. */
function calendarAuditView(calendar: HolidayCalendarRecord): Record<string, unknown> {
  return {
    id: calendar.id,
    name: calendar.name,
    year: calendar.year,
    restrictedAllowance: calendar.restrictedAllowance,
    holidayCount: calendar.holidays.length,
  };
}

/** `existingId` is how the plan talks to the writer; it is not part of the report. */
function stripPlanInternals<T extends { existingId?: string }>(row: T): Omit<T, 'existingId'> {
  const { existingId: _ignored, ...rest } = row;
  return rest;
}
