import { getDay, parseISO } from 'date-fns';

import type { EmploymentType, PunchSource } from '@vyuha/shared';

import { isExpectedWorkday, statusBand } from '@/features/attendance/chart-series';
import type { AttendanceDay } from '@/features/attendance/types';

import type { PunchRow, RosterRow } from './use-analytics-data';

/**
 * Every number this screen plots, computed here and nowhere else.
 *
 * CLAUDE.md §6: a component renders, it does not decide what a number means.
 * Deciding that a holiday is outside the denominator of an attendance rate, or
 * that "repeat offender" means days rather than minutes, is domain judgement,
 * and domain judgement inside a chart component is judgement nothing can test.
 *
 * The rule that governs every rate below: **a rate with no denominator is not
 * zero, it is nothing.** A weekday nobody was rostered on has no absence rate,
 * and returning 0% for it would draw a reassuring low bar where there is no
 * measurement at all. Every rate function therefore returns `null` for an
 * empty denominator and the charts drop those points rather than plotting them.
 */

// ------------------------------------------------------- attendance over time

export interface RatePoint {
  date: string;
  /** Percentage 0-100, or null when nobody was expected that day. */
  rate: number | null;
  atWork: number;
  expected: number;
}

/**
 * The share of expected people who were actually at work, day by day.
 *
 * Not the same question as the dashboard's stacked counts, and deliberately
 * so. Counts move when headcount moves; a rate does not, which is the only way
 * to see that attendance is slipping in a month when six people joined.
 *
 * Holidays and weekly offs are excluded from the denominator. Counting them
 * would drop the rate to zero every Sunday and turn a normal week into a
 * sawtooth that hides the trend it exists to show.
 */
export function attendanceRate(
  days: readonly AttendanceDay[],
  dates: readonly string[],
): RatePoint[] {
  const points: RatePoint[] = dates.map((date) => ({ date, rate: null, atWork: 0, expected: 0 }));
  const index = new Map(points.map((point) => [point.date, point]));

  for (const day of days) {
    const point = index.get(day.date);
    if (!point || !isExpectedWorkday(day.status)) continue;
    point.expected += 1;
    if (statusBand(day.status) === 'work') point.atWork += 1;
  }

  for (const point of points) {
    point.rate = point.expected === 0 ? null : round1((point.atWork / point.expected) * 100);
  }

  return points;
}

/** One decimal place. A rate printed to four is precision the data does not have. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ------------------------------------------------------------ weekday absence

/** Monday first, because a working week starts on one. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

export interface WeekdayPoint {
  weekday: string;
  /** Percentage 0-100, or null when no day of this weekday was expected. */
  rate: number | null;
  absent: number;
  expected: number;
}

/**
 * Which weekday people miss (REQ-J-01 "Absenteeism", by weekday).
 *
 * A rate rather than a count, because a period rarely contains the same number
 * of each weekday: five Mondays and four Fridays would make Monday look worse
 * by arithmetic alone.
 *
 * A weekday with no expected days is kept in the series with `rate: null` so
 * the axis still reads Mon-Sun. Dropping it would silently renumber the axis
 * and make a six-bar chart look like a seven-bar one with a missing value.
 */
export function absenceByWeekday(days: readonly AttendanceDay[]): WeekdayPoint[] {
  const absent = new Map<number, number>();
  const expected = new Map<number, number>();

  for (const day of days) {
    const parsed = parseISO(day.date);
    if (Number.isNaN(parsed.getTime())) continue;
    if (!isExpectedWorkday(day.status)) continue;
    const weekday = getDay(parsed);
    expected.set(weekday, (expected.get(weekday) ?? 0) + 1);
    if (day.status === 'ABSENT') absent.set(weekday, (absent.get(weekday) ?? 0) + 1);
  }

  return WEEKDAY_ORDER.map((weekday) => {
    const total = expected.get(weekday) ?? 0;
    const missed = absent.get(weekday) ?? 0;
    return {
      weekday: WEEKDAY_LABELS[weekday] ?? String(weekday),
      rate: total === 0 ? null : round1((missed / total) * 100),
      absent: missed,
      expected: total,
    };
  });
}

// ---------------------------------------------------------------- punctuality

export interface LateBucket {
  label: string;
  days: number;
}

/**
 * The buckets a late arrival falls into.
 *
 * Chosen against the shift policy rather than as round numbers: REQ-C-01 puts
 * `late_after` at 10 minutes by default, so the first two buckets straddle the
 * threshold that decides whether a day is flagged at all. The point of the
 * chart is to tell "everybody is five minutes late" from "two people are an
 * hour late", and those two produce opposite management actions.
 */
const LATE_BUCKETS: readonly { label: string; upTo: number }[] = [
  { label: '1-5 min', upTo: 5 },
  { label: '6-15 min', upTo: 15 },
  { label: '16-30 min', upTo: 30 },
  { label: '31-60 min', upTo: 60 },
  { label: 'Over 1 hr', upTo: Number.POSITIVE_INFINITY },
];

export function lateSpread(days: readonly AttendanceDay[]): LateBucket[] {
  const counts = LATE_BUCKETS.map((bucket) => ({ label: bucket.label, days: 0 }));

  for (const day of days) {
    if (day.lateMinutes <= 0) continue;
    const at = LATE_BUCKETS.findIndex((bucket) => day.lateMinutes <= bucket.upTo);
    const target = counts[at === -1 ? counts.length - 1 : at];
    if (target) target.days += 1;
  }

  return counts;
}

export interface PersonPoint {
  name: string;
  value: number;
}

/** How many people a "top N" chart names before it stops being readable. */
export const TOP_N = 8;

/**
 * Who is late most often, by number of late days rather than minutes.
 *
 * Days, deliberately: one person an hour late once and one person five minutes
 * late twelve times are different problems, and only the second is a habit.
 * The minutes are on the tooltip for whoever wants them.
 */
export function repeatLate(days: readonly AttendanceDay[], limit = TOP_N): PersonPoint[] {
  const tally = new Map<string, number>();

  for (const day of days) {
    if (day.lateMinutes <= 0) continue;
    tally.set(day.employee.name, (tally.get(day.employee.name) ?? 0) + 1);
  }

  return topBy(tally, limit);
}

/**
 * Who carries the overtime, in minutes (REQ-E-05: a number, never money).
 *
 * `otMinutes` is optional on the client type because the server withholds it
 * from a viewer who may see only their own attendance. This screen is gated on
 * the two breadth permissions, so it is present in practice — the default is
 * here so that a future caller without them gets a zero rather than a NaN that
 * would blank the chart.
 */
export function overtimeLeaders(days: readonly AttendanceDay[], limit = TOP_N): PersonPoint[] {
  const tally = new Map<string, number>();

  for (const day of days) {
    const minutes = Math.max(0, day.otMinutes ?? 0);
    if (minutes === 0) continue;
    tally.set(day.employee.name, (tally.get(day.employee.name) ?? 0) + minutes);
  }

  return topBy(tally, limit);
}

/**
 * The share of the total the named people account for, 0-100.
 *
 * This is the number the overtime chart exists to produce: "the top eight
 * carry 71% of it" is an answer, and a ranked list without it is a leaderboard.
 */
export function concentration(top: readonly PersonPoint[], days: readonly AttendanceDay[]): number {
  const total = days.reduce((sum, day) => sum + Math.max(0, day.otMinutes ?? 0), 0);
  if (total === 0) return 0;
  const named = top.reduce((sum, point) => sum + point.value, 0);
  return round1((named / total) * 100);
}

/**
 * Highest first, ties broken by name.
 *
 * The tie-break is not cosmetic. Without it, two people on three late days
 * each swap places whenever the rows come back in a different order, and a
 * chart that reorders itself on refetch looks like the data changed.
 */
function topBy(tally: ReadonlyMap<string, number>, limit: number): PersonPoint[] {
  return [...tally.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name))
    .slice(0, Math.max(0, limit));
}

// --------------------------------------------------------------- punch quality

export interface SourcePoint {
  source: PunchSource;
  label: string;
  punches: number;
}

const SOURCE_LABELS: Record<PunchSource, string> = {
  MOBILE: 'Mobile',
  WEB: 'Web',
  OFFLINE_SYNC: 'Offline sync',
  ADMIN_ENTRY: 'Admin entry',
};

/**
 * How punches reached the server (REQ-D-09, REQ-D-10).
 *
 * Not idle curiosity: web punch is policed by the IP allowlist and mobile
 * punch by the geofence, so the mix says which control is actually carrying
 * the premises rule. A month that drifts to offline sync is a connectivity
 * problem that will show up as disputed timestamps later.
 *
 * Every source in the contract appears, including the ones with no punches, so
 * "nobody used the web this month" is visible as an empty bar rather than as
 * an absent category.
 */
export function punchSources(punches: readonly PunchRow[]): SourcePoint[] {
  const tally = new Map<PunchSource, number>();
  for (const punch of punches) tally.set(punch.source, (tally.get(punch.source) ?? 0) + 1);

  return (Object.keys(SOURCE_LABELS) as PunchSource[]).map((source) => ({
    source,
    label: SOURCE_LABELS[source],
    punches: tally.get(source) ?? 0,
  }));
}

export interface FlagPoint {
  flag: string;
  punches: number;
}

/**
 * What actually went wrong at the punch, by flag, most common first.
 *
 * Only flags that occurred are listed. The contract carries twelve and a
 * healthy month raises three; a fixed list of twelve would spend most of the
 * chart asserting that nothing happened.
 */
export function flagVolume(punches: readonly PunchRow[], limit = TOP_N): FlagPoint[] {
  const tally = new Map<string, number>();
  for (const punch of punches) {
    for (const flag of punch.flags) tally.set(flag, (tally.get(flag) ?? 0) + 1);
  }

  return [...tally.entries()]
    .map(([flag, punches_]) => ({ flag, punches: punches_ }))
    .sort((left, right) => right.punches - left.punches || left.flag.localeCompare(right.flag))
    .slice(0, Math.max(0, limit));
}

// ------------------------------------------------------------------ headcount

export interface DepartmentPoint {
  department: string;
  permanent: number;
  fixedTerm: number;
  total: number;
}

const FIXED_TERM: readonly EmploymentType[] = ['CONTRACT', 'PROBATION', 'INTERN'];

/** Employees without a department, named rather than dropped. */
const NO_DEPARTMENT = 'Unassigned';

/**
 * Where people sit, and how much of each department is fixed-term.
 *
 * Two series rather than four. The four employment types cannot be given four
 * distinguishable colours from this theme's semantic tokens — green beside
 * amber measures ΔE 4.7 under protanopia, which is a fail — and the question a
 * manager asks is binary anyway: which departments are carrying people whose
 * engagement ends on a date.
 *
 * Only active and on-notice people are counted. An inactive record is history
 * the product keeps for past reports (REQ-A-05); counting it as headcount
 * would inflate every department by its leavers, permanently.
 */
export function headcountByDepartment(people: readonly RosterRow[]): DepartmentPoint[] {
  const tally = new Map<string, DepartmentPoint>();

  for (const person of people) {
    if (person.status === 'INACTIVE') continue;
    const name = person.department?.name ?? NO_DEPARTMENT;
    const point = tally.get(name) ?? { department: name, permanent: 0, fixedTerm: 0, total: 0 };
    if (FIXED_TERM.includes(person.employmentType)) point.fixedTerm += 1;
    else point.permanent += 1;
    point.total += 1;
    tally.set(name, point);
  }

  return [...tally.values()].sort(
    (left, right) => right.total - left.total || left.department.localeCompare(right.department),
  );
}

// -------------------------------------------------------------------- totals

export interface PeriodTotals {
  people: number;
  rows: number;
  atWork: number;
  absent: number;
  expected: number;
  flaggedDays: number;
  /** Percentage 0-100, or null when the period expected nobody. */
  attendanceRate: number | null;
}

/**
 * The figures at the top of the screen.
 *
 * Chosen so that no chart below restates one of them: the rate line shows a
 * trend rather than a total, the weekday chart shows a distribution, and
 * neither the late spread nor the overtime chart has a figure here at all.
 */
export function periodTotals(days: readonly AttendanceDay[]): PeriodTotals {
  const people = new Set<string>();
  let atWork = 0;
  let absent = 0;
  let expected = 0;
  let flaggedDays = 0;

  for (const day of days) {
    people.add(day.employee.id);
    if (day.flags.length > 0) flaggedDays += 1;
    if (!isExpectedWorkday(day.status)) continue;
    expected += 1;
    if (day.status === 'ABSENT') absent += 1;
    if (statusBand(day.status) === 'work') atWork += 1;
  }

  return {
    people: people.size,
    rows: days.length,
    atWork,
    absent,
    expected,
    flaggedDays,
    attendanceRate: expected === 0 ? null : round1((atWork / expected) * 100),
  };
}
