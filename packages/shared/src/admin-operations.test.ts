import { describe, expect, it } from 'vitest';

import {
  MAX_ADMIN_REASON,
  MIN_ADMIN_REASON,
  SOFT_DELETABLE_ENTITIES,
  adminReasonSchema,
  reasonBodySchema,
  softDeletableEntitySchema,
} from './org.js';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSION_MATRIX,
  createRoleSchema,
  updateRoleSchema,
} from './permissions.js';

/**
 * The pure half of the admin-operations slice: the reason floor and the role
 * write contract. Both are enforced again by the API and by Postgres, and both
 * are worth testing here because this is the definition the web client shares
 * — a dialog that lets somebody type nine characters and then eats a 400 is a
 * dialog that got its floor from somewhere else.
 */

describe('the typed reason (REQ-B-09a)', () => {
  it('refuses an absent reason', () => {
    expect(reasonBodySchema.safeParse({}).success).toBe(false);
  });

  it('refuses one character, which is what "required" alone would allow', () => {
    expect(adminReasonSchema.safeParse('x').success).toBe(false);
  });

  it('refuses whitespace padded out to look long enough', () => {
    expect(adminReasonSchema.safeParse(`  ${'x'.repeat(3)}${' '.repeat(40)}`).success).toBe(false);
  });

  it('accepts a short real sentence and hands back the trimmed text', () => {
    const parsed = adminReasonSchema.safeParse('  Duplicate row  ');
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toBe('Duplicate row');
  });

  it('holds the floor at exactly MIN_ADMIN_REASON, not one either side', () => {
    expect(adminReasonSchema.safeParse('y'.repeat(MIN_ADMIN_REASON - 1)).success).toBe(false);
    expect(adminReasonSchema.safeParse('y'.repeat(MIN_ADMIN_REASON)).success).toBe(true);
  });

  it('refuses an essay, so nobody pastes a log file into an audit row', () => {
    expect(adminReasonSchema.safeParse('y'.repeat(MAX_ADMIN_REASON + 1)).success).toBe(false);
  });
});

describe('soft-deletable entity types', () => {
  it('names every master the recycle bin can carry', () => {
    expect([...SOFT_DELETABLE_ENTITIES]).toEqual([
      'department',
      'designation',
      'location',
      'shift',
      'leaveType',
      'holidayCalendar',
      'role',
    ]);
  });

  it('refuses a type that is not registered, rather than 404ing later', () => {
    expect(softDeletableEntitySchema.safeParse('employee').success).toBe(false);
    expect(softDeletableEntitySchema.safeParse('punch').success).toBe(false);
  });
});

describe('role write contract (REQ-B-07)', () => {
  const reason = 'Operations needs the report export key';

  it('requires a reason to create a role', () => {
    expect(createRoleSchema.safeParse({ name: 'Auditor' }).success).toBe(false);
  });

  it('defaults a new role to no permissions rather than to some', () => {
    const parsed = createRoleSchema.safeParse({ name: 'Auditor', reason });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.permissions).toEqual([]);
  });

  it('refuses a permission key the code does not define', () => {
    const parsed = createRoleSchema.safeParse({
      name: 'Auditor',
      reason,
      permissions: ['attendance.view.all', 'attendance.destroy.everything'],
    });
    expect(parsed.success).toBe(false);
  });

  it('de-duplicates a repeated key so the set is a set', () => {
    const parsed = createRoleSchema.safeParse({
      name: 'Auditor',
      reason,
      permissions: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.REPORT_VIEW],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.permissions).toEqual(['audit.view', 'report.view']);
  });

  it('refuses an update that changes nothing but carries a reason', () => {
    // A reason with no change is an audit row that says somebody did something
    // when they did not.
    expect(updateRoleSchema.safeParse({ reason }).success).toBe(false);
  });

  it('accepts an empty permission array as a real change, not as absence', () => {
    const parsed = updateRoleSchema.safeParse({ reason, permissions: [] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.permissions).toEqual([]);
  });

  it('requires a reason on an update', () => {
    expect(updateRoleSchema.safeParse({ permissions: [PERMISSIONS.AUDIT_VIEW] }).success).toBe(
      false,
    );
  });
});

describe('the attendance.unlock key (REQ-E-09, P2-1)', () => {
  it('exists in the catalogue and is described', () => {
    expect(ALL_PERMISSIONS).toContain('attendance.unlock');
    expect(PERMISSION_DESCRIPTIONS['attendance.unlock']).toMatch(/unlock/iu);
  });

  it('is held by Admin and by nobody else in the seed matrix', () => {
    const holders = Object.entries(ROLE_PERMISSION_MATRIX)
      .filter(([, keys]) => keys.includes(PERMISSIONS.ATTENDANCE_UNLOCK))
      .map(([name]) => name);
    expect(holders).toEqual(['Admin']);
  });

  it('leaves attendance.lock where it was, so HR can still close a month', () => {
    expect(ROLE_PERMISSION_MATRIX.HR).toContain(PERMISSIONS.ATTENDANCE_LOCK);
    expect(ROLE_PERMISSION_MATRIX.HR).not.toContain(PERMISSIONS.ATTENDANCE_UNLOCK);
  });
});
