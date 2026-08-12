import { format, parseISO } from 'date-fns';

import { EMPTY_VALUE } from '@/lib/format';

/**
 * Attendance-specific rendering. `lib/format` owns dates because every module
 * writes them the same way (REQ-L-01); clocks and durations live here because
 * they are attendance's shapes and nothing else in the product has them yet.
 */

const CLOCK_PATTERN = /^(\d{2}):(\d{2})/u;

/**
 * A scheduled or actual punch time, as `HH:mm`.
 *
 * The contract says these are wall-clock strings, but the endpoint is not
 * written yet and "send the whole instant" is the obvious way for it to
 * arrive differently. Accepting both costs four lines and is the difference
 * between a wrong-looking column and a screen full of `Invalid Date`.
 */
export function formatClock(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const direct = CLOCK_PATTERN.exec(value);
  if (direct) return `${direct[1] ?? ''}:${direct[2] ?? ''}`;
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  return format(parsed, 'HH:mm');
}

/**
 * Worked or overtime minutes as `8h 12m`.
 *
 * Zero is rendered as the em dash rather than "0h 0m": on a weekly off or a
 * holiday there is nothing to report, and a row of zeroes reads as a
 * calculation that ran and produced nothing rather than as a day nobody was
 * expected to work.
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return EMPTY_VALUE;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}m`;
  if (rest === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(rest)}m`;
}

/** `09:00` and `18:00` become `09:00 – 18:00`, with an en dash, not a hyphen. */
export function formatWindow(from: string | null, to: string | null): string {
  if (!from && !to) return EMPTY_VALUE;
  return `${formatClock(from)} – ${formatClock(to)}`;
}

/** `YYYY-MM-DD` for an endpoint, from a Date. Never the ISO instant. */
export function toDateParam(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * A date-only API string as a Date at local midnight.
 *
 * `new Date('2026-08-12')` reads the same string as UTC midnight and yields
 * the previous day for every reader west of Greenwich — a silent off-by-one
 * that only appears in some timezones.
 */
export function fromDateParam(value: string): Date {
  return parseISO(value);
}
