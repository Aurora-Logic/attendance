import {
  ATTENDANCE_FLAGS,
  type AttendanceFlag,
  type AttendanceStatus,
  type LeaveDayPortion,
  type PunchSource,
  type PunchType,
} from '@vyuha/shared';

import { matchesWeeklyOff, type WeeklyOffConfig } from './weekly-off.js';

/**
 * The attendance day engine, technical design §5 -- "the single most important
 * piece of logic in the product. Everything reports off `attendance_days`, so
 * it must be deterministic."
 *
 * This file is steps 3 and 5 to 10 of the eleven, and it is a pure function.
 * Steps 1, 2 and 11 -- resolving the shift, checking the period lock, and
 * writing the row -- need the database and live in `day-engine.service.ts`.
 *
 * Purity is not tidiness here, it is the testability the 90% branch bar in
 * technical design §16 depends on: every boundary in REQ-C-01's policy table
 * becomes a row in a table-driven test rather than a database fixture.
 *
 * Two properties are asserted directly by the tests rather than assumed:
 *
 * - **Deterministic.** No `Date.now()`, no `Math.random()`, no reliance on the
 *   server's timezone. `now` is an input because REQ-E-07's "the shift window
 *   has closed" is a question about the clock, and a function that reads the
 *   clock itself cannot be tested at the boundary.
 * - **Idempotent.** Same input, byte-identical output (REQ-E-06). Every
 *   collection it produces is ordered -- `flags` follows the canonical order in
 *   `ATTENDANCE_FLAGS` rather than the order conditions happened to fire -- so
 *   two runs cannot differ by arrangement alone.
 */

/** REQ-C-01. Every number the engine applies comes from the shift row. */
export interface ShiftPolicy {
  readonly id: string;
  readonly breakMinutes: number;
  readonly graceInBefore: number;
  readonly graceInAfter: number;
  readonly lateAfter: number;
  readonly graceOutBefore: number;
  readonly graceOutAfter: number;
  readonly earlyExitBefore: number;
  readonly minHalfDayMinutes: number;
  readonly minFullDayMinutes: number;
  readonly otAfterMinutes: number;
}

/**
 * What the engine needs from a punch. Notice what it does not include: policy.
 * `outsideWindow`, `outsideGeofence` and `deviceMismatch` are verdicts the
 * punch endpoint already reached, with information the engine does not have --
 * the geofence radius and GPS accuracy at the time, the device binding mode
 * that was in force. Re-deriving them here would be a second implementation of
 * REQ-D-06 and REQ-D-08 that could disagree with the first.
 */
export interface PunchFact {
  readonly id: string;
  readonly punchType: PunchType;
  readonly serverTime: Date;
  readonly source: PunchSource;
  readonly isHalfDayMarked: boolean;
  readonly outsideWindow: boolean;
  readonly outsideGeofence: boolean;
  readonly deviceMismatch: boolean;
}

/** REQ-F-03: an approved correction sits over the punches, never in them. */
export interface AdjustmentFact {
  readonly adjustedIn: Date | null;
  readonly adjustedOut: Date | null;
}

export interface LeaveFact {
  readonly leaveRequestId: string;
  readonly portion: LeaveDayPortion;
}

/** REQ-H-02/H-03: a restricted holiday is only a holiday for those who elected it. */
export interface HolidayFact {
  readonly isRestricted: boolean;
  readonly elected: boolean;
}

/**
 * The only thing the engine reads from its own previous output, and only for
 * REQ-E-08 (technical design §5: "It never reads its own previous output except
 * to preserve `is_manual_override`").
 */
export interface ExistingDayFact {
  readonly status: AttendanceStatus;
  readonly isManualOverride: boolean;
}

export interface DayInput {
  /** The attendance date, `YYYY-MM-DD`. For a night shift, the start date. */
  readonly date: string;
  /** Injected, never read from the clock. See the note on determinism above. */
  readonly now: Date;
  readonly shift: ShiftPolicy;
  /** The shift's local start on this date, resolved to an instant. */
  readonly scheduledIn: Date;
  /** Resolved to an instant; on the next calendar date for a night shift. */
  readonly scheduledOut: Date;
  /** REQ-E-03, from org settings. Never a constant in this file. */
  readonly maxWorkMinutes: number;
  readonly holiday: HolidayFact | null;
  readonly weeklyOffPattern: WeeklyOffConfig | null;
  readonly leave: LeaveFact | null;
  readonly onDuty: boolean;
  readonly punches: readonly PunchFact[];
  readonly adjustment: AdjustmentFact | null;
  readonly existing: ExistingDayFact | null;
}

export interface DayResult {
  readonly status: AttendanceStatus;
  readonly shiftId: string;
  readonly scheduledIn: Date;
  readonly scheduledOut: Date;
  readonly firstInPunchId: string | null;
  readonly lastOutPunchId: string | null;
  readonly workedMinutes: number;
  readonly breakMinutes: number;
  readonly otMinutes: number;
  readonly lateMinutes: number;
  readonly earlyExitMinutes: number;
  readonly flags: readonly AttendanceFlag[];
  readonly leaveRequestId: string | null;
  readonly isManualOverride: boolean;
}

const MS_PER_MINUTE = 60_000;

/**
 * Floor rather than round. Two adjacent measurements that round in opposite
 * directions would make "exactly at min_half_day_minutes" depend on the seconds
 * component of a punch, and REQ-C-01's thresholds are stated in whole minutes.
 */
function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_MINUTE);
}

function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MS_PER_MINUTE);
}

/**
 * REQ-D-06. The window an individual punch had to land in, which is not the
 * union: `grace_in_after` bounds an IN punch and `grace_out_before` bounds an
 * OUT punch, and using the union would accept an IN punch arriving at going-home
 * time.
 */
function punchWindow(input: DayInput, punchType: PunchType): { opens: Date; closes: Date } {
  const { shift, scheduledIn, scheduledOut } = input;
  return punchType === 'IN'
    ? {
        opens: addMinutes(scheduledIn, -shift.graceInBefore),
        closes: addMinutes(scheduledIn, shift.graceInAfter),
      }
    : {
        opens: addMinutes(scheduledOut, -shift.graceOutBefore),
        closes: addMinutes(scheduledOut, shift.graceOutAfter),
      };
}

/** Canonical order, so two runs cannot differ by arrangement alone. */
function orderFlags(present: ReadonlySet<AttendanceFlag>): AttendanceFlag[] {
  return ATTENDANCE_FLAGS.filter((flag) => present.has(flag));
}

interface PunchDerived {
  readonly firstInPunchId: string | null;
  readonly lastOutPunchId: string | null;
  readonly firstIn: Date | null;
  readonly lastOut: Date | null;
  readonly halfDayMarked: boolean;
}

/**
 * Step 5 and step 6: the punches for the day, then the approved adjustment laid
 * over them.
 *
 * Sorting by `server_time` rather than trusting insertion order, and taking the
 * first IN and the *last* OUT, is what makes a mid-day break -- IN, OUT, IN,
 * OUT -- resolve to the span of the day. REQ-C-01's `break_minutes` is the
 * agreed deduction; counting the actual gaps would make the day depend on
 * whether somebody remembered to punch for lunch.
 *
 * `serverTime` only. REQ-D-05: client time is never trusted for a policy
 * decision.
 */
function derivePunches(input: DayInput): PunchDerived {
  const byTime = [...input.punches].sort((a, b) => a.serverTime.getTime() - b.serverTime.getTime());

  const firstInPunch = byTime.find((punch) => punch.punchType === 'IN') ?? null;
  const lastOutPunch = byTime.reduce<PunchFact | null>(
    (latest, punch) => (punch.punchType === 'OUT' ? punch : latest),
    null,
  );

  const adjustment = input.adjustment;
  return {
    // The punch ids stay pointed at the real punches even when an adjustment
    // moved the times: REQ-F-03 requires the original to remain visible, and a
    // report showing "punched 21:40, corrected to 18:30" needs both halves.
    firstInPunchId: firstInPunch?.id ?? null,
    lastOutPunchId: lastOutPunch?.id ?? null,
    firstIn: adjustment?.adjustedIn ?? firstInPunch?.serverTime ?? null,
    lastOut: adjustment?.adjustedOut ?? lastOutPunch?.serverTime ?? null,
    // REQ-D-07: chosen by the employee at the moment of punching, and it
    // overrides duration-based derivation rather than competing with it.
    halfDayMarked: byTime.some((punch) => punch.isHalfDayMarked),
  };
}

interface WorkedSpan {
  readonly workedMinutes: number;
  readonly breakMinutes: number;
}

/** Step 7. REQ-E-03. */
function deriveWorked(input: DayInput, punches: PunchDerived): WorkedSpan {
  const { firstIn, lastOut } = punches;
  if (firstIn === null || lastOut === null) return { workedMinutes: 0, breakMinutes: 0 };

  const span = minutesBetween(firstIn, lastOut);
  // An OUT before its IN is broken data, not negative work. REQ-D-01 makes it
  // impossible through the endpoint; an import or an adjustment could still
  // produce it, and a negative day would silently reduce a monthly total.
  if (span <= 0) return { workedMinutes: 0, breakMinutes: 0 };

  const breakMinutes = Math.min(input.shift.breakMinutes, span);
  // REQ-E-03's cap exists "to bound bad data" -- a forgotten OUT punch closed
  // out three days later must not report 72 hours into a payroll input.
  const workedMinutes = Math.min(span - breakMinutes, input.maxWorkMinutes);

  return { workedMinutes, breakMinutes };
}

interface Timings {
  readonly lateMinutes: number;
  readonly earlyExitMinutes: number;
  readonly otMinutes: number;
}

/**
 * Step 9.
 *
 * `late_minutes` records the measured lateness whether or not it crosses
 * `late_after`; the threshold decides the *flag*, not the measurement. A report
 * that shows "7 minutes late, not flagged" is more useful than one that shows
 * zero, and 05-decisions item 13 explicitly declines to attach any consequence
 * to a late, so the number is the whole point of recording it.
 */
function deriveTimings(input: DayInput, punches: PunchDerived): Timings {
  const { firstIn, lastOut } = punches;

  const lateMinutes = firstIn === null ? 0 : Math.max(0, minutesBetween(input.scheduledIn, firstIn));
  const earlyExitMinutes =
    lastOut === null ? 0 : Math.max(0, minutesBetween(lastOut, input.scheduledOut));

  // REQ-C-01: ot_after_minutes are "minutes past scheduled out that start
  // counting as overtime", so the threshold is subtracted rather than being a
  // switch that turns the whole overrun into overtime.
  const beyondScheduledOut =
    lastOut === null ? 0 : Math.max(0, minutesBetween(input.scheduledOut, lastOut));
  const otMinutes = Math.max(0, beyondScheduledOut - input.shift.otAfterMinutes);

  return { lateMinutes, earlyExitMinutes, otMinutes };
}

/** Step 10. REQ-E-04: independent of status, and a day may carry several. */
function deriveFlags(
  input: DayInput,
  punches: PunchDerived,
  timings: Timings,
  isManualOverride: boolean,
): AttendanceFlag[] {
  const present = new Set<AttendanceFlag>();

  // "Past this, the day is flagged Late" -- strictly past, so a punch landing
  // exactly on `late_after` is not late. Same for `early_exit_before`.
  if (punches.firstIn !== null && timings.lateMinutes > input.shift.lateAfter) {
    present.add('late');
  }
  if (punches.lastOut !== null && timings.earlyExitMinutes > input.shift.earlyExitBefore) {
    present.add('early_exit');
  }

  const hasIn = punches.firstIn !== null;
  const hasOut = punches.lastOut !== null;
  const windowClosed = input.now > addMinutes(input.scheduledOut, input.shift.graceOutAfter);

  // REQ-E-07. Nothing is missing while the shift is still running: the OUT
  // punch is not late until the window it belongs to has closed. An OUT with no
  // IN is broken whenever it is seen.
  if ((hasIn && !hasOut && windowClosed) || (!hasIn && hasOut)) {
    present.add('missing_punch');
  }

  for (const punch of input.punches) {
    if (punch.outsideGeofence) present.add('outside_geofence');
    if (punch.deviceMismatch) present.add('device_mismatch');
    if (punch.source === 'OFFLINE_SYNC') present.add('offline_sync');

    // Both halves matter. The punch endpoint's verdict is authoritative, and
    // the independent time check catches a punch written by an import or a
    // repair script that never went through REQ-D-06 at all.
    const window = punchWindow(input, punch.punchType);
    if (punch.outsideWindow || punch.serverTime < window.opens || punch.serverTime > window.closes) {
      present.add('outside_window');
    }
  }

  if (isManualOverride) present.add('manual_override');

  return orderFlags(present);
}

/**
 * Step 8, REQ-E-02, in the order the requirement prints it. The `if` chain is
 * that table read top to bottom, and the order is load-bearing: reordering two
 * arms changes what a month of attendance says.
 *
 * The one subtlety is the note under the table: "A day can be HALF_DAY *and*
 * carry a half-day leave -- that combination is valid and must render as such."
 * Read literally, the ON_LEAVE arm ("approved leave covers the date, full or
 * half") would swallow that case and HALF_DAY could never be reached alongside
 * leave. So ON_LEAVE stays exactly where REQ-E-02 puts it, with one carve-out:
 * a *half*-day leave steps aside when the employee also worked a qualifying
 * half. `leave_request_id` is written either way, so the row carries both facts
 * and the muster can render them together.
 */
function deriveStatus(input: DayInput, punches: PunchDerived, workedMinutes: number): AttendanceStatus {
  const holiday = input.holiday;
  if (holiday !== null && (!holiday.isRestricted || holiday.elected)) return 'HOLIDAY';

  if (input.weeklyOffPattern !== null && matchesWeeklyOff(input.weeklyOffPattern, input.date)) {
    return 'WEEKLY_OFF';
  }

  const qualifiesAsHalfDay = workedMinutes >= input.shift.minHalfDayMinutes || punches.halfDayMarked;
  const leave = input.leave;
  if (leave !== null && !(leave.portion !== 'FULL' && qualifiesAsHalfDay)) return 'ON_LEAVE';

  if (workedMinutes >= input.shift.minFullDayMinutes) return 'PRESENT';
  if (qualifiesAsHalfDay) return 'HALF_DAY';

  if (input.onDuty) return 'ON_DUTY';

  // 05-decisions overrides documents 01-03 where they disagree, and it states
  // the rule without REQ-E-02's "and the shift window has closed" qualifier:
  // "IN with no OUT -> Day becomes Pending until regularized -- not absent, not
  // half day." A day showing ABSENT at eleven in the morning because the
  // employee has not gone home yet is exactly what that sentence forbids. The
  // window still gates the `missing_punch` flag and REQ-E-07's notification.
  if (punches.firstIn !== null && punches.lastOut === null) return 'PENDING';

  return 'ABSENT';
}

/**
 * Steps 3 and 5 to 10. Given everything the day depends on, what the row says.
 *
 * Step 3 (REQ-E-08) is here rather than in the service because it is a
 * statement about the *result*, not about the write: an override keeps the
 * status a human chose and everything measurable is measured again around it,
 * so the muster still shows the hours actually worked under the status HR set.
 */
export function computeDayResult(input: DayInput): DayResult {
  const punches = derivePunches(input);
  const worked = deriveWorked(input, punches);
  const timings = deriveTimings(input, punches);

  // Narrowed to a value rather than a boolean so the status branch below has
  // no unreachable fallback to write -- an `?? 'ABSENT'` that can never fire
  // is a branch no test can cover and a lie about what the code does.
  const override = input.existing !== null && input.existing.isManualOverride ? input.existing : null;
  const isManualOverride = override !== null;
  const flags = deriveFlags(input, punches, timings, isManualOverride);

  // "keep status, recompute only worked_minutes and flags, mark and exit". The
  // status is the human's decision and is preserved; everything measurable is
  // a fact and is measured again.
  const status =
    override !== null ? override.status : deriveStatus(input, punches, worked.workedMinutes);

  return {
    status,
    shiftId: input.shift.id,
    scheduledIn: input.scheduledIn,
    scheduledOut: input.scheduledOut,
    firstInPunchId: punches.firstInPunchId,
    lastOutPunchId: punches.lastOutPunchId,
    workedMinutes: worked.workedMinutes,
    breakMinutes: worked.breakMinutes,
    otMinutes: timings.otMinutes,
    lateMinutes: timings.lateMinutes,
    earlyExitMinutes: timings.earlyExitMinutes,
    flags,
    leaveRequestId: input.leave?.leaveRequestId ?? null,
    isManualOverride,
  };
}
