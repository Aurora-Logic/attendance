import { format, formatDistanceToNow, parseISO } from 'date-fns';

import { DEFAULT_LOCALE, groupDigits, type WorkspaceLocale } from '@vyuha/shared';

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
 * The workspace's number format and currency symbol, set once by the shell
 * from the branding read (appearance-effect.tsx) and read by every
 * formatter below. A module-level value rather than context, because the
 * formatters are called from table cells, chart labels and toasts, none of
 * which should need a hook to write a number.
 */
let locale: WorkspaceLocale = DEFAULT_LOCALE;

export function setWorkspaceLocale(next: WorkspaceLocale): void {
  locale = next;
}

export function currencySymbol(): string {
  return locale.currencySymbol;
}

/** A decimal string as the API sends it, grouped the way the workspace writes figures; two decimals. */
export function formatAmount(value: string | null): string {
  if (value === null) return EMPTY_VALUE;
  const negative = value.startsWith('-');
  const [whole = '0', fraction] = value.replace(/^-/u, '').split('.');
  const decimals = fraction === undefined ? '00' : fraction.padEnd(2, '0').slice(0, 2);
  return `${negative ? '−' : ''}${groupDigits(whole, locale.numberFormat)}.${decimals}`;
}

/** A whole number for a headline: grouped, no decimals. */
export function formatCount(value: number): string {
  const rounded = Math.round(Math.abs(value));
  return `${value < 0 ? '−' : ''}${groupDigits(String(rounded), locale.numberFormat)}`;
}

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


/**
 * "3 minutes ago", or the empty-value dash for an unparseable instant. One
 * owner for relative ages, so Integrations and Parties cannot drift apart on
 * how the same timestamp reads.
 */
export function formatRelativeAge(iso: string): string {
  const parsed = parseISO(iso);
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  return `${formatDistanceToNow(parsed)} ago`;
}
