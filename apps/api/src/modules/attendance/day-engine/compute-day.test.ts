import type { AttendanceFlag, AttendanceStatus, PunchSource, PunchType } from '@vyuha/shared';
import { describe, expect, it } from 'vitest';

import { parseCalendarDate } from './calendar-date.js';
import {
  computeDayResult,
  type AdjustmentFact,
  type DayInput,
  type ExistingDayFact,
  type HolidayFact,
  type LeaveFact,
  type PunchFact,
  type ShiftPolicy,
} from './compute-day.js';
import type { WeeklyOffConfig } from './weekly-off.js';

/**
 * The day engine's table-driven suite (technical design §16, which names the
 * cases and sets a 90% branch bar on this function).
 *
 * Every row states its inputs and the status, worked minutes and flags it must
 * produce. A row is cheap to add, which is the point: the arguments about this
 * engine are all arguments about specific days, and a specific day should cost
 * five lines to pin down.
 *
 * Two properties are checked against every row rather than in cases of their
 * own -- idempotency (REQ-E-06) and independence from punch ordering -- because
 * a property that only holds for the cases someone thought to write it for is
 * not a property.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The real general shift timings are still unanswered (OPEN-QUESTIONS item 2),
 * so this fixture invents 09:00-18:00 purely to have boundaries to measure
 * against. It is not a default and nothing outside this file reads it: the
 * engine takes every threshold from the `shifts` row it is handed.
 *
 * The policy numbers, by contrast, are REQ-C-01's stated defaults, so the
 * boundary rows below are testing the shipped policy and not an invention.
 */
const DAY_SHIFT: ShiftPolicy = {
  id: '01900000-0000-7000-8000-00000000d001',
  breakMinutes: 60,
  graceInBefore: 30,
  graceInAfter: 10,
  lateAfter: 10,
  graceOutBefore: 10,
  graceOutAfter: 120,
  earlyExitBefore: 10,
  minHalfDayMinutes: 240,
  minFullDayMinutes: 480,
  otAfterMinutes: 30,
};

/** Same policy, night hours. Timings invented for the same reason. */
const NIGHT_SHIFT: ShiftPolicy = { ...DAY_SHIFT, id: '01900000-0000-7000-8000-00000000d002' };

const LEAVE_REQUEST_ID = '01900000-0000-7000-8000-00000000e001';

/** Asia/Kolkata, the organisation default in `organizations.timezone`. */
const OFFSET = '+05:30';

/** A Tuesday. Asserted below rather than trusted. */
const WORKDAY = '2026-03-10';
const NEXT_DAY = '2026-03-11';
/** The first Saturday of March 2026, and the second. */
const FIRST_SATURDAY = '2026-03-07';
const SECOND_SATURDAY = '2026-03-14';
const SUNDAY = '2026-03-08';

function at(day: string, hhmm: string): Date {
  return new Date(`${day}T${hhmm}:00${OFFSET}`);
}

const SCHEDULED_IN = at(WORKDAY, '09:00');
const SCHEDULED_OUT = at(WORKDAY, '18:00');
/** scheduled_out + grace_out_after, the instant the day's window shuts. */
const WINDOW_CLOSED = at(WORKDAY, '20:01');
const MID_SHIFT = at(WORKDAY, '13:00');

interface PunchSpec {
  readonly type: PunchType;
  readonly at: Date;
  readonly source?: PunchSource;
  readonly halfDay?: boolean;
  readonly outsideWindow?: boolean;
  readonly outsideGeofence?: boolean;
  readonly deviceMismatch?: boolean;
}

function punch(spec: PunchSpec, index: number): PunchFact {
  return {
    id: `01900000-0000-7000-8000-0000000000${String(index).padStart(2, '0')}`,
    punchType: spec.type,
    serverTime: spec.at,
    source: spec.source ?? 'MOBILE',
    isHalfDayMarked: spec.halfDay ?? false,
    outsideWindow: spec.outsideWindow ?? false,
    outsideGeofence: spec.outsideGeofence ?? false,
    deviceMismatch: spec.deviceMismatch ?? false,
  };
}

interface Scenario {
  readonly date?: string;
  readonly now?: Date;
  readonly shift?: Partial<ShiftPolicy>;
  readonly scheduledIn?: Date;
  readonly scheduledOut?: Date;
  readonly maxWorkMinutes?: number;
  readonly holiday?: HolidayFact | null;
  readonly weeklyOffPattern?: WeeklyOffConfig | null;
  readonly leave?: LeaveFact | null;
  readonly onDuty?: boolean;
  readonly punches?: readonly PunchSpec[];
  readonly adjustment?: AdjustmentFact | null;
  readonly existing?: ExistingDayFact | null;
}

function buildInput(scenario: Scenario): DayInput {
  return {
    date: scenario.date ?? WORKDAY,
    now: scenario.now ?? WINDOW_CLOSED,
    shift: { ...DAY_SHIFT, ...scenario.shift },
    scheduledIn: scenario.scheduledIn ?? SCHEDULED_IN,
    scheduledOut: scenario.scheduledOut ?? SCHEDULED_OUT,
    maxWorkMinutes: scenario.maxWorkMinutes ?? 16 * 60,
    holiday: scenario.holiday ?? null,
    weeklyOffPattern: scenario.weeklyOffPattern ?? null,
    leave: scenario.leave ?? null,
    onDuty: scenario.onDuty ?? false,
    punches: (scenario.punches ?? []).map(punch),
    adjustment: scenario.adjustment ?? null,
    existing: scenario.existing ?? null,
  };
}

interface Expectation {
  readonly status: AttendanceStatus;
  readonly workedMinutes: number;
  readonly flags: readonly AttendanceFlag[];
  readonly breakMinutes?: number;
  readonly lateMinutes?: number;
  readonly earlyExitMinutes?: number;
  readonly otMinutes?: number;
  readonly leaveRequestId?: string | null;
  readonly isManualOverride?: boolean;
  readonly firstInPunchId?: string | null;
  readonly lastOutPunchId?: string | null;
}

interface Row {
  /** What the row pins down, and which requirement says so. */
  readonly name: string;
  readonly scenario: Scenario;
  readonly expected: Expectation;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const ROWS: readonly Row[] = [
  // --- the cases technical design §16 names -------------------------------
  {
    name: 'night shift crossing midnight is attributed to the start date (REQ-C-02)',
    scenario: {
      shift: { ...NIGHT_SHIFT },
      scheduledIn: at(WORKDAY, '22:00'),
      scheduledOut: at(NEXT_DAY, '06:00'),
      now: at(NEXT_DAY, '08:01'),
      punches: [
        { type: 'IN', at: at(WORKDAY, '21:50') },
        { type: 'OUT', at: at(NEXT_DAY, '07:00') },
      ],
    },
    // 21:50 to 07:00 is 550 minutes; less the 60 minute break, 490.
    expected: { status: 'PRESENT', workedMinutes: 490, flags: [], otMinutes: 30 },
  },
  {
    name: 'half day marked at the IN punch beats the hours worked (REQ-D-07)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00'), halfDay: true },
        { type: 'OUT', at: at(WORKDAY, '11:00') },
      ],
    },
    // 60 worked minutes is below min_half_day_minutes, so only the mark can
    // produce HALF_DAY here -- which is what "overrides duration-based
    // derivation" means.
    expected: {
      status: 'HALF_DAY',
      workedMinutes: 60,
      flags: ['early_exit', 'outside_window'],
      earlyExitMinutes: 420,
    },
  },
  {
    name: 'half day derived from hours alone (REQ-E-02)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '15:00') },
      ],
    },
    // 360 span less 60 break is 300: at or above min_half, below min_full.
    expected: {
      status: 'HALF_DAY',
      workedMinutes: 300,
      flags: ['early_exit', 'outside_window'],
      earlyExitMinutes: 180,
    },
  },
  {
    name: 'half-day leave plus a worked half day renders as both (REQ-E-02 note)',
    scenario: {
      leave: { leaveRequestId: LEAVE_REQUEST_ID, portion: 'FIRST_HALF' },
      punches: [
        { type: 'IN', at: at(WORKDAY, '13:30') },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    // 270 span less 60 break is 210 -- below min_half -- so this row also pins
    // that the *leave* half is what makes it a half day, not the hours.
    expected: {
      status: 'ON_LEAVE',
      workedMinutes: 210,
      flags: ['late', 'outside_window'],
      lateMinutes: 270,
      leaveRequestId: LEAVE_REQUEST_ID,
    },
  },
  {
    name: 'half-day leave plus enough hours to qualify becomes HALF_DAY, carrying the leave',
    scenario: {
      leave: { leaveRequestId: LEAVE_REQUEST_ID, portion: 'SECOND_HALF' },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '14:00') },
      ],
    },
    expected: {
      status: 'HALF_DAY',
      workedMinutes: 240,
      flags: ['early_exit', 'outside_window'],
      leaveRequestId: LEAVE_REQUEST_ID,
    },
  },
  {
    name: 'full-day leave is ON_LEAVE and outranks the hours (REQ-E-02)',
    scenario: {
      leave: { leaveRequestId: LEAVE_REQUEST_ID, portion: 'FULL' },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    expected: {
      status: 'ON_LEAVE',
      workedMinutes: 480,
      flags: [],
      leaveRequestId: LEAVE_REQUEST_ID,
    },
  },
  {
    name: 'holiday with a punch on it stays HOLIDAY and still counts the hours (REQ-E-02)',
    scenario: {
      holiday: { isRestricted: false, elected: false },
      punches: [
        { type: 'IN', at: at(WORKDAY, '10:00') },
        { type: 'OUT', at: at(WORKDAY, '15:00') },
      ],
    },
    // The hours are what a comp-off credit (REQ-G-09) will later be granted
    // from, so a holiday that swallowed them would lose the entitlement.
    // `late` and `early_exit` fire because REQ-E-04 makes flags independent of
    // status; see the note in the report accompanying this phase.
    expected: {
      status: 'HOLIDAY',
      workedMinutes: 240,
      flags: ['late', 'early_exit', 'outside_window'],
      lateMinutes: 60,
      earlyExitMinutes: 180,
    },
  },
  {
    name: 'missing OUT punch after the window closes is PENDING and flagged (05-decisions, REQ-E-07)',
    scenario: {
      now: WINDOW_CLOSED,
      punches: [{ type: 'IN', at: at(WORKDAY, '09:00') }],
    },
    expected: { status: 'PENDING', workedMinutes: 0, flags: ['missing_punch'] },
  },
  {
    name: 'a half day marked at the punch outranks PENDING when the OUT never came (REQ-E-02 order)',
    scenario: {
      now: WINDOW_CLOSED,
      punches: [{ type: 'IN', at: at(WORKDAY, '09:00'), halfDay: true }],
    },
    // REQ-E-02 puts HALF_DAY above PENDING, and the employee said at the punch
    // what the day was. The missing OUT is still recorded as a flag, so the
    // regularization queue picks it up either way.
    expected: { status: 'HALF_DAY', workedMinutes: 0, flags: ['missing_punch'] },
  },
  {
    name: 'missing OUT punch while the shift is still running is PENDING but not yet flagged',
    scenario: {
      now: MID_SHIFT,
      punches: [{ type: 'IN', at: at(WORKDAY, '09:00') }],
    },
    // Nothing is missing at one in the afternoon; the OUT punch is not due yet.
    expected: { status: 'PENDING', workedMinutes: 0, flags: [] },
  },
  {
    name: 'out-of-window punch allowed with a reason carries the endpoint verdict (REQ-D-06)',
    scenario: {
      punches: [
        // Inside the window by the clock, so only the punch's own verdict can
        // raise the flag. That is the point of the row: the engine reflects
        // REQ-D-06 rather than re-deciding it.
        { type: 'IN', at: at(WORKDAY, '09:05'), outsideWindow: true },
        { type: 'OUT', at: at(WORKDAY, '18:05') },
      ],
    },
    expected: {
      status: 'PRESENT',
      workedMinutes: 480,
      flags: ['outside_window'],
      lateMinutes: 5,
    },
  },
  {
    name: 'offline-synced punches flag the day (REQ-D-10)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00'), source: 'OFFLINE_SYNC' },
        { type: 'OUT', at: at(WORKDAY, '18:00'), source: 'OFFLINE_SYNC' },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 480, flags: ['offline_sync'] },
  },
  {
    name: 'a manual override keeps its status through a recomputation (REQ-E-08)',
    scenario: {
      existing: { status: 'ON_DUTY', isManualOverride: true },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    // The hours would otherwise say PRESENT. The status HR set survives, the
    // measurements are taken again, and the flag marks the row in every report.
    expected: {
      status: 'ON_DUTY',
      workedMinutes: 480,
      flags: ['manual_override'],
      isManualOverride: true,
    },
  },
  {
    name: 'a manual override to ABSENT survives a day that would otherwise be PRESENT',
    scenario: {
      existing: { status: 'ABSENT', isManualOverride: true },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    expected: {
      status: 'ABSENT',
      workedMinutes: 480,
      flags: ['manual_override'],
      isManualOverride: true,
    },
  },
  {
    name: 'an existing row that is not an override is recomputed normally',
    scenario: {
      existing: { status: 'ABSENT', isManualOverride: false },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 480, flags: [] },
  },

  // --- boundaries the PRD implies -----------------------------------------
  {
    name: 'exactly at min_half_day_minutes is a half day, not absent (REQ-E-02)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '14:00') },
      ],
    },
    expected: {
      status: 'HALF_DAY',
      workedMinutes: 240,
      flags: ['early_exit', 'outside_window'],
    },
  },
  {
    name: 'one minute below min_half_day_minutes is absent',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '13:59') },
      ],
    },
    expected: {
      status: 'ABSENT',
      workedMinutes: 239,
      flags: ['early_exit', 'outside_window'],
    },
  },
  {
    name: 'exactly at min_full_day_minutes is present, not a half day (REQ-E-02)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 480, flags: [], breakMinutes: 60 },
  },
  {
    name: 'one minute below min_full_day_minutes is a half day',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '17:59') },
      ],
    },
    // 17:59 is one minute early, which is inside early_exit_before, so no flag.
    expected: {
      status: 'HALF_DAY',
      workedMinutes: 479,
      flags: [],
      earlyExitMinutes: 1,
    },
  },
  {
    name: 'exactly at late_after is not flagged late (REQ-C-01: "past this")',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:10') },
        { type: 'OUT', at: at(WORKDAY, '18:20') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 490, flags: [], lateMinutes: 10 },
  },
  {
    name: 'one minute past late_after is flagged late',
    scenario: {
      // grace_in_after widened so the window boundary does not fire too and
      // hide which threshold this row is measuring.
      shift: { graceInAfter: 25 },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:11') },
        { type: 'OUT', at: at(WORKDAY, '18:20') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 489, flags: ['late'], lateMinutes: 11 },
  },
  {
    name: 'a punch exactly on the grace boundary is inside the window (REQ-D-06)',
    scenario: {
      shift: { graceInAfter: 25 },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:25') },
        { type: 'OUT', at: at(WORKDAY, '18:25') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 480, flags: ['late'], lateMinutes: 25 },
  },
  {
    name: 'a punch one minute past the grace boundary is outside the window',
    scenario: {
      shift: { graceInAfter: 25 },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:26') },
        { type: 'OUT', at: at(WORKDAY, '18:26') },
      ],
    },
    expected: {
      status: 'PRESENT',
      workedMinutes: 480,
      flags: ['late', 'outside_window'],
      lateMinutes: 26,
    },
  },
  {
    name: 'exactly at early_exit_before is not flagged',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '17:50') },
      ],
    },
    expected: {
      status: 'HALF_DAY',
      workedMinutes: 470,
      flags: [],
      earlyExitMinutes: 10,
    },
  },
  {
    name: 'one minute earlier than early_exit_before is flagged',
    scenario: {
      // grace_out_before widened for the same reason as above.
      shift: { graceOutBefore: 60 },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '17:49') },
      ],
    },
    expected: {
      status: 'HALF_DAY',
      workedMinutes: 469,
      flags: ['early_exit'],
      earlyExitMinutes: 11,
    },
  },
  {
    name: 'exactly at ot_after_minutes earns no overtime (REQ-C-01)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '18:30') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 510, flags: [], otMinutes: 0 },
  },
  {
    name: 'one minute past ot_after_minutes earns one minute of overtime (REQ-E-05)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '18:31') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 511, flags: [], otMinutes: 1 },
  },
  {
    name: 'worked minutes are capped at the configured maximum (REQ-E-03)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(NEXT_DAY, '09:00') },
      ],
    },
    // 1440 span less the break is 1380, capped to the 16-hour default.
    expected: {
      status: 'PRESENT',
      workedMinutes: 960,
      flags: ['outside_window'],
      breakMinutes: 60,
      otMinutes: 870,
    },
  },
  {
    name: 'the cap comes from settings, not from a constant',
    scenario: {
      maxWorkMinutes: 600,
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '22:00') },
      ],
    },
    expected: {
      status: 'PRESENT',
      workedMinutes: 600,
      flags: ['outside_window'],
      breakMinutes: 60,
    },
  },
  {
    name: 'a break longer than the span cannot make worked minutes negative',
    scenario: {
      shift: { breakMinutes: 240 },
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '10:00') },
      ],
    },
    expected: {
      status: 'ABSENT',
      workedMinutes: 0,
      flags: ['early_exit', 'outside_window'],
      breakMinutes: 60,
    },
  },

  // --- calendar context ----------------------------------------------------
  {
    name: 'a fixed weekly off matches by weekday (REQ-C-03)',
    scenario: {
      date: SUNDAY,
      weeklyOffPattern: { weekdays: [7] },
    },
    expected: { status: 'WEEKLY_OFF', workedMinutes: 0, flags: [] },
  },
  {
    name: 'the alternate-Saturday rule matches the second Saturday (REQ-C-03)',
    scenario: {
      date: SECOND_SATURDAY,
      weeklyOffPattern: { weekdays: [7], saturdaysOfMonth: [2, 4] },
    },
    expected: { status: 'WEEKLY_OFF', workedMinutes: 0, flags: [] },
  },
  {
    name: 'the alternate-Saturday rule does not match the first Saturday',
    scenario: {
      date: FIRST_SATURDAY,
      weeklyOffPattern: { weekdays: [7], saturdaysOfMonth: [2, 4] },
    },
    expected: { status: 'ABSENT', workedMinutes: 0, flags: [] },
  },
  {
    name: 'a holiday outranks a weekly off (REQ-E-02 resolution order)',
    scenario: {
      date: SUNDAY,
      holiday: { isRestricted: false, elected: false },
      weeklyOffPattern: { weekdays: [7] },
    },
    expected: { status: 'HOLIDAY', workedMinutes: 0, flags: [] },
  },
  {
    name: 'a restricted holiday nobody elected is not a holiday (REQ-H-03)',
    scenario: { holiday: { isRestricted: true, elected: false } },
    expected: { status: 'ABSENT', workedMinutes: 0, flags: [] },
  },
  {
    name: 'a restricted holiday the employee elected is a holiday',
    scenario: { holiday: { isRestricted: true, elected: true } },
    expected: { status: 'HOLIDAY', workedMinutes: 0, flags: [] },
  },
  {
    name: 'a weekly off outranks approved leave (REQ-E-02 resolution order)',
    scenario: {
      date: SUNDAY,
      weeklyOffPattern: { weekdays: [7] },
      leave: { leaveRequestId: LEAVE_REQUEST_ID, portion: 'FULL' },
    },
    // The leave id is still recorded: the day is not deducted, but a report
    // asking "which request covered this date" must still be answerable.
    expected: {
      status: 'WEEKLY_OFF',
      workedMinutes: 0,
      flags: [],
      leaveRequestId: LEAVE_REQUEST_ID,
    },
  },
  {
    name: 'approved on duty with no punches is ON_DUTY (REQ-F-04)',
    scenario: { onDuty: true },
    expected: { status: 'ON_DUTY', workedMinutes: 0, flags: [] },
  },
  {
    name: 'approved on duty with a full day of punches is PRESENT (REQ-E-02 puts PRESENT first)',
    scenario: {
      onDuty: true,
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 480, flags: [] },
  },
  {
    name: 'no punches at all is absent (REQ-E-02)',
    scenario: {},
    expected: { status: 'ABSENT', workedMinutes: 0, flags: [] },
  },

  // --- punches, adjustments and broken data --------------------------------
  {
    name: 'a mid-day break does not shorten the day: first IN to last OUT (REQ-E-03)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00') },
        { type: 'OUT', at: at(WORKDAY, '13:00') },
        { type: 'IN', at: at(WORKDAY, '14:00') },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    expected: {
      status: 'PRESENT',
      workedMinutes: 480,
      // The 13:00 OUT is far outside its own window, which is real information
      // about the day even though the span is unaffected.
      flags: ['outside_window'],
      firstInPunchId: '01900000-0000-7000-8000-000000000000',
      lastOutPunchId: '01900000-0000-7000-8000-000000000003',
    },
  },
  {
    name: 'an approved adjustment supplies a missing OUT (REQ-F-03)',
    scenario: {
      punches: [{ type: 'IN', at: at(WORKDAY, '09:00') }],
      adjustment: { adjustedIn: null, adjustedOut: at(WORKDAY, '18:00') },
    },
    // The punch id still points at the real IN punch: REQ-F-03 requires the
    // original to stay visible beside the correction.
    expected: {
      status: 'PRESENT',
      workedMinutes: 480,
      flags: [],
      firstInPunchId: '01900000-0000-7000-8000-000000000000',
      lastOutPunchId: null,
    },
  },
  {
    name: 'an approved adjustment overrides a wrong IN time without touching the punch',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '12:00') },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
      adjustment: { adjustedIn: at(WORKDAY, '09:00'), adjustedOut: null },
    },
    expected: {
      status: 'PRESENT',
      workedMinutes: 480,
      // The 12:00 punch is still outside its window, and the flag records that
      // the day needed correcting.
      flags: ['outside_window'],
      lateMinutes: 0,
      firstInPunchId: '01900000-0000-7000-8000-000000000000',
    },
  },
  {
    name: 'an OUT punch with no IN is broken data, not negative work',
    scenario: { punches: [{ type: 'OUT', at: at(WORKDAY, '18:00') }] },
    expected: {
      status: 'ABSENT',
      workedMinutes: 0,
      flags: ['missing_punch'],
      lastOutPunchId: '01900000-0000-7000-8000-000000000000',
    },
  },
  {
    name: 'an OUT before its IN yields zero worked minutes, never a negative day',
    scenario: {
      punches: [
        { type: 'OUT', at: at(WORKDAY, '08:00') },
        { type: 'IN', at: at(WORKDAY, '09:00') },
      ],
    },
    // The last OUT is the 08:00 one, so the span is negative and clamped. Both
    // punches exist, so this is not PENDING: the day is a genuine ABSENT with
    // the timings recorded, which is what makes the broken pair visible.
    //
    // `breakMinutes: 0` is load-bearing. Without it a clamp written as
    // `span === 0` instead of `span <= 0` still reports zero worked minutes,
    // by subtracting a negative break from a negative span -- and stores a
    // negative break on the row.
    expected: {
      status: 'ABSENT',
      workedMinutes: 0,
      breakMinutes: 0,
      flags: ['early_exit', 'outside_window'],
      earlyExitMinutes: 600,
    },
  },
  {
    name: 'a geofence verdict from the punch flags the day (REQ-D-08, REQ-E-04)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00'), outsideGeofence: true },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 480, flags: ['outside_geofence'] },
  },
  {
    name: 'a device mismatch from the punch flags the day (REQ-B-08, REQ-E-04)',
    scenario: {
      punches: [
        { type: 'IN', at: at(WORKDAY, '09:00'), deviceMismatch: true },
        { type: 'OUT', at: at(WORKDAY, '18:00') },
      ],
    },
    expected: { status: 'PRESENT', workedMinutes: 480, flags: ['device_mismatch'] },
  },
  {
    name: 'every flag can be raised on one day (REQ-E-04: they are independent)',
    scenario: {
      existing: { status: 'HALF_DAY', isManualOverride: true },
      punches: [
        {
          type: 'IN',
          at: at(WORKDAY, '11:00'),
          source: 'OFFLINE_SYNC',
          outsideWindow: true,
          outsideGeofence: true,
          deviceMismatch: true,
        },
        { type: 'OUT', at: at(WORKDAY, '15:00') },
      ],
    },
    expected: {
      status: 'HALF_DAY',
      workedMinutes: 180,
      flags: [
        'late',
        'early_exit',
        'outside_geofence',
        'outside_window',
        'offline_sync',
        'device_mismatch',
        'manual_override',
      ],
      isManualOverride: true,
    },
  },
];

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

describe('computeDayResult', () => {
  it('is built on the weekdays it claims', () => {
    // Several rows above turn on these being a Tuesday, a Sunday and the first
    // and second Saturdays of the month. A wrong assumption here would make
    // those rows pass for the wrong reason.
    expect(parseCalendarDate(WORKDAY).isoWeekday).toBe(2);
    expect(parseCalendarDate(SUNDAY).isoWeekday).toBe(7);
    expect(parseCalendarDate(FIRST_SATURDAY).isoWeekday).toBe(6);
    expect(parseCalendarDate(SECOND_SATURDAY).isoWeekday).toBe(6);
  });

  describe.each(ROWS)('$name', ({ scenario, expected }) => {
    it('produces the expected status, worked minutes and flags', () => {
      const result = computeDayResult(buildInput(scenario));

      expect(result.status).toBe(expected.status);
      expect(result.workedMinutes).toBe(expected.workedMinutes);
      expect(result.flags).toEqual(expected.flags);

      if (expected.breakMinutes !== undefined) {
        expect(result.breakMinutes).toBe(expected.breakMinutes);
      }
      if (expected.lateMinutes !== undefined) {
        expect(result.lateMinutes).toBe(expected.lateMinutes);
      }
      if (expected.earlyExitMinutes !== undefined) {
        expect(result.earlyExitMinutes).toBe(expected.earlyExitMinutes);
      }
      if (expected.otMinutes !== undefined) {
        expect(result.otMinutes).toBe(expected.otMinutes);
      }
      if (expected.leaveRequestId !== undefined) {
        expect(result.leaveRequestId).toBe(expected.leaveRequestId);
      }
      if (expected.isManualOverride !== undefined) {
        expect(result.isManualOverride).toBe(expected.isManualOverride);
      }
      if (expected.firstInPunchId !== undefined) {
        expect(result.firstInPunchId).toBe(expected.firstInPunchId);
      }
      if (expected.lastOutPunchId !== undefined) {
        expect(result.lastOutPunchId).toBe(expected.lastOutPunchId);
      }
    });

    it('is idempotent: the same input twice is byte-identical (REQ-E-06)', () => {
      const first = computeDayResult(buildInput(scenario));
      const second = computeDayResult(buildInput(scenario));

      // JSON rather than toEqual: this is the assertion that a Date, an array
      // order, or an undefined-versus-absent difference would fail, and those
      // are exactly the ways two "equal" results reach the database differently.
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    it('does not depend on the order punches arrive in', () => {
      const input = buildInput(scenario);
      const reversed: DayInput = { ...input, punches: [...input.punches].reverse() };

      expect(JSON.stringify(computeDayResult(reversed))).toBe(
        JSON.stringify(computeDayResult(input)),
      );
    });
  });

  it('reports the shift it was given, so the row records which policy was applied', () => {
    const result = computeDayResult(buildInput({}));
    expect(result.shiftId).toBe(DAY_SHIFT.id);
    expect(result.scheduledIn).toStrictEqual(SCHEDULED_IN);
    expect(result.scheduledOut).toStrictEqual(SCHEDULED_OUT);
  });

  it('covers every status in REQ-E-02 across the table', () => {
    // A guard against the table quietly losing a case: the resolution order can
    // only be tested by a table that reaches every arm of it.
    const produced = new Set(ROWS.map((row) => row.expected.status));
    expect([...produced].sort()).toEqual([
      'ABSENT',
      'HALF_DAY',
      'HOLIDAY',
      'ON_DUTY',
      'ON_LEAVE',
      'PENDING',
      'PRESENT',
      'WEEKLY_OFF',
    ]);
  });

  it('covers every flag in REQ-E-04 across the table', () => {
    const produced = new Set(ROWS.flatMap((row) => row.expected.flags));
    expect([...produced].sort()).toEqual([
      'device_mismatch',
      'early_exit',
      'late',
      'manual_override',
      'missing_punch',
      'offline_sync',
      'outside_geofence',
      'outside_window',
    ]);
  });
});
