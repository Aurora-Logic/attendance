import { PERMISSIONS, type PermissionKey } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import {
  ApprovalSubjectRegistry,
  type ApprovalSubjectHandler,
} from './approval-subject.registry.js';

/**
 * REQ-P-04: no approval subject type may resolve to an attendance permission
 * key it did not declare.
 *
 * `10` §2 names this as a Phase 6a acceptance criterion and adds "it fails if
 * the registry is bypassed", which is the part that decides what is worth
 * asserting. A test that only checked the three handlers attendance registers
 * would pass just as happily against the hardcoded mapping this replaced --
 * that mapping was *correct* for those three. It was wrong for the fourth.
 *
 * So the subject under test is a fourth: a module that does not exist yet,
 * declaring a key attendance has never heard of. Every assertion below fails
 * against a framework that reaches for a default instead of asking.
 */

/**
 * Stand-ins for the keys `08` §2.2 adds in Phase 7 and 8.
 *
 * Cast rather than added to `PERMISSIONS`, because a permission key that no
 * role grants and no endpoint checks has no business in the catalogue until
 * the module that owns it ships -- and seeding a key early is how a permission
 * ends up granted to nobody and silently checked by something.
 */
const SALES_DISCOUNT_APPROVE = 'sales.discount.approve' as PermissionKey;
const SALES_MANAGER_OVERRIDE = 'sales.credit.override' as PermissionKey;

/** Everything attendance would have supplied as a fallback. */
const ATTENDANCE_KEYS: readonly PermissionKey[] = [
  PERMISSIONS.LEAVE_APPROVE_TEAM,
  PERMISSIONS.LEAVE_APPROVE_ALL,
  PERMISSIONS.LEAVE_APPLY_SELF,
  PERMISSIONS.REGULARIZATION_APPROVE,
];

function handler(
  subjectType: string,
  actPermissions: readonly PermissionKey[],
  overridePermissions: readonly PermissionKey[] = [],
): ApprovalSubjectHandler {
  return {
    subjectType,
    actPermissions,
    overridePermissions,
    applyDecision: () => Promise.resolve(null),
  };
}

/** Attendance as it actually registers, so the fixture is not a strawman. */
function withAttendance(registry: ApprovalSubjectRegistry): ApprovalSubjectRegistry {
  registry.register(
    handler(
      'leave_request',
      [PERMISSIONS.LEAVE_APPROVE_TEAM, PERMISSIONS.LEAVE_APPROVE_ALL],
      [PERMISSIONS.LEAVE_APPROVE_ALL],
    ),
  );
  registry.register(
    handler('regularization', [PERMISSIONS.REGULARIZATION_APPROVE], [PERMISSIONS.LEAVE_APPROVE_ALL]),
  );
  registry.register(
    handler('on_duty_request', [PERMISSIONS.REGULARIZATION_APPROVE], [PERMISSIONS.LEAVE_APPROVE_ALL]),
  );
  return registry;
}

describe('ApprovalSubjectRegistry, as the single source of deciding permissions', () => {
  it('gives a non-attendance subject only the keys it declared', () => {
    const registry = withAttendance(new ApprovalSubjectRegistry());
    registry.register(
      handler('sales_discount', [SALES_DISCOUNT_APPROVE], [SALES_MANAGER_OVERRIDE]),
    );

    const entry = registry
      .decidingPermissionsBySubjectType()
      .find((row) => row.subjectType === 'sales_discount');

    expect(entry).toBeDefined();
    expect(entry?.permissions).toEqual(
      expect.arrayContaining([SALES_DISCOUNT_APPROVE, SALES_MANAGER_OVERRIDE]),
    );

    /*
     * The assertion the old mapping fails.
     *
     * Its `CASE` sent everything that was not LEAVE to `regularization.approve`,
     * so a sales discount would have appeared here holding an attendance key --
     * meaning a salesperson could not reach their own approval, and an
     * attendance approver could.
     */
    for (const attendanceKey of ATTENDANCE_KEYS) {
      expect(entry?.permissions).not.toContain(attendanceKey);
    }
  });

  it('leaves attendance subjects exactly as their handlers declare them', () => {
    const registry = withAttendance(new ApprovalSubjectRegistry());
    const byType = new Map(
      registry.decidingPermissionsBySubjectType().map((r) => [r.subjectType, r.permissions]),
    );

    // Unchanged from the mapping this replaced -- the point of the rewiring was
    // that these three keep working, not that they change.
    expect(byType.get('leave_request')).toEqual([
      PERMISSIONS.LEAVE_APPROVE_TEAM,
      PERMISSIONS.LEAVE_APPROVE_ALL,
    ]);
    expect(byType.get('regularization')).toEqual([
      PERMISSIONS.REGULARIZATION_APPROVE,
      PERMISSIONS.LEAVE_APPROVE_ALL,
    ]);
    expect(byType.get('on_duty_request')).toEqual([
      PERMISSIONS.REGULARIZATION_APPROVE,
      PERMISSIONS.LEAVE_APPROVE_ALL,
    ]);
  });

  it('has no entry, and therefore no permission, for a subject nothing registered', () => {
    const registry = withAttendance(new ApprovalSubjectRegistry());
    const types = registry.decidingPermissionsBySubjectType().map((r) => r.subjectType);

    expect(types).not.toContain('sales_discount');
    // Fail closed: the caller builds one predicate branch per entry, so no
    // entry means the predicate matches nothing rather than falling through to
    // whichever key happened to be the default.
    expect(registry.get('sales_discount')).toBeNull();
  });

  it('escalates to the keys handlers declare, not to a fixed attendance key', () => {
    const registry = withAttendance(new ApprovalSubjectRegistry());
    expect(registry.orgWidePermissions()).toEqual([PERMISSIONS.LEAVE_APPROVE_ALL]);

    registry.register(handler('sales_discount', [SALES_DISCOUNT_APPROVE], [SALES_MANAGER_OVERRIDE]));

    // The sales key joins the ladder rather than sales escalating to whoever
    // approves leave.
    expect(registry.orgWidePermissions()).toEqual([
      PERMISSIONS.LEAVE_APPROVE_ALL,
      SALES_MANAGER_OVERRIDE,
    ]);
  });

  it('answers an empty registry with no permissions rather than a default', () => {
    const registry = new ApprovalSubjectRegistry();

    expect(registry.decidingPermissionsBySubjectType()).toEqual([]);
    // `orgWideApprovers` short-circuits on this; an empty SQL `IN ()` is a
    // syntax error, so "nobody" has to be answerable without reaching Postgres.
    expect(registry.orgWidePermissions()).toEqual([]);
  });

  it('refuses a second handler for one subject type', () => {
    const registry = withAttendance(new ApprovalSubjectRegistry());
    expect(() => {
      registry.register(handler('leave_request', [SALES_DISCOUNT_APPROVE]));
    }).toThrow(/already has a handler/);
  });
});
