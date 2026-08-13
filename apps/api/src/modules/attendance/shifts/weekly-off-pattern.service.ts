import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  pageSlice,
  paginated,
  type CreateWeeklyOffPatternInput,
  type Paginated,
  type UpdateWeeklyOffPatternInput,
  type WeeklyOffPatternListQuery,
  type WeeklyOffPatternSummary,
} from '@vyuha/shared';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { isUniqueViolation } from '../../../platform/db/pg-error.js';
import { orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { parseWeeklyOffConfig } from '../day-engine/weekly-off.js';
import { RosterRecomputeService, type RecomputePlan } from './roster-recompute.service.js';
import { RosterRepository } from './roster.repository.js';
import { todayIn } from './roster-range.js';
import { WeeklyOffPatternRepository } from './weekly-off-pattern.repository.js';

/**
 * Weekly-off patterns (REQ-C-03).
 *
 * The pattern master only. REQ-C-03 also says a pattern is "assignable at org,
 * location, department, or employee level; the most specific assignment wins",
 * and only two of those four levels exist to assign to today: the employee
 * column (`employees.weekly_off_pattern_id`, owned by the employee slice) and
 * the organisation default (a `settings` key the day engine reads). Location
 * and department are modelled nowhere, so this endpoint deliberately does not
 * invent storage for them -- see the note in `day-engine.repository.ts`, which
 * reached the same conclusion from the reading side.
 *
 * Editing a pattern changes which days are off for everybody who names it, so
 * the same REQ-C-06 rule a roster change follows applies here: refuse if the
 * days it would rewrite are locked, and rewrite them otherwise.
 */
@Injectable()
export class WeeklyOffPatternService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
    private readonly recompute: RosterRecomputeService,
  ) {}

  async list(
    principal: Principal,
    query: WeeklyOffPatternListQuery,
  ): Promise<Paginated<WeeklyOffPatternSummary>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).list({ q: query.q, limit, offset });
    return paginated(rows, query, total);
  }

  async findOne(principal: Principal, id: string): Promise<WeeklyOffPatternSummary> {
    const summary = await this.repository(principal).summary(id);
    if (summary === null) throw AppError.notFound('Weekly off pattern', id);
    return summary;
  }

  async create(
    principal: Principal,
    input: CreateWeeklyOffPatternInput,
  ): Promise<WeeklyOffPatternSummary> {
    const repository = this.repository(principal);

    if ((await repository.findIdByName(input.name)) !== null) {
      throw nameTakenError(input.name);
    }

    // Validated with the day engine's own reader before it is stored, not with
    // a second schema that happens to look the same. A pattern the engine
    // cannot parse is a pattern that throws for every employee who names it,
    // at 02:00, in a job -- so the moment to find out is now.
    const config = parseWeeklyOffConfig(input.config, 'the submitted pattern');

    let created: { id: string };
    try {
      created = await repository.insert({ name: input.name, config });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw nameTakenError(input.name, error);
      throw error;
    }

    const summary = await this.readBack(repository, created.id);

    this.auditContext.record({
      action: 'weekly_off_pattern.created',
      entityType: 'weekly_off_pattern',
      entityId: summary.id,
      before: null,
      after: summary,
    });

    return summary;
  }

  async update(
    principal: Principal,
    id: string,
    input: UpdateWeeklyOffPatternInput,
  ): Promise<WeeklyOffPatternSummary> {
    const ctx = orgContextOf(principal);
    const repository = this.repository(principal);
    const existing = await repository.summary(id);
    if (existing === null) throw AppError.notFound('Weekly off pattern', id);

    if (input.name !== undefined && input.name !== existing.name) {
      const clash = await repository.findIdByName(input.name);
      if (clash !== null && clash !== id) throw nameTakenError(input.name);
    }

    const changesTheRule =
      input.config !== undefined &&
      JSON.stringify(input.config) !== JSON.stringify(existing.config);

    // REQ-C-06 by analogy. A rename touches no computed day; a config change
    // changes which dates are WEEKLY_OFF for everybody on this pattern, and
    // leaving those days as they are would mean the muster and the pattern
    // that produced it disagree with no error anywhere.
    const plan = changesTheRule
      ? await this.planRecompute(ctx, repository, id)
      : { days: [] as { employeeId: string; date: string }[] };

    const values: { name?: string; config?: unknown } = {};
    if (input.name !== undefined) values.name = input.name;
    if (input.config !== undefined) {
      values.config = parseWeeklyOffConfig(input.config, id);
    }

    if (Object.keys(values).length > 0) {
      try {
        const updated = await repository.update(id, values);
        if (updated === null) throw AppError.notFound('Weekly off pattern', id);
      } catch (error: unknown) {
        if (isUniqueViolation(error) && input.name !== undefined) {
          throw nameTakenError(input.name, error);
        }
        throw error;
      }
    }

    const summary = await this.readBack(repository, id);
    const recomputed = await this.recompute.recompute(ctx, plan);

    this.auditContext.record({
      action: 'weekly_off_pattern.updated',
      entityType: 'weekly_off_pattern',
      entityId: id,
      before: existing,
      after: { ...summary, recomputedDays: recomputed },
    });

    return summary;
  }

  // ------------------------------------------------------------- internals

  /**
   * The days this pattern decides, for everybody who names it.
   *
   * The window is deliberately the current and previous month rather than all
   * of history. A pattern edit is a policy change, and policy changes are not
   * retroactive to the beginning of time; going further back would rewrite
   * closed months the moment somebody renamed a rule. The period-lock check
   * still guards what is left.
   */
  private async planRecompute(
    ctx: { orgId: string; actorUserId: string | null },
    repository: WeeklyOffPatternRepository,
    patternId: string,
  ): Promise<RecomputePlan> {
    const employeeIds = await repository.employeeIdsUsing(patternId);
    if (employeeIds.length === 0) return { days: [] };

    const today = todayIn('UTC');
    const from = `${today.slice(0, 8)}01`;
    const window = { from: previousMonthStart(from), to: today };

    return this.recompute.assertRecomputable(
      new RosterRepository(this.db, ctx),
      employeeIds,
      window,
      today,
      { cap: this.recompute.bulkCap },
    );
  }

  private repository(principal: Principal): WeeklyOffPatternRepository {
    return new WeeklyOffPatternRepository(this.db, orgContextOf(principal));
  }

  private async readBack(
    repository: WeeklyOffPatternRepository,
    id: string,
  ): Promise<WeeklyOffPatternSummary> {
    const summary = await repository.summary(id);
    if (summary === null) {
      throw new Error(`Weekly off pattern ${id} was written but could not be read back.`);
    }
    return summary;
  }
}

function previousMonthStart(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return `${String(previous.year).padStart(4, '0')}-${String(previous.month).padStart(2, '0')}-01`;
}

/**
 * `weekly_off_patterns_org_name_uq` is what actually decides, so its verdict
 * is translated rather than reaching the client as a 500. The name is the only
 * thing that identifies a pattern in the picker on the employee form.
 */
function nameTakenError(name: string, cause?: unknown): AppError {
  return new AppError(ERROR_CODES.CONFLICT, 'Another weekly off pattern already uses that name.', {
    details: { name },
    ...(cause === undefined ? {} : { cause }),
  });
}
