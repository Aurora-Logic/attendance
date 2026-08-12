import { format, parseISO } from 'date-fns';

/**
 * How dates are written on screen.
 *
 * REQ-L-01 makes dd-MM-yyyy the organisation default, and it will become a
 * setting. Putting it here rather than inlining the pattern means the change is
 * one edit, and — more usefully — it means no screen can render a raw
 * `2026-04-01` by forgetting to format at all, because there is an obvious
 * thing to call instead.
 */
export const DATE_FORMAT = 'dd-MM-yyyy';

/** What a column shows when a nullable date is not set. Not the empty string:
 *  a blank cell reads as a rendering failure, an em dash reads as "none". */
export const EMPTY_VALUE = '—';

/**
 * Formats an API date.
 *
 * The input is a date-only `YYYY-MM-DD` string (NFR-05: a joining date is not
 * an instant), so it is parsed with `parseISO`, which reads a date-only string
 * as local midnight. `new Date(value)` would read the same string as UTC
 * midnight and print the previous day for every user west of Greenwich — a
 * silent off-by-one that only shows up in some timezones.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const parsed = parseISO(value);
  // A malformed date from the API is a data problem, not a reason to render
  // "Invalid Date" into a table cell.
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  return format(parsed, DATE_FORMAT);
}

/** `ON_NOTICE` -> `On notice`. Sentence case, per PRD §6.6. */
export function humaniseEnum(value: string): string {
  const words = value.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
