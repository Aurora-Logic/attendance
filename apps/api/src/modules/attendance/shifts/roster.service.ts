import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ROSTER_SORT,
  ROSTER_SORT_FIELDS,
  pageSlice,
  paginated,
  parseSort,
  type BulkRosterAssignmentInput,
  type CreateRosterAssignmentInput,
  type Paginated,
  type RosterAssignment,
  type RosterBulkPreview,
  type RosterBulkTarget,
  type RosterListQuery,
  type UpdateRosterAssignmentInput,
} from '@vyuha/shared';
import type { SQL } from 'drizzle-orm';

import { AuditContext } from '../../../platform/audit/audit-context.js';
import { AppError } from '../../../platform/common/errors.js';
import { InjectDatabase, type Database } from '../../../platform/db/db.provider.js';
import { employees } from '../../../platform/db/schema/index.js';
import { unknownReferenceError } from '../../../platform/org/master-errors.js';
import { EMPLOYEE_SCOPE_GRANTS } from '../../../platform/people/employee.service.js';
import { orgContextOf, type Principal } from '../../../platform/rbac/principal.js';
import { ScopeService } from '../../../platform/rbac/scope.service.js';
import { ShiftRepository } from './shift.repository.js';
import { RosterRecomputeService } from './roster-recompute.service.js';
import { RosterRepository } from './roster.repository.js';
import { isExclusionViolation, rosterOverlapError } from './roster-errors.js';
import { affectedWindow, inclusiveDayCount, todayIn } from './roster-range.js';

/**
 * The roster (REQ-C-04 to REQ-C-06).
 *
 * Three things this service is responsible for, in the order they have to
 * happen:
 *
 * 1. The employee is one the caller may act on. A roster row is a statement
 *    about a person, so it is scoped with the same grants the employee
 *    directory uses -- an Operations user rosters their team, not the
 *    organisation. Security section 15: never trust an id from the client.
 * 2. The range is free. Checked here so the refusal can name the assignment in
 *    the way, and enforced by `shift_assignments_no_overlap` regardless, which
 *    is what makes REQ-C-04 true under concurrency rather than only under
 *    single-threaded testing.
 * 3. REQ-C-06's recompute, with its lock check running before the write.
 */
@Injectable()
export class RosterService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly scopes: ScopeService,
    private readonly auditContext: AuditContext,
    private readonly recompute: RosterRecomputeService,
  ) {}

  async list(principal: Principal, query: RosterListQuery): Promise<Paginated<RosterAssignment>> {
    const { limit, offset } = pageSlice(query);
    const { rows, total } = await this.repository(principal).list({
      from: query.from,
      to: query.to,
      employeeId: query.employeeId,
      departmentId: query.departmentId,
      locationId: query.locationId,
      shiftId: query.shiftId,
      q: query.q,
      scope: this.scopeFor(principal),
      sort: parseSort(query.sort ?? DEFAULT_ROSTER_SORT, ROSTER_SORT_FIELDS),
      limit,
      offset,
    });
    return paginated(rows, query, total);
  }

  async findOne(principal: Principal, id: string): Promise<RosterAssignment> {
    const assignment = await this.repository(principal).assignment(id, this.scopeFor(principal));
    // Out of scope and non-existent give the same answer deliberately: a 403
    // would confirm that an id belongs to somebody, which is the fact the
    // scope exists to withhold.
    if (assignment === null) throw AppError.notFound('Roster assignment', id);
    return assignment;
  }

  async create(
    principal: Principal,
    input: CreateRosterAssignmentInput,
  ): Promise<RosterAssignment> {
    const ctx = orgContextOf(principal);
    const repository = this.repository(principal);
    const scope = this.scopeFor(principal);

    const employee = await repository.employeeInScope(input.employeeId, scope);
    if (employee === null) throw unknownReferenceError('employeeId', input.employeeId);
    await this.assertShiftExists(principal, input.shiftId);

    const to = input.to ?? null;
    await this.assertRangeFree(repository, [input.employeeId], input.from, to);

    const plan = await this.recompute.assertRecomputable(
      repository,
      [input.employeeId],
      { from: input.from, to },
      todayIn('UTC'),
    );

    const created = await this.insert(repository, {
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      effectiveFrom: input.from,
      effectiveTo: to,
    });

    const assignment = await this.readBack(repository, created.id, scope);
    const recomputed = await this.recompute.recompute(ctx, plan);

    this.auditContext.record({
      action: 'roster.assigned',
      entityType: 'shift_assignment',
      entityId: assignment.id,
      before: null,
      after: { ...assignment, recomputedDays: recomputed },
    });

    return assignment;
  }

  async update(
    principal: Principal,
    id: string,
    input: UpdateRosterAssignmentInput,
  ): Promise<RosterAssignment> {
    const ctx = orgContextOf(principal);
    const repository = this.repository(principal);
    const scope = this.scopeFor(principal);

    const existing = await repository.assignment(id, scope);
    if (existing === null) throw AppError.notFound('Roster assignment', id);

    if (input.shiftId !== undefined) await this.assertShiftExists(principal, input.shiftId);

    const from = input.from ?? existing.from;
    const to = input.to === undefined ? existing.to : input.to;
    if (to !== null && to < from) {
      throw AppError.validation('The end date must not be before the start date.', {
        fields: [{ path: 'to', message: 'is before the start date', value: to }],
      });
    }

    await this.assertRangeFree(repository, [existing.employee.id], from, to, id);

    // Both ranges, not just the new one. Narrowing an assignment uncovers days
    // at the end of the old range, and those days change shift exactly as much
    // as the ones being added -- recomputing only the new range would leave
    // them claiming a shift nothing assigns any more.
    const window = affectedWindow([
      { from: existing.from, to: existing.to },
      { from, to },
    ]);
    const plan =
      window === null
        ? { days: [] }
        : await this.recompute.assertRecomputable(
            repository,
            [existing.employee.id],
            window,
            todayIn('UTC'),
          );

    const values: { shiftId?: string; effectiveFrom?: string; effectiveTo?: string | null } = {};
    if (input.shiftId !== undefined) values.shiftId = input.shiftId;
    if (input.from !== undefined) values.effectiveFrom = input.from;
    if (input.to !== undefined) values.effectiveTo = input.to;

    if (Object.keys(values).length > 0) {
      try {
        const updated = await repository.update(id, values);
        if (updated === null) throw AppError.notFound('Roster assignment', id);
      } catch (error: unknown) {
        if (isExclusionViolation(error)) {
          throw rosterOverlapError({ employeeId: existing.employee.id, from, to }, error);
        }
        throw error;
      }
    }

    const assignment = await this.readBack(repository, id, scope);
    const recomputed = await this.recompute.recompute(ctx, plan);

    this.auditContext.record({
      action: 'roster.reassigned',
      entityType: 'shift_assignment',
      entityId: id,
      before: existing,
      after: { ...assignment, recomputedDays: recomputed },
    });

    return assignment;
  }

  /**
   * REQ-C-05: "pick a department/location + date range + shift, preview the
   * affected employee-days, confirm."
   *
   * Preview and commit are one method because they must not be able to
   * disagree. A separate preview endpoint that built the selection differently
   * would show a count the commit then does not match, and the reader has no
   * way to tell which of the two was lying.
   */
  async bulkAssign(
    principal: Principal,
    input: BulkRosterAssignmentInput,
  ): Promise<RosterBulkPreview> {
    const ctx = orgContextOf(principal);
    const repository = this.repository(principal);
    const scope = this.scopeFor(principal);

    const shift = await this.assertShiftExists(principal, input.shiftId);

    const selection = await repository.selectEmployees({
      departmentId: input.departmentId,
      locationId: input.locationId,
      employeeIds: input.employeeIds,
      scope,
    });

    const clashes = await repository.findOverlapping(
      selection.map((employee) => employee.id),
      input.from,
      input.to,
    );

    const targets: RosterBulkTarget[] = selection.map((employee) => {
      const clash = clashes.get(employee.id);
      return {
        employee: { id: employee.id, name: employee.name, employeeCode: employee.employeeCode },
        department: employee.department,
        conflict:
          clash === undefined
            ? null
            : {
                assignmentId: clash.id,
                shift: { id: clash.shiftId, name: clash.shiftName, code: clash.shiftCode },
                from: clash.from,
                to: clash.to,
              },
      };
    });

    const assignable = targets.filter((target) => target.conflict === null);
    const days = inclusiveDayCount(input.from, input.to);

    const summary = {
      shift: { id: shift.id, name: shift.name, code: shift.code },
      from: input.from,
      to: input.to,
      days,
      assignable: assignable.length,
      blocked: targets.length - assignable.length,
      employeeDays: assignable.length * days,
      targets,
    };

    if (input.preview) {
      return { ...summary, preview: true, created: 0, recomputed: 0 };
    }

    if (assignable.length === 0) {
      // Nothing to write, and a 200 saying "0 created" would read as success
      // to a caller who just confirmed a screen listing several hundred
      // people. Every one of them is already rostered for these dates.
      throw rosterOverlapError({
        from: input.from,
        to: input.to,
        blocked: summary.blocked,
      });
    }

    const employeeIds = assignable.map((target) => target.employee.id);
    const plan = await this.recompute.assertRecomputable(
      repository,
      employeeIds,
      { from: input.from, to: input.to },
      todayIn('UTC'),
      { cap: this.recompute.bulkCap },
    );

    // One statement, so the whole selection lands or none of it does. A loop
    // of inserts would leave half a department rostered when the exclusion
    // constraint refused the two hundredth row, and no way to tell which half.
    let created: { id: string }[];
    try {
      created = await repository.insertMany(
        employeeIds.map((employeeId) => ({
          employeeId,
          shiftId: input.shiftId,
          effectiveFrom: input.from,
          effectiveTo: input.to,
        })),
      );
    } catch (error: unknown) {
      if (isExclusionViolation(error)) {
        // The pre-flight read answered for the instant it ran. Somebody
        // rostering the same people at the same time is exactly the race
        // REQ-C-04's constraint exists for, and the whole batch is refused.
        throw rosterOverlapError({ from: input.from, to: input.to }, error);
      }
      throw error;
    }

    const recomputed = await this.recompute.recompute(ctx, plan);

    for (const row of created) {
      this.auditContext.record({
        action: 'roster.assigned',
        entityType: 'shift_assignment',
        entityId: row.id,
        before: null,
        after: { shiftId: input.shiftId, from: input.from, to: input.to, bulk: true },
      });
    }

    return {
      ...summary,
      preview: false,
      created: created.length,
      recomputed,
    };
  }

  // ------------------------------------------------------------- internals

  private repository(principal: Principal): RosterRepository {
    return new RosterRepository(this.db, orgContextOf(principal));
  }

  /**
   * Technical design section 10: the fragment comes from `ScopeService`, never
   * from the controller and never from here.
   *
   * The same grants the employee directory uses. A roster row names a person,
   * so "which people may this caller see" and "whose roster may this caller
   * read or write" are the same question, and answering them differently would
   * let an Operations user roster somebody they cannot otherwise see.
   */
  private scopeFor(principal: Principal): SQL {
    return this.scopes.resolve(principal, EMPLOYEE_SCOPE_GRANTS, employees.id).where;
  }

  private async assertShiftExists(
    principal: Principal,
    shiftId: string,
  ): Promise<{ id: string; name: string; code: string }> {
    const shift = await new ShiftRepository(this.db, orgContextOf(principal)).summary(shiftId);
    if (shift === null) throw unknownReferenceError('shiftId', shiftId);
    if (!shift.isActive) {
      throw AppError.validation('That shift is deactivated and cannot be rostered.', {
        fields: [{ path: 'shiftId', message: 'shift is not active', value: shiftId }],
      });
    }
    return { id: shift.id, name: shift.name, code: shift.code };
  }

  /**
   * REQ-C-04, checked before the write so the message can name the assignment
   * that is in the way. The constraint is what actually decides; see the
   * `catch` in each caller for the race this cannot close.
   */
  private async assertRangeFree(
    repository: RosterRepository,
    employeeIds: readonly string[],
    from: string,
    to: string | null,
    excludeId?: string,
  ): Promise<void> {
    const clashes = await repository.findOverlapping(employeeIds, from, to, excludeId);
    const first = [...clashes.entries()][0];
    if (first === undefined) return;

    const [employeeId, clash] = first;
    throw rosterOverlapError({
      employeeId,
      from,
      to,
      conflictingAssignmentId: clash.id,
      conflictingShift: clash.shiftCode,
      conflictingFrom: clash.from,
      conflictingTo: clash.to,
    });
  }

  private async insert(
    repository: RosterRepository,
    values: {
      employeeId: string;
      shiftId: string;
      effectiveFrom: string;
      effectiveTo: string | null;
    },
  ): Promise<{ id: string }> {
    try {
      return await repository.insert(values);
    } catch (error: unknown) {
      if (isExclusionViolation(error)) {
        throw rosterOverlapError(
          { employeeId: values.employeeId, from: values.effectiveFrom, to: values.effectiveTo },
          error,
        );
      }
      throw error;
    }
  }

  private async readBack(
    repository: RosterRepository,
    id: string,
    scope: SQL,
  ): Promise<RosterAssignment> {
    const assignment = await repository.assignment(id, scope);
    if (assignment === null) {
      throw new Error(`Roster assignment ${id} was written but could not be read back.`);
    }
    return assignment;
  }
}
