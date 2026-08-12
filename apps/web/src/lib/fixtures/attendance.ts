import { addDays, addMinutes, differenceInCalendarDays, format, parseISO } from 'date-fns';

import type { AttendanceDay } from '@/features/attendance/types';
import type { TodayStatus } from '@/features/punch/types';
import type { RosterEntry, Shift } from '@/features/shifts/types';
import type { AttendanceStatus, DepartmentSummary, Paginated } from '@vyuha/shared';

/**
 * Sample attendance data, for development only.
 *
 * This module exists because the Phase 1 screens were built ahead of their
 * endpoints. It is loaded through a dynamic import that sits inside
 * `if (import.meta.env.DEV)` in `features/attendance/api.ts`, so Vite's
 * define-replacement turns that branch into `if (false)` and rollup drops both
 * the branch and this chunk. Nothing here can reach a production bundle, and
 * nothing here is ever served without the screen saying so.
 *
 * Two rules for anything added here:
 *
 * - It must be deterministic. A pseudo-random row that changes on every render
 *   makes the screen impossible to review and impossible to screenshot twice.
 *   `hash` below is the only source of variation.
 * - The types come from the feature contracts rather than being restated, so a
 *   change to a contract breaks this file at compile time instead of quietly
 *   producing rows the real screen cannot read.
 */

/**
 * FNV-1a. Not for security - it is here because it is short, has no state, and
 * gives the same answer for the same employee and date every time the page
 * renders, which a seeded PRNG would not without threading the seed through.
 */
function hash(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 4294967295;
}

const DEPARTMENT_NAMES = [
  'Production',
  'Quality',
  'Stores',
  'Dispatch',
  'Maintenance',
  'Accounts',
  'Administration',
];

export const sampleDepartmentList: DepartmentSummary[] = DEPARTMENT_NAMES.map((name, index) => ({
  id: `dep-${String(index + 1)}`,
  name,
  code: name.slice(0, 3).toUpperCase(),
  parent: null,
  head: null,
}));

const FIRST_NAMES = [
  'Aarav',
  'Priya',
  'Rohan',
  'Meera',
  'Vikram',
  'Ananya',
  'Karthik',
  'Divya',
  'Suresh',
  'Nisha',
  'Imran',
  'Lakshmi',
  'Farhan',
  'Sneha',
  'Rajesh',
  'Kavita',
  'Arjun',
  'Deepa',
  'Manoj',
  'Ritu',
  'Tarun',
];

const LAST_NAMES = [
  'Nair',
  'Kulkarni',
  'Dsouza',
  'Menon',
  'Sharma',
  'Iyer',
  'Patel',
  'Rao',
  'Banerjee',
  'Khan',
];

interface SampleEmployee {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string;
  departmentName: string;
  shiftIndex: number;
}

/** 63 people, so the muster pages at the default page size of 50. */
export const sampleEmployeeList: SampleEmployee[] = Array.from({ length: 63 }, (_, index) => {
  const first = FIRST_NAMES[index % FIRST_NAMES.length] ?? 'Aarav';
  const last = LAST_NAMES[(index * 3) % LAST_NAMES.length] ?? 'Nair';
  const department = sampleDepartmentList[index % sampleDepartmentList.length];
  return {
    id: `emp-${String(1001 + index)}`,
    employeeCode: `E-${String(1001 + index)}`,
    name: `${first} ${last}`,
    departmentId: department?.id ?? 'dep-1',
    departmentName: department?.name ?? 'Production',
    // Most people are on General; the tail carries the other three so the
    // muster shows a mix rather than one repeated shift name.
    shiftIndex: index % 9 === 4 ? 1 : index % 9 === 7 ? 2 : index % 17 === 11 ? 3 : 0,
  };
});

export const sampleShiftList: Shift[] = [
  {
    id: 'shift-general',
    name: 'General',
    code: 'GEN',
    scheduledIn: '09:00',
    scheduledOut: '18:00',
    breakMinutes: 60,
    crossesMidnight: false,
    policy: {
      graceInBefore: 30,
      graceInAfter: 10,
      lateAfter: 10,
      graceOutBefore: 10,
      graceOutAfter: 120,
      earlyExitBefore: 10,
      minHalfDayMinutes: 240,
      minFullDayMinutes: 480,
      otAfterMinutes: 30,
    },
  },
  {
    id: 'shift-morning',
    name: 'Morning',
    code: 'MOR',
    scheduledIn: '06:00',
    scheduledOut: '14:00',
    breakMinutes: 30,
    crossesMidnight: false,
    policy: {
      graceInBefore: 30,
      graceInAfter: 10,
      lateAfter: 10,
      graceOutBefore: 10,
      graceOutAfter: 90,
      earlyExitBefore: 10,
      minHalfDayMinutes: 210,
      minFullDayMinutes: 450,
      otAfterMinutes: 30,
    },
  },
  {
    id: 'shift-evening',
    name: 'Evening',
    code: 'EVE',
    scheduledIn: '14:00',
    scheduledOut: '22:00',
    breakMinutes: 30,
    crossesMidnight: false,
    policy: {
      graceInBefore: 30,
      graceInAfter: 10,
      lateAfter: 15,
      graceOutBefore: 10,
      graceOutAfter: 90,
      earlyExitBefore: 10,
      minHalfDayMinutes: 210,
      minFullDayMinutes: 450,
      otAfterMinutes: 30,
    },
  },
  {
    id: 'shift-night',
    name: 'Night',
    code: 'NGT',
    scheduledIn: '22:00',
    scheduledOut: '06:00',
    breakMinutes: 45,
    crossesMidnight: true,
    policy: {
      graceInBefore: 30,
      graceInAfter: 15,
      lateAfter: 15,
      graceOutBefore: 15,
      graceOutAfter: 120,
      earlyExitBefore: 15,
      minHalfDayMinutes: 210,
      minFullDayMinutes: 435,
      otAfterMinutes: 45,
    },
  },
];

/** Republic Day and Independence Day, so a HOLIDAY status is reachable. */
const HOLIDAYS = new Set(['01-26', '08-15', '10-02', '12-25']);

function clockOf(base: string, offsetMinutes: number): string {
  const [hours = '0', minutes = '0'] = base.split(':');
  const at = addMinutes(new Date(2000, 0, 1, Number(hours), Number(minutes)), offsetMinutes);
  return format(at, 'HH:mm');
}

interface DerivedDay {
  status: AttendanceStatus;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  otMinutes: number;
  lateMinutes: number;
  flags: string[];
}

/**
 * The shape of one person's day, derived the way the real engine would derive
 * it: weekly off and holiday first, then leave, then whatever the punches say
 * (REQ-E-02 resolution order). Getting the order right here matters because
 * these rows are what the status colours and the calendar are reviewed against.
 */
function deriveDay(employee: SampleEmployee, date: Date, shift: Shift): DerivedDay {
  const key = `${employee.id}:${format(date, 'yyyy-MM-dd')}`;
  const roll = hash(key);
  const empty: DerivedDay = {
    status: 'ABSENT',
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
    otMinutes: 0,
    lateMinutes: 0,
    flags: [],
  };

  if (HOLIDAYS.has(format(date, 'MM-dd'))) return { ...empty, status: 'HOLIDAY' };
  if (date.getDay() === 0) return { ...empty, status: 'WEEKLY_OFF' };
  // Alternate Saturdays are off (REQ-C-03), which is the pattern most of these
  // organisations actually run.
  if (date.getDay() === 6 && [1, 3].includes(Math.ceil(date.getDate() / 7) % 4)) {
    return { ...empty, status: 'WEEKLY_OFF' };
  }

  if (roll < 0.05) return { ...empty, status: 'ON_LEAVE' };
  if (roll < 0.07) return { ...empty, status: 'ON_DUTY', flags: ['no_location'] };
  if (roll < 0.11) return { ...empty, status: 'ABSENT', flags: ['missing_punch'] };

  const lateMinutes = roll > 0.82 ? Math.round((roll - 0.82) * 240) : 0;
  const firstIn = clockOf(shift.scheduledIn, lateMinutes - (roll < 0.4 ? 4 : 0));
  const flags: string[] = [];
  if (lateMinutes > shift.policy.lateAfter) flags.push('late');

  if (roll > 0.955) {
    // IN with no OUT, and the window has closed: PENDING (REQ-E-02).
    flags.push('missing_punch');
    return { ...empty, status: 'PENDING', firstIn, lateMinutes, flags };
  }

  const overtime = roll > 0.9 ? Math.round((roll - 0.9) * 900) : 0;
  const earlyExit = roll > 0.13 && roll < 0.17 ? 200 : 0;
  const lastOut = clockOf(shift.scheduledOut, overtime - earlyExit);
  if (earlyExit > 0) flags.push('early_exit');
  if (roll > 0.995) flags.push('offline_sync');
  if (roll > 0.12 && roll < 0.125) flags.push('outside_geofence');

  const scheduledMinutes =
    (Number(shift.scheduledOut.slice(0, 2)) - Number(shift.scheduledIn.slice(0, 2)) + 24) % 24;
  const workedMinutes =
    scheduledMinutes * 60 - shift.breakMinutes - lateMinutes - earlyExit + overtime;

  const status: AttendanceStatus =
    workedMinutes >= shift.policy.minFullDayMinutes
      ? 'PRESENT'
      : workedMinutes >= shift.policy.minHalfDayMinutes
        ? 'HALF_DAY'
        : 'ABSENT';

  return {
    status,
    firstIn,
    lastOut,
    workedMinutes: Math.max(0, workedMinutes),
    otMinutes: overtime > shift.policy.otAfterMinutes ? overtime : 0,
    lateMinutes,
    flags,
  };
}

function dayFor(employee: SampleEmployee, date: Date): AttendanceDay {
  const shift = sampleShiftList[employee.shiftIndex] ?? sampleShiftList[0];
  if (!shift) throw new Error('The sample shift list is empty.');
  const derived = deriveDay(employee, date, shift);
  const scheduled = derived.status === 'WEEKLY_OFF' || derived.status === 'HOLIDAY';

  return {
    employee: { id: employee.id, name: employee.name },
    date: format(date, 'yyyy-MM-dd'),
    shiftName: scheduled ? null : shift.name,
    scheduledIn: scheduled ? null : shift.scheduledIn,
    scheduledOut: scheduled ? null : shift.scheduledOut,
    firstIn: derived.firstIn,
    lastOut: derived.lastOut,
    workedMinutes: derived.workedMinutes,
    otMinutes: derived.otMinutes,
    lateMinutes: derived.lateMinutes,
    status: derived.status,
    flags: derived.flags,
  };
}

export interface SampleDayQuery {
  from: string;
  to: string;
  employeeId?: string | null;
  departmentId?: string | null;
  status?: string | null;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** `GET /attendance/days`, invented. Never returns a day after today. */
export function sampleAttendanceDays(query: SampleDayQuery): Paginated<AttendanceDay> {
  const from = parseISO(query.from);
  const to = parseISO(query.to);
  const today = new Date();
  const span = Math.max(0, differenceInCalendarDays(to, from));

  // The screens ask for their own days with `employeeId: 'me'` and let the
  // server resolve it from the session. The sample set has no session, so
  // "me" is the first person in it. Without this the whole of My Attendance
  // renders its empty state and looks broken rather than unwired.
  const wanted =
    query.employeeId === 'me' ? (sampleEmployeeList[0]?.id ?? null) : (query.employeeId ?? null);

  const people = sampleEmployeeList.filter((employee) => {
    if (wanted && employee.id !== wanted) return false;
    if (query.departmentId && employee.departmentId !== query.departmentId) return false;
    if (query.q) {
      const needle = query.q.toLowerCase();
      if (
        !employee.name.toLowerCase().includes(needle) &&
        !employee.employeeCode.toLowerCase().includes(needle)
      ) {
        return false;
      }
    }
    return true;
  });

  const rows: AttendanceDay[] = [];
  for (let offset = 0; offset <= span; offset += 1) {
    const date = addDays(from, offset);
    // REQ-E-01 stops the ledger at today: a day in the future has not happened
    // and must not appear as an absence.
    if (differenceInCalendarDays(date, today) > 0) break;
    for (const employee of people) rows.push(dayFor(employee, date));
  }

  const filtered = query.status ? rows.filter((row) => row.status === query.status) : rows;
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  const start = (page - 1) * pageSize;

  return {
    data: filtered.slice(start, start + pageSize),
    meta: { page, pageSize, total: filtered.length },
  };
}

/** `GET /me/today`, invented, for whoever is signed in. */
export function sampleTodayStatus(): TodayStatus {
  const now = new Date();
  const me = sampleEmployeeList[0];
  if (!me) throw new Error('The sample employee list is empty.');
  const shift = sampleShiftList[0];
  if (!shift) throw new Error('The sample shift list is empty.');

  const today = dayFor(me, now);
  const punchedIn = today.firstIn !== null && today.lastOut === null;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const windowStart = clockOf(shift.scheduledIn, -shift.policy.graceInBefore);
  const windowEnd = clockOf(shift.scheduledOut, shift.policy.graceOutAfter);
  const startMinutes = Number(windowStart.slice(0, 2)) * 60 + Number(windowStart.slice(3, 5));
  const endMinutes = Number(windowEnd.slice(0, 2)) * 60 + Number(windowEnd.slice(3, 5));

  return {
    serverTime: now.toISOString(),
    date: format(now, 'yyyy-MM-dd'),
    employee: { id: me.id, name: me.name, employeeCode: me.employeeCode },
    shift: {
      name: shift.name,
      scheduledIn: shift.scheduledIn,
      scheduledOut: shift.scheduledOut,
      windowStart,
      windowEnd,
      crossesMidnight: shift.crossesMidnight,
    },
    status: today.status,
    nextPunchType: punchedIn ? 'OUT' : 'IN',
    lastPunch:
      today.firstIn === null
        ? null
        : {
            type: punchedIn ? 'IN' : 'OUT',
            at: `${format(now, 'yyyy-MM-dd')}T${punchedIn ? today.firstIn : (today.lastOut ?? today.firstIn)}:00`,
            source: 'WEB',
          },
    withinWindow: minutesNow >= startMinutes && minutesNow <= endMinutes,
    windowBehaviour: 'ALLOW_WITH_REASON',
    halfDayAllowed: !punchedIn,
    consentAccepted: false,
    photoRetentionMonths: 12,
  };
}

export function sampleShifts(): Paginated<Shift> {
  return {
    data: sampleShiftList,
    meta: { page: 1, pageSize: 50, total: sampleShiftList.length },
  };
}

export interface SampleRosterQuery {
  from: string;
  to: string;
  departmentId?: string | null;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** `GET /rosters`, invented. One open-ended assignment per person. */
export function sampleRoster(query: SampleRosterQuery): Paginated<RosterEntry> {
  const rows = sampleEmployeeList
    .filter((employee) => {
      if (query.departmentId && employee.departmentId !== query.departmentId) return false;
      if (query.q) {
        const needle = query.q.toLowerCase();
        return (
          employee.name.toLowerCase().includes(needle) ||
          employee.employeeCode.toLowerCase().includes(needle)
        );
      }
      return true;
    })
    .map<RosterEntry>((employee) => {
      const shift = sampleShiftList[employee.shiftIndex] ?? sampleShiftList[0];
      if (!shift) throw new Error('The sample shift list is empty.');
      return {
        id: `roster-${employee.id}`,
        employee: { id: employee.id, name: employee.name, employeeCode: employee.employeeCode },
        shift: { id: shift.id, name: shift.name, code: shift.code },
        from: query.from,
        // A few assignments end inside the period, so the list is not a
        // uniform column of "Open-ended".
        to: hash(employee.id) > 0.85 ? query.to : null,
        department: employee.departmentName,
      };
    });

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  const start = (page - 1) * pageSize;

  return {
    data: rows.slice(start, start + pageSize),
    meta: { page, pageSize, total: rows.length },
  };
}

export function sampleDepartments(): Paginated<DepartmentSummary> {
  return {
    data: sampleDepartmentList,
    meta: { page: 1, pageSize: 50, total: sampleDepartmentList.length },
  };
}
