import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

import type { AttendanceStatus } from '@vyuha/shared';

import type { AttendanceDay } from './types';

/**
 * Attendance day rows turned into the arrays a chart plots.
 *
 * All of it is here rather than in the components for the reason CLAUDE.md §6
 * gives: a component renders, it does not decide what a number means. Deciding
 * that a HALF_DAY counts as somebody who came to work, or that a date the
 * server returned no row for is a gap rather than a zero, is domain logic, and
 * domain logic living inside a chart is domain logic nothing can test.
 *
 * Two rules everything below keeps:
 *
 * 1. A date the caller asked for always produces a point, even when no row
 *    came back for it. Recharts will happily skip a missing date and silently
 *    compress the axis, which turns "nobody was recorded on the 14th" into
 *    "the 14th did not happen".
 * 2. A row for a date the caller did not ask for is dropped rather than
 *    appended. The range is the question; a row outside it is a server or a
 *    clock problem and must not become a phantom column at the end of a chart.
 */

/**
 * The four bands eight statuses collapse into, and why.
 *
 * A stacked bar carries about four series before the eye gives up, and the
 * palette has to survive colour blindness — measured rather than guessed. The
 * four tokens these map to (success, info, destructive, muted-foreground)
 * separate by ΔE 12.2 at worst under deuteranopia and 10.1 under protanopia
 * (OKLab distance x100, floor 6, target 8). The pairs this palette must avoid
 * are red beside amber, which measures 5.5 under deuteranopia, and green
 * beside amber, which measures 4.7 under protanopia; neither appears here.
 *
 * `other` is the honest name for what is left. A holiday and a day the engine
 * has not finalised are both "not a working day anybody missed", and folding
 * them into `absent` would report a public holiday as mass absenteeism.
 *
 * The dashboard holds an identical map. Both should collapse into this one
 * when the file-ownership split ends; until then this is the copy the
 * attendance module and Analytics read, and it must not be allowed to drift
 * silently — `STATUS_BAND` is keyed on the shared enum, so a status added to
 * the contract is a compile error in both places rather than a silent default.
 */
export type StatusBand = 'work' | 'leave' | 'absent' | 'other';

const STATUS_BAND: Record<AttendanceStatus, StatusBand> = {
  PRESENT: 'work',
  HALF_DAY: 'work',
  ON_DUTY: 'work',
  ON_LEAVE: 'leave',
  ABSENT: 'absent',
  PENDING: 'other',
  HOLIDAY: 'other',
  WEEKLY_OFF: 'other',
};

export function statusBand(status: AttendanceStatus): StatusBand {
  return STATUS_BAND[status];
}

/**
 * Whether a date was one the organisation expected work on.
 *
 * A holiday and a weekly off are not attendance; counting them in a rate's
 * denominator drags every rate down on the weeks that contain them and makes a
 * public holiday look like a slump.
 */
export function isExpectedWorkday(status: AttendanceStatus): boolean {
  return status !== 'HOLIDAY' && status !== 'WEEKLY_OFF';
}

/** A year of daily points is already more than a chart can show; refuse more. */
const MAX_RANGE_DAYS = 366;

/**
 * Every date from `from` to `to` inclusive, as `YYYY-MM-DD`.
 *
 * Returns `[]` rather than throwing for a reversed or unparseable range: this
 * feeds a chart, and the empty state is a better answer than a crash inside a
 * renderer.
 */
export function dateRange(from: string, to: string): string[] {
  const start = parseISO(from);
  const end = parseISO(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const span = differenceInCalendarDays(end, start);
  if (span < 0) return [];
  const count = Math.min(span, MAX_RANGE_DAYS - 1);
  return Array.from({ length: count + 1 }, (_, index) =>
    format(addDays(start, index), 'yyyy-MM-dd'),
  );
}

export interface BandPoint {
  date: string;
  work: number;
  leave: number;
  absent: number;
  other: number;
}

/** One stacked column per date: how many people were in each band that day. */
export function statusBands(
  days: readonly AttendanceDay[],
  dates: readonly string[],
): BandPoint[] {
  const points: BandPoint[] = dates.map((date) => ({
    date,
    work: 0,
    leave: 0,
    absent: 0,
    other: 0,
  }));
  const index = new Map(points.map((point) => [point.date, point]));

  for (const day of days) {
    const point = index.get(day.date);
    if (!point) continue;
    point[STATUS_BAND[day.status]] += 1;
  }

  return points;
}

export interface HoursPoint {
  date: string;
  workedMinutes: number;
  otMinutes: number;
}

/**
 * One person's worked minutes per day.
 *
 * Overtime is carried alongside rather than stacked on top. The contract does
 * not say whether `workedMinutes` already contains `otMinutes` (REQ-E-05 only
 * says overtime is a number), and a stacked bar would be asserting an answer:
 * if it does contain it, the stack double-counts. So the bar is worked minutes
 * and nothing else, and overtime is reported as its own figure in the tooltip.
 */
export function workedByDay(
  days: readonly AttendanceDay[],
  dates: readonly string[],
): HoursPoint[] {
  const points: HoursPoint[] = dates.map((date) => ({ date, workedMinutes: 0, otMinutes: 0 }));
  const index = new Map(points.map((point) => [point.date, point]));

  for (const day of days) {
    const point = index.get(day.date);
    if (!point) continue;
    point.workedMinutes += Math.max(0, day.workedMinutes);
    point.otMinutes += Math.max(0, day.otMinutes);
  }

  return points;
}

export interface TimekeepingPoint {
  date: string;
  lateMinutes: number;
  earlyExitMinutes: number;
}

/**
 * Minutes lost at each end of the day (REQ-J-01 Late Arrivals / Early Exits).
 *
 * Both are clamped at zero. A negative `lateMinutes` would mean "arrived
 * early", which the contract has no word for, and plotting it would put a bar
 * below the axis in a chart whose axis starts at zero.
 */
export function timekeepingByDay(
  days: readonly AttendanceDay[],
  dates: readonly string[],
): TimekeepingPoint[] {
  const points: TimekeepingPoint[] = dates.map((date) => ({
    date,
    lateMinutes: 0,
    earlyExitMinutes: 0,
  }));
  const index = new Map(points.map((point) => [point.date, point]));

  for (const day of days) {
    const point = index.get(day.date);
    if (!point) continue;
    point.lateMinutes += Math.max(0, day.lateMinutes);
    // `?? 0` rather than a non-null assertion: the field is optional on the
    // client type (see types.ts) and a day built before it existed would
    // otherwise add NaN to the series and blank the whole chart.
    point.earlyExitMinutes += Math.max(0, day.earlyExitMinutes ?? 0);
  }

  return points;
}

/** True when at least one point carries a value; every chart's empty test. */
export function hasValues<T>(points: readonly T[], keys: readonly (keyof T)[]): boolean {
  return points.some((point) => keys.some((key) => Number(point[key]) > 0));
}

/**
 * Which dates get a label on the axis.
 *
 * Recharts' own thinning takes a step count from the first category and lets
 * the last one fall wherever it lands, which on a thirty-day range labelled
 * every sixth day stops at the 8th and leaves the reader guessing where today
 * is. Choosing the ticks outright puts the first and last date on the axis
 * whatever the range, and is deterministic enough to test.
 */
export function axisTicks(dates: readonly string[], maxTicks: number): string[] {
  if (dates.length === 0) return [];
  if (maxTicks < 2) return dates.slice(0, 1);
  if (dates.length <= maxTicks) return [...dates];

  const step = (dates.length - 1) / (maxTicks - 1);
  const picked = new Set<string>();
  for (let index = 0; index < maxTicks; index += 1) {
    const date = dates[Math.round(index * step)];
    if (date !== undefined) picked.add(date);
  }
  return [...picked];
}

/**
 * A y axis for durations that lands on whole hours.
 *
 * Recharts picks its own ticks from the data, which for a month topping out at
 * nine hours produced an axis reading 0h, 3h, 7h, 10h — three uneven steps
 * that look like a rounding bug because they are one. Fixing the domain to a
 * multiple of the step puts every gridline on an hour a reader recognises.
 */
export function hourTicks(maxMinutes: number): { domainMax: number; ticks: number[] } {
  const step = maxMinutes > 720 ? 180 : 120;
  const domainMax = Math.max(step, Math.ceil(Math.max(0, maxMinutes) / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= domainMax; value += step) ticks.push(value);
  return { domainMax, ticks };
}

/** `2026-08-13` as `13 Aug`, for an axis with no room for a full date. */
export function shortDate(date: string): string {
  const parsed = parseISO(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return format(parsed, 'd MMM');
}
