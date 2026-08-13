import { parseISO } from 'date-fns';

import type { AttendanceDay } from '@/features/attendance/types';
import {
  ATTENDANCE_STATUSES,
  PERMISSIONS,
  type AttendanceStatus,
  type PermissionKey,
} from '@vyuha/shared';

/**
 * REQ-A-03 / REQ-E-01: the arithmetic behind one employee's attendance
 * analysis.
 *
 * Everything here is a pure function over the rows the API returned, so the
 * screen renders and does not calculate (CLAUDE.md §6). It is also the only
 * part of this slice that can be checked without a browser, which is why the
 * awkward decisions live here rather than inline in a chart: whether overtime
 * is extra time or the tail of worked time, how a night shift's scheduled span
 * wraps midnight, and — the one that matters most — whether an empty range
 * means "nothing happened" or "you are not allowed to see this".
 */

// ------------------------------------------------------------------ helpers

/**
 * A number the server sent, made safe to draw with.
 *
 * The day engine cannot produce a negative worked minute, but this crosses a
 * network boundary and CLAUDE.md treats that as untrusted even when we wrote
 * both ends. A NaN reaching recharts is a chart that renders nothing and says
 * nothing about why.
 */
function atLeastZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Ascending by date.
 *
 * `GET /attendance/days` defaults to `-date` (DEFAULT_ATTENDANCE_DAY_SORT), so
 * a series built straight from the response would run right to left. ISO
 * date-only strings sort lexicographically in calendar order, so no parsing is
 * needed to reverse it.
 */
function ascendingByDate(days: readonly AttendanceDay[]): AttendanceDay[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date));
}

const CLOCK_PATTERN = /^(\d{2}):(\d{2})/u;

/**
 * `HH:mm` or an ISO instant, as minutes past local midnight.
 *
 * The contract calls `scheduledIn` and `scheduledOut` wall-clock strings and
 * the running API sends instants. `formatClock` in the attendance module
 * already accepts both; this has to accept both as well, or the reference line
 * on the chart would disagree with the Scheduled column printed beneath it.
 */
function minutesPastMidnight(value: string): number | null {
  const clock = CLOCK_PATTERN.exec(value);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getHours() * 60 + parsed.getMinutes();
}

/**
 * How long the roster asked this person to be present, in minutes.
 *
 * Null when there is no shift on the day, which is a real and common state —
 * a weekly off has no scheduled span, and drawing a zero there would claim the
 * roster asked for nothing rather than that it asked for nothing to be drawn.
 */
export function scheduledSpanMinutes(from: string | null, to: string | null): number | null {
  if (from === null || to === null) return null;

  const start = minutesPastMidnight(from);
  const end = minutesPastMidnight(to);
  if (start === null || end === null) return null;

  // A span of exactly zero — or exactly 24 hours, which is what the wrap below
  // would make of it — is not a roster anybody wrote. Treated as unknown
  // rather than drawn, because a flat 24h line would dwarf every real bar.
  if (start === end) return null;

  // REQ-C-02: a night shift ends on the following calendar day, so an end
  // before the start is a wrap rather than a negative span.
  return end > start ? end - start : end - start + 1440;
}

// ------------------------------------------------------------------- series

export interface WorkedPoint {
  /** Date-only `YYYY-MM-DD`. The axis tick is derived from it, not stored. */
  readonly date: string;
  /** Worked time that was not overtime. */
  readonly regular: number;
  readonly overtime: number;
  /** Null on a day with no roster; recharts breaks the line rather than dipping. */
  readonly scheduled: number | null;
}

/**
 * Worked minutes per day, split so the stack totals worked time exactly.
 *
 * The split is the point. `compute-day.ts` derives overtime as the minutes
 * *beyond* the scheduled out, and those minutes are already inside
 * `workedMinutes` — so plotting the two as separate stacked series without
 * subtracting would report a nine-hour day as ten. Clamping overtime to worked
 * keeps the stack honest even if the two ever disagree on the wire.
 */
export function toWorkedSeries(days: readonly AttendanceDay[]): WorkedPoint[] {
  return ascendingByDate(days).map((day) => {
    const worked = atLeastZero(day.workedMinutes);
    const overtime = Math.min(atLeastZero(day.otMinutes), worked);
    return {
      date: day.date,
      regular: worked - overtime,
      overtime,
      scheduled: scheduledSpanMinutes(day.scheduledIn, day.scheduledOut),
    };
  });
}

export interface StatusSlice {
  readonly status: AttendanceStatus;
  readonly count: number;
}

/**
 * How the range breaks down by status, in the contract's order.
 *
 * Only the statuses the range actually contains. A fixed list of eight would
 * spend a third of a 360px screen naming states this person did not have, and
 * the muster's status strip already made that call for the same reason.
 */
export function toStatusSlices(days: readonly AttendanceDay[]): StatusSlice[] {
  const tally = new Map<AttendanceStatus, number>();
  for (const day of days) tally.set(day.status, (tally.get(day.status) ?? 0) + 1);

  return ATTENDANCE_STATUSES.filter((status) => tally.has(status)).map((status) => ({
    status,
    count: tally.get(status) ?? 0,
  }));
}

export interface LatePoint {
  readonly date: string;
  readonly lateMinutes: number;
}

/**
 * Late minutes per day, zeros included.
 *
 * Dropping the zeros would compress five scattered late arrivals into five
 * adjacent bars and lose the thing the chart is for — whether lateness is a
 * habit or an incident.
 */
export function toLateSeries(days: readonly AttendanceDay[]): LatePoint[] {
  return ascendingByDate(days).map((day) => ({
    date: day.date,
    lateMinutes: atLeastZero(day.lateMinutes),
  }));
}

export interface FlagTally {
  readonly flag: string;
  readonly count: number;
}

/**
 * REQ-E-04: which flags this person's days carry, and how often.
 *
 * Commonest first, so a month with one clock-skew and eleven outside-geofence
 * punches leads with the one worth asking about. Ties break alphabetically so
 * the order does not shuffle between two loads of the same data.
 */
export function toFlagTally(days: readonly AttendanceDay[]): FlagTally[] {
  const tally = new Map<string, number>();
  for (const day of days) {
    for (const flag of day.flags) tally.set(flag, (tally.get(flag) ?? 0) + 1);
  }

  return [...tally.entries()]
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag));
}

export interface RangeTotals {
  readonly daysRecorded: number;
  readonly workedMinutes: number;
  readonly overtimeMinutes: number;
  readonly lateMinutes: number;
  readonly lateDays: number;
}

/**
 * The numbers above the charts.
 *
 * Deliberately not the status counts: those are the status chart, and a strip
 * that repeated them would make the chart beside it decoration rather than
 * information.
 */
export function summariseRange(days: readonly AttendanceDay[]): RangeTotals {
  return days.reduce<RangeTotals>(
    (totals, day) => {
      const late = atLeastZero(day.lateMinutes);
      return {
        daysRecorded: totals.daysRecorded + 1,
        workedMinutes: totals.workedMinutes + atLeastZero(day.workedMinutes),
        overtimeMinutes: totals.overtimeMinutes + atLeastZero(day.otMinutes),
        lateMinutes: totals.lateMinutes + late,
        lateDays: totals.lateDays + (late > 0 ? 1 : 0),
      };
    },
    { daysRecorded: 0, workedMinutes: 0, overtimeMinutes: 0, lateMinutes: 0, lateDays: 0 },
  );
}

// -------------------------------------------------------------------- scope

/** The breadth of attendance this session may read (technical design §10). */
export type AttendanceVisibility = 'all' | 'team' | 'self' | 'none';

/**
 * Mirrors `ScopeService.breadth` for the attendance family, widest first.
 *
 * The server is still the authority — every attendance query runs inside its
 * own scope predicate — but the client needs the same answer to explain an
 * empty result, because the endpoint answers "out of your scope" with zero
 * rows and a 200 rather than with a 403.
 */
export function attendanceVisibility(
  permissions: ReadonlySet<PermissionKey>,
): AttendanceVisibility {
  if (permissions.has(PERMISSIONS.ATTENDANCE_VIEW_ALL)) return 'all';
  if (permissions.has(PERMISSIONS.ATTENDANCE_VIEW_TEAM)) return 'team';
  if (permissions.has(PERMISSIONS.ATTENDANCE_VIEW_SELF)) return 'self';
  return 'none';
}

export type EmptyRangeReason =
  /** No key in the attendance family at all: this will be empty for everyone. */
  | 'no-permission'
  /** Holds `self` only, and this is somebody else. Certain, not a guess. */
  | 'outside-scope'
  | 'joined-after-range'
  | 'left-before-range'
  /** Holds `team`: could be either, and the copy has to say so. */
  | 'maybe-outside-scope'
  | 'nothing-recorded';

export interface EmptyRangeInput {
  readonly visibility: AttendanceVisibility;
  /** True when the record being read is the reader's own. */
  readonly isSelf: boolean;
  readonly dateOfJoining: string;
  readonly dateOfLeaving: string | null;
  /** The requested range, `YYYY-MM-DD` inclusive at both ends. */
  readonly from: string;
  readonly to: string;
}

/**
 * Why a range came back with no rows.
 *
 * This exists because `GET /attendance/days` is scoped server-side and answers
 * an out-of-scope request with zero rows and a 200, not a 403 — so "you cannot
 * see this person's attendance" and "this person never came to work" arrive
 * over the wire as the same response. Rendering the second when the first is
 * true is the worst outcome this screen can produce: it accuses somebody of
 * absence on the strength of a permission boundary.
 *
 * The order is deliberate. A certain answer about permission outranks a
 * certain answer about dates, because when the reader can never see these rows
 * the dates do not explain what they are looking at. `team` breadth is the one
 * case a client genuinely cannot resolve — PRD §2 defines team as a reporting
 * chain the browser has not walked — so it says both rather than picking.
 *
 * Comparisons are lexicographic on `YYYY-MM-DD`, which is calendar order for
 * that format and needs no parsing or timezone.
 */
export function emptyRangeReason(input: EmptyRangeInput): EmptyRangeReason {
  if (input.visibility === 'none') return 'no-permission';
  if (input.visibility === 'self' && !input.isSelf) return 'outside-scope';

  if (input.dateOfJoining > input.to) return 'joined-after-range';
  if (input.dateOfLeaving !== null && input.dateOfLeaving < input.from) return 'left-before-range';

  if (input.visibility === 'team' && !input.isSelf) return 'maybe-outside-scope';
  return 'nothing-recorded';
}
