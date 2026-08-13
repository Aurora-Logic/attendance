import { expect, it } from 'vitest';

import type { AttendanceDay } from '@/features/attendance/types';
import { PERMISSIONS, type PermissionKey } from '@vyuha/shared';

import {
  attendanceVisibility,
  emptyRangeReason,
  scheduledSpanMinutes,
  summariseRange,
  toFlagTally,
  toLateSeries,
  toStatusSlices,
  toWorkedSeries,
} from './attendance-analysis.ts';

/**
 * Unit tests for the employee analysis maths.
 *
 * Originally written with a hand-rolled runner, because `@vyuha/web` had
 * neither vitest nor a `test` script and adding one is a dependency decision
 * (CLAUDE.md §6). That decision has since been taken, so the twenty lines of
 * runner are gone and `check` now delegates to vitest.
 *
 * The call sites are deliberately untouched: every assertion below is the one
 * that was written and reviewed with the screen it tests, and rewriting 25 of
 * them into `expect` chains would have put a mechanical diff between the tests
 * and the behaviour they describe for no gain.
 */

function check(name: string, run: () => void): void {
  it(name, run);
}

/**
 * Key order is sorted before comparing, so a test does not fail because a
 * function returns the same object with its fields declared in another order.
 */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

/**
 * Compared as stably-serialised strings rather than with `toEqual`, so a
 * failure prints the whole shape on one line and key order still cannot make
 * a passing function look broken.
 */
function equal(actual: unknown, expected: unknown): void {
  expect(stable(actual)).toBe(stable(expected));
}

function day(overrides: Partial<AttendanceDay> = {}): AttendanceDay {
  return {
    employee: { id: 'e1', name: 'Varun Tiwari' },
    date: '2026-08-03',
    shiftName: 'General',
    scheduledIn: '09:00',
    scheduledOut: '18:00',
    firstIn: '09:04',
    lastOut: '18:10',
    workedMinutes: 510,
    otMinutes: 0,
    lateMinutes: 0,
    status: 'PRESENT',
    flags: [],
    ...overrides,
  };
}

function first<T>(items: T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('expected at least one element');
  return item;
}

// ------------------------------------------------------------ scheduled span

check('scheduled span reads a wall-clock roster', () => {
  equal(scheduledSpanMinutes('09:00', '18:00'), 540);
});

check('scheduled span reads the instants the running API actually sends', () => {
  // The offset cancels between the two, so the span is stable in every
  // timezone even though the clock times printed beside it are not.
  equal(scheduledSpanMinutes('2026-08-12T13:41:35.000Z', '2026-08-12T17:43:35.000Z'), 242);
});

check('scheduled span wraps a night shift rather than going negative', () => {
  equal(scheduledSpanMinutes('22:00', '06:00'), 480);
});

check('scheduled span is unknown when there is no roster', () => {
  equal(scheduledSpanMinutes(null, '18:00'), null);
  equal(scheduledSpanMinutes('09:00', null), null);
  equal(scheduledSpanMinutes(null, null), null);
});

check('scheduled span refuses nonsense rather than drawing it', () => {
  equal(scheduledSpanMinutes('09:00', '09:00'), null);
  equal(scheduledSpanMinutes('not a time', '18:00'), null);
  equal(scheduledSpanMinutes('99:99', '18:00'), null);
});

// ------------------------------------------------------------- worked series

check('worked series runs left to right though the API sorts newest first', () => {
  const series = toWorkedSeries([day({ date: '2026-08-05' }), day({ date: '2026-08-01' })]);
  equal(
    series.map((point) => point.date),
    ['2026-08-01', '2026-08-05'],
  );
});

check('overtime is carved out of worked time, not added to it', () => {
  const point = first(toWorkedSeries([day({ workedMinutes: 490, otMinutes: 30 })]));
  equal(point.regular, 460);
  equal(point.overtime, 30);
  equal(point.regular + point.overtime, 490);
});

check('overtime larger than worked time cannot make the stack taller than the day', () => {
  const point = first(toWorkedSeries([day({ workedMinutes: 60, otMinutes: 900 })]));
  equal(point.regular, 0);
  equal(point.overtime, 60);
});

check('a day with no roster carries no scheduled reference', () => {
  const point = first(toWorkedSeries([day({ scheduledIn: null, scheduledOut: null })]));
  equal(point.scheduled, null);
});

check('negative and non-finite minutes from the wire are floored at zero', () => {
  const point = first(toWorkedSeries([day({ workedMinutes: -30, otMinutes: Number.NaN })]));
  equal(point.regular, 0);
  equal(point.overtime, 0);
});

// -------------------------------------------------------------- other series

check('status slices count only the statuses present, in contract order', () => {
  equal(
    toStatusSlices([day({ status: 'ABSENT' }), day({ status: 'PRESENT' }), day({ status: 'PRESENT' })]),
    [
      { status: 'PRESENT', count: 2 },
      { status: 'ABSENT', count: 1 },
    ],
  );
});

check('status slices of an empty range are empty, not eight zeroes', () => {
  equal(toStatusSlices([]), []);
});

check('late series keeps the zero days so a spike reads as a spike', () => {
  equal(
    toLateSeries([
      day({ date: '2026-08-01', lateMinutes: 0 }),
      day({ date: '2026-08-02', lateMinutes: 25 }),
    ]),
    [
      { date: '2026-08-01', lateMinutes: 0 },
      { date: '2026-08-02', lateMinutes: 25 },
    ],
  );
});

check('flag tally is commonest first, ties alphabetical', () => {
  equal(
    toFlagTally([
      day({ flags: ['late', 'outside_geofence'] }),
      day({ flags: ['outside_geofence'] }),
      day({ flags: ['early_exit'] }),
    ]),
    [
      { flag: 'outside_geofence', count: 2 },
      { flag: 'early_exit', count: 1 },
      { flag: 'late', count: 1 },
    ],
  );
});

check('range totals count late days separately from late minutes', () => {
  equal(
    summariseRange([
      day({ workedMinutes: 480, otMinutes: 0, lateMinutes: 0 }),
      day({ workedMinutes: 520, otMinutes: 40, lateMinutes: 12 }),
      day({ workedMinutes: 500, otMinutes: 0, lateMinutes: 3 }),
    ]),
    { daysRecorded: 3, workedMinutes: 1500, overtimeMinutes: 40, lateMinutes: 15, lateDays: 2 },
  );
});

// --------------------------------------------------------------------- scope

function permissions(...keys: PermissionKey[]): ReadonlySet<PermissionKey> {
  return new Set(keys);
}

check('visibility takes the widest key held', () => {
  equal(
    attendanceVisibility(
      permissions(PERMISSIONS.ATTENDANCE_VIEW_SELF, PERMISSIONS.ATTENDANCE_VIEW_ALL),
    ),
    'all',
  );
  equal(
    attendanceVisibility(
      permissions(PERMISSIONS.ATTENDANCE_VIEW_SELF, PERMISSIONS.ATTENDANCE_VIEW_TEAM),
    ),
    'team',
  );
  equal(attendanceVisibility(permissions(PERMISSIONS.ATTENDANCE_VIEW_SELF)), 'self');
  equal(attendanceVisibility(permissions(PERMISSIONS.EMPLOYEE_VIEW)), 'none');
});

const RANGE = { from: '2026-08-01', to: '2026-08-31' } as const;
const EMPLOYED = { dateOfJoining: '2026-06-01', dateOfLeaving: null } as const;

check('no attendance key at all is never reported as an absence', () => {
  equal(
    emptyRangeReason({ visibility: 'none', isSelf: false, ...EMPLOYED, ...RANGE }),
    'no-permission',
  );
});

check('self-only breadth looking at somebody else is a certain scope answer', () => {
  equal(
    emptyRangeReason({ visibility: 'self', isSelf: false, ...EMPLOYED, ...RANGE }),
    'outside-scope',
  );
});

check('permission outranks the joining date, because it explains every range', () => {
  equal(
    emptyRangeReason({
      visibility: 'self',
      isSelf: false,
      dateOfJoining: '2026-12-01',
      dateOfLeaving: null,
      ...RANGE,
    }),
    'outside-scope',
  );
});

check('a range before the employee joined is explained by the date', () => {
  equal(
    emptyRangeReason({
      visibility: 'all',
      isSelf: false,
      dateOfJoining: '2026-09-15',
      dateOfLeaving: null,
      ...RANGE,
    }),
    'joined-after-range',
  );
});

check('joining on the last day of the range is not "joined after"', () => {
  equal(
    emptyRangeReason({
      visibility: 'all',
      isSelf: false,
      dateOfJoining: '2026-08-31',
      dateOfLeaving: null,
      ...RANGE,
    }),
    'nothing-recorded',
  );
});

check('a range after the employee left is explained by the date', () => {
  equal(
    emptyRangeReason({
      visibility: 'all',
      isSelf: false,
      dateOfJoining: '2020-01-01',
      dateOfLeaving: '2026-07-31',
      ...RANGE,
    }),
    'left-before-range',
  );
});

check('team breadth cannot resolve it and must not pretend otherwise', () => {
  equal(
    emptyRangeReason({ visibility: 'team', isSelf: false, ...EMPLOYED, ...RANGE }),
    'maybe-outside-scope',
  );
});

check('team breadth reading its own record is unambiguous', () => {
  equal(
    emptyRangeReason({ visibility: 'team', isSelf: true, ...EMPLOYED, ...RANGE }),
    'nothing-recorded',
  );
});

check('org-wide breadth means an empty range really is an empty range', () => {
  equal(
    emptyRangeReason({ visibility: 'all', isSelf: false, ...EMPLOYED, ...RANGE }),
    'nothing-recorded',
  );
});
