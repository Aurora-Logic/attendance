import { format, parseISO } from 'date-fns';

import { toDateParam } from '@/features/attendance/format';
import { EMPTY_VALUE, formatDate } from '@/lib/format';

import type { AuditEntry } from './types';

/**
 * How an audit row names its moment and its actor.
 *
 * In their own module rather than beside the component that first needed them:
 * three surfaces render an entry now — the viewer's table, its detail sheet,
 * and the per-record history (REQ-M-02) — and a timestamp written three ways
 * would make the same event look like three events.
 */

export function printInstant(value: string): string {
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  // Date in the organisation's format, time to the minute. Seconds matter for
  // ordering, not for reading, and they are in the detail.
  return `${formatDate(toDateParam(parsed))} ${format(parsed, 'HH:mm')}`;
}

export function actorLabel(entry: AuditEntry): string {
  if (entry.actor === null) return 'System';
  return entry.actor.name ?? entry.actor.email ?? entry.actor.id;
}

/**
 * What the "Older" button should do, given what has been fetched.
 *
 * Extracted from the component because it is the only part of keyset paging
 * with a wrong answer: `advance` when the page is already in the cache,
 * `fetch` when it is not but the server says there is more, and `disabled` at
 * the end. Getting the middle case wrong shows an empty page for as long as
 * the request takes; getting the last one wrong offers a page that does not
 * exist. Neither is visible in a type.
 */
export type OlderAction = 'advance' | 'fetch' | 'disabled';

export function olderAction(input: {
  pageIndex: number;
  fetchedPages: number;
  hasNextPage: boolean;
  isFetching: boolean;
}): OlderAction {
  if (input.isFetching) return 'disabled';
  if (input.pageIndex < input.fetchedPages - 1) return 'advance';
  return input.hasNextPage ? 'fetch' : 'disabled';
}
