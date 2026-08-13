import { Injectable, Logger } from '@nestjs/common';
import { MAX_BULK_RECOMPUTE_EMPLOYEE_DAYS } from '@vyuha/shared';

import { AppError } from '../../../platform/common/errors.js';
import type { OrgContext } from '../../../platform/db/scoped-repository.js';
import { DayEngineService } from '../day-engine/day-engine.service.js';
import type { RosterRepository } from './roster.repository.js';
import { lockedPeriodError } from './roster-errors.js';
import { computedWindow, monthsInRange, type DateRange } from './roster-range.js';

/**
 * REQ-C-06: "Changing a roster for a date that already has computed attendance
 * triggers a recompute of those days, unless the period is locked (then it is
 * rejected with a clear message)."
 *
 * Two halves, and the order between them is the requirement.
 *
 * `assertRecomputable` runs *before* the write. Discovering the lock afterwards
 * would mean either leaving a roster row whose days can never be brought into
 * line with it, or unwinding a write the caller was already told had succeeded.
 * The requirement says the change is rejected, so the check has to be able to
 * reject it, which means running first.
 *
 * `recompute` runs after. It is deliberately narrow: only employee-days that
 * already carry an `attendance_days` row. A date with no row is not stale, it
 * is unwritten, and the nightly sweep produces it from whatever the roster says
 * by then.
 */

export interface RecomputePlan {
  /** The employee-days that will be rewritten. Empty is the normal future case. */
  readonly days: readonly { employeeId: string; date: string }[];
}

@Injectable()
export class RosterRecomputeService {
  private readonly logger = new Logger(RosterRecomputeService.name);

  constructor(private readonly engines: DayEngineService) {}

  /**
   * Refuses the change if it would have to touch a locked period, and reports
   * what it would rewrite otherwise.
   *
   * `today` bounds the window. An open-ended assignment has no end date, and
   * REQ-E-01 puts no attendance row past today, so the search stops there
   * rather than trying to walk to the end of an unbounded range.
   */
  async assertRecomputable(
    repository: RosterRepository,
    employeeIds: readonly string[],
    window: DateRange,
    today: string,
    options: { readonly cap?: number } = {},
  ): Promise<RecomputePlan> {
    const bounded = computedWindow(window, today);
    // Entirely in the future: nothing has been computed, so nothing is stale
    // and no lock can be in the way.
    if (bounded === null || employeeIds.length === 0) return { days: [] };

    const days = await repository.computedDaysIn(employeeIds, bounded.from, bounded.to);
    if (days.length === 0) return { days: [] };

    const locked = await repository.lockedMonthsFor(
      employeeIds,
      monthsInRange(bounded.from, bounded.to),
    );
    // Narrowed to the months that actually hold a day this change would
    // rewrite. A lock on a month the change does not reach is not this
    // change's problem, and refusing on it would make a locked January block
    // every roster edit for the rest of the year.
    const touched = new Set(days.map((day) => day.date.slice(0, 7)));
    const blocking = locked.filter((month) => touched.has(month));
    if (blocking.length > 0) throw lockedPeriodError(blocking);

    const cap = options.cap;
    if (cap !== undefined && days.length > cap) {
      throw AppError.conflict(
        `This change would recompute ${String(days.length)} employee-days, more than the ${String(cap)} a single request will do. Narrow the date range or the selection and repeat it.`,
        { employeeDays: days.length, limit: cap },
      );
    }

    return { days };
  }

  /** The cap a bulk commit is held to; a single assignment is not capped. */
  get bulkCap(): number {
    return MAX_BULK_RECOMPUTE_EMPLOYEE_DAYS;
  }

  /**
   * Rewrites the planned days and returns how many actually changed.
   *
   * A day the engine cannot compute is logged with the reason and counted, not
   * rethrown. The write it follows has already succeeded and is correct -- the
   * roster now says what the operator asked it to say -- and the only failure
   * the engine raises here is "this employee has no shift for this date", which
   * is a true statement about the configuration rather than about this request.
   * Rethrowing would report a 409 for a change that did happen, and the caller
   * would retry it into an overlap error.
   */
  async recompute(ctx: OrgContext, plan: RecomputePlan): Promise<number> {
    if (plan.days.length === 0) return 0;

    const engine = this.engines.forOrg(ctx);
    // One instant for the whole batch, so two days in the same run cannot be
    // judged against two different "now"s.
    const now = new Date();
    let written = 0;

    for (const day of plan.days) {
      try {
        const outcome = await engine.computeDay(day.employeeId, day.date, { now });
        if (outcome.outcome === 'written') written += 1;
        if (outcome.outcome === 'locked') {
          // Unreachable through `assertRecomputable`, but a lock taken between
          // the check and the write would land here. Silence would be the
          // wrong answer: the day is now out of step with its roster.
          this.logger.warn({
            msg: 'Attendance day was locked between the roster check and the recompute.',
            employeeId: day.employeeId,
            date: day.date,
          });
        }
      } catch (error: unknown) {
        this.logger.warn({
          msg: 'Roster change could not recompute this attendance day; it still shows the previous shift.',
          employeeId: day.employeeId,
          date: day.date,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return written;
  }
}
