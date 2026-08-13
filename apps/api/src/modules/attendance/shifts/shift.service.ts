import { Injectable } from '@nestjs/common';
import {
  DEFAULT_SHIFT_SORT,
  SHIFT_POLICY_DEFAULTS,
  SHIFT_SORT_FIELDS,
  pageSlice,
  paginated,
  parseSort,
  type CreateShiftInput,
  type Paginated,
  type ShiftListQuery,
  type ShiftPolicy,
  type ShiftSummary,
  type UpdateShiftInput,
} from '@vyuha/shared';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { isUniqueViolation } from '../../../platform/db/pg-error.js';
import type { UpdateInput } from '../../../platform/db/scoped-repository.js';
import { codeTakenError } from '../../../platform/org/master-errors.js';
import { orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { shifts } from '../schema/index.js';
import { ShiftRepository, toSqlTime } from './shift.repository.js';

/**
 * Shift masters (REQ-C-01).
 *
 * Not scoped by team, for the same reason `DepartmentService` is not: PRD
 * section 2's data scope is a statement about which *people* a caller may see,
 * and a shift is a policy the whole organisation shares. The organisation
 * boundary still applies, through `ScopedRepository`.
 *
 * Nothing here deletes. A shift is referenced by `attendance_days.shift_id`
 * and by every roster row that ever used it, so retiring one is
 * `isActive: false` -- which the list hides by default and the day engine
 * ignores, while the history that points at it stays readable (REQ-M-04).
 */
@Injectable()
export class ShiftService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly auditContext: AuditContext,
  ) {}

  async list(principal: Principal, query: ShiftListQuery): Promise<Paginated<ShiftSummary>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).list({
      q: query.q,
      includeInactive: query.includeInactive,
      sort: parseSort(query.sort ?? DEFAULT_SHIFT_SORT, SHIFT_SORT_FIELDS),
      limit,
      offset,
    });
    return paginated(rows, query, total);
  }

  async findOne(principal: Principal, id: string): Promise<ShiftSummary> {
    const summary = await this.repository(principal).summary(id);
    if (summary === null) throw AppError.notFound('Shift', id);
    return summary;
  }

  async create(principal: Principal, input: CreateShiftInput): Promise<ShiftSummary> {
    const repository = this.repository(principal);

    if ((await repository.findIdByCode(input.code)) !== null) {
      throw codeTakenError('shift', input.code);
    }

    // REQ-C-01 states a default for all nine policy fields, so a create that
    // names none of them gets the printed defaults rather than nine zeroes --
    // which would make every shift instantly Late and never Present.
    const policy: ShiftPolicy = { ...SHIFT_POLICY_DEFAULTS, ...input.policy };

    let created: { id: string };
    try {
      created = await repository.insert({
        name: input.name,
        code: input.code,
        startTime: toSqlTime(input.scheduledIn),
        endTime: toSqlTime(input.scheduledOut),
        breakMinutes: input.breakMinutes,
        crossesMidnight: input.crossesMidnight,
        isActive: input.isActive,
        ...policy,
      });
    } catch (error: unknown) {
      // The pre-flight check answers for the instant it ran; two requests can
      // both be told the code is free. The unique index is what actually
      // decides, so its verdict is translated rather than reaching the client
      // as a 500.
      if (isUniqueViolation(error)) throw codeTakenError('shift', input.code, error);
      throw error;
    }

    const summary = await this.readBack(repository, created.id);

    this.auditContext.record({
      action: 'shift.created',
      entityType: 'shift',
      entityId: summary.id,
      before: null,
      after: summary,
    });

    return summary;
  }

  async update(
    principal: Principal,
    id: string,
    input: UpdateShiftInput,
  ): Promise<ShiftSummary> {
    const repository = this.repository(principal);
    const existing = await repository.summary(id);
    if (existing === null) throw AppError.notFound('Shift', id);

    if (input.code !== undefined && input.code !== existing.code) {
      const clash = await repository.findIdByCode(input.code);
      if (clash !== null && clash !== id) throw codeTakenError('shift', input.code);
    }

    // The body's own schema can only check the fields the body carried. A
    // PATCH that moves `scheduledOut` alone, or that clears `crossesMidnight`
    // alone, is only decidable against the row it is being applied to -- and
    // getting it wrong produces a zero-length window that marks everybody
    // absent. Postgres refuses the same thing (`shifts_schedule_ordered`);
    // this exists so the answer names the field instead of the constraint.
    const merged = { ...existing, ...input, policy: { ...existing.policy, ...input.policy } };
    if (!merged.crossesMidnight && merged.scheduledOut <= merged.scheduledIn) {
      throw AppError.validation(
        'A shift must end after it starts, unless it is marked as crossing midnight.',
        {
          fields: [
            {
              path: 'scheduledOut',
              message: 'is at or before scheduled in; tick "crosses midnight" for a night shift',
              value: merged.scheduledOut,
            },
          ],
        },
      );
    }
    if (merged.policy.minHalfDayMinutes > merged.policy.minFullDayMinutes) {
      throw AppError.validation(
        'The minimum half day must not be greater than the minimum full day, or Half day can never be reached.',
        {
          fields: [
            {
              path: 'policy.minHalfDayMinutes',
              message: 'must not exceed the minimum full day',
              value: merged.policy.minHalfDayMinutes,
            },
          ],
        },
      );
    }

    const updated = await this.applyUpdate(repository, id, input);
    if (updated === null) throw AppError.notFound('Shift', id);

    const summary = await this.readBack(repository, id);

    this.auditContext.record({
      action: 'shift.updated',
      entityType: 'shift',
      entityId: id,
      before: existing,
      after: summary,
    });

    return summary;
  }

  // ------------------------------------------------------------- internals

  private repository(principal: Principal): ShiftRepository {
    return new ShiftRepository(this.db, orgContextOf(principal));
  }

  private async applyUpdate(
    repository: ShiftRepository,
    id: string,
    input: UpdateShiftInput,
  ): Promise<{ id: string } | null> {
    // Built field by field rather than spread. The column names differ from
    // the contract's on three of them, and `exactOptionalPropertyTypes` makes
    // an explicit `undefined` a different thing from an absent key -- letting
    // one through would put `NULL` in the SET clause for a column the caller
    // never mentioned.
    const values: UpdateInput<typeof shifts> = {};
    const policy = input.policy ?? {};

    if (input.name !== undefined) values.name = input.name;
    if (input.code !== undefined) values.code = input.code;
    if (input.scheduledIn !== undefined) values.startTime = toSqlTime(input.scheduledIn);
    if (input.scheduledOut !== undefined) values.endTime = toSqlTime(input.scheduledOut);
    if (input.breakMinutes !== undefined) values.breakMinutes = input.breakMinutes;
    if (input.crossesMidnight !== undefined) values.crossesMidnight = input.crossesMidnight;
    if (input.isActive !== undefined) values.isActive = input.isActive;

    if (policy.graceInBefore !== undefined) values.graceInBefore = policy.graceInBefore;
    if (policy.graceInAfter !== undefined) values.graceInAfter = policy.graceInAfter;
    if (policy.lateAfter !== undefined) values.lateAfter = policy.lateAfter;
    if (policy.graceOutBefore !== undefined) values.graceOutBefore = policy.graceOutBefore;
    if (policy.graceOutAfter !== undefined) values.graceOutAfter = policy.graceOutAfter;
    if (policy.earlyExitBefore !== undefined) values.earlyExitBefore = policy.earlyExitBefore;
    if (policy.minHalfDayMinutes !== undefined) {
      values.minHalfDayMinutes = policy.minHalfDayMinutes;
    }
    if (policy.minFullDayMinutes !== undefined) {
      values.minFullDayMinutes = policy.minFullDayMinutes;
    }
    if (policy.otAfterMinutes !== undefined) values.otAfterMinutes = policy.otAfterMinutes;

    if (Object.keys(values).length === 0) {
      // An empty PATCH is not an error; it is a no-op that must still confirm
      // the row exists, which the caller has already done.
      return { id };
    }

    try {
      return await repository.update(id, values);
    } catch (error: unknown) {
      if (isUniqueViolation(error) && input.code !== undefined) {
        throw codeTakenError('shift', input.code, error);
      }
      throw error;
    }
  }

  private async readBack(repository: ShiftRepository, id: string): Promise<ShiftSummary> {
    const summary = await repository.summary(id);
    if (summary === null) {
      throw new Error(`Shift ${id} was written but could not be read back.`);
    }
    return summary;
  }
}
